import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';
import { TrafficGateway } from '../gateway/traffic.gateway';
import { JunctionRoutesService } from '../junction-routes/junction-routes.service';

@Injectable()
export class SimulatorService {
  private readonly log = new Logger(SimulatorService.name);
  private junctions: any[] = [];

  constructor(
    @Inject(DB_POOL) private db: Pool,
    private gateway: TrafficGateway,
    private routesSvc: JunctionRoutesService,
  ) {
    this.loadJunctions();
  }

  private async loadJunctions() {
    try {
      const res = await this.db.query(
        'SELECT id, name, short_name, lat, lng FROM junctions WHERE is_active=true ORDER BY id',
      );
      this.junctions = res.rows;
      this.log.log(`Loaded ${this.junctions.length} active junctions`);
    } catch (e) {
      this.log.error('loadJunctions failed, retrying in 5s', e);
      setTimeout(() => this.loadJunctions(), 5000);
    }
  }

  // Fetch current + usual traffic for a specific origin→destination route
  private async fetchRouteTraffic(
    originLat: number, originLng: number,
    destLat: number, destLng: number,
  ): Promise<{
    delay: number; usualDelay: number;
    totalSeconds: number; usualSeconds: number; freeFlowSeconds: number;
    source: string;
  }> {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      const delay = this.fallbackDelay();
      return { delay, usualDelay: 0, totalSeconds: 0, usualSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
    }

    const base = `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${originLat},${originLng}&destination=${destLat},${destLng}` +
      `&traffic_model=best_guess&key=${googleKey}`;

    const nextWeekTs = Math.floor((Date.now() + 7 * 24 * 3600 * 1000) / 1000);

    try {
      const [curRes, usualRes] = await Promise.all([
        fetch(`${base}&departure_time=now`).then(r => r.json()),
        fetch(`${base}&departure_time=${nextWeekTs}`).then(r => r.json()),
      ]);

      if (curRes.status !== 'OK') {
        this.log.error(`[Google] ${curRes.status}: ${curRes.error_message || ''}`);
        return { delay: this.fallbackDelay(), usualDelay: 0, totalSeconds: 0, usualSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
      }

      const leg = curRes.routes[0].legs[0];
      const freeFlowSeconds: number = leg.duration?.value ?? 0;
      const totalSeconds: number = leg.duration_in_traffic?.value ?? freeFlowSeconds;
      const delay = Math.round((Math.max(0, totalSeconds - freeFlowSeconds) / 60) * 10) / 10;

      let usualSeconds = totalSeconds;
      let usualDelay = 0;
      if (usualRes.status === 'OK') {
        const uLeg = usualRes.routes[0].legs[0];
        usualSeconds = uLeg.duration_in_traffic?.value ?? uLeg.duration?.value ?? totalSeconds;
        usualDelay = Math.round((Math.max(0, totalSeconds - usualSeconds) / 60) * 10) / 10;
      }

      this.log.log(`[Google] ${originLat},${originLng}→${destLat},${destLng} total=${totalSeconds}s usual=${usualSeconds}s delay=${delay}m usualDelay=${usualDelay}m`);
      return { delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, source: 'google' };
    } catch (e: any) {
      this.log.error(`[Google] Fetch error: ${e.message}`);
      return { delay: this.fallbackDelay(), usualDelay: 0, totalSeconds: 0, usualSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
    }
  }

  private fallbackDelay(): number {
    const hour = new Date().getHours();
    let factor = 1.0;
    if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20)) factor = 1.8;
    else if (hour >= 11 && hour <= 16) factor = 1.2;
    else if (hour >= 21 || hour <= 6) factor = 0.4;
    return Math.min(Math.round(Math.random() * 8 * factor + 1), 20);
  }

  private getLevel(delay: number): string {
    if (delay <= 2) return 'usual';
    if (delay <= 5) return 'normal';
    if (delay <= 9) return 'intermediate';
    return 'heavy';
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async runSimulation() {
    await this.loadJunctions();

    // Prefer routes if defined; fallback to junction-point approximation
    const routes = await this.routesSvc.findAllActive();
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;

    if (routes.length > 0) {
      // === ROUTE-BASED mode: one Google call per route ===
      this.log.log(`Route-based simulation: ${routes.length} routes | Google: ${googleKey ? 'YES' : 'NO'}`);
      const updates: any[] = [];

      for (const r of routes) {
        const { delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, source } =
          await this.fetchRouteTraffic(+r.origin_lat, +r.origin_lng, +r.dest_lat, +r.dest_lng);

        const level = this.getLevel(delay);

        await this.db.query(
          `INSERT INTO route_traffic_data
             (time, route_id, junction_id, delay_minutes, usual_delay_minutes,
              total_seconds, usual_seconds, free_flow_seconds, congestion_level, source)
           VALUES (NOW(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r.id, r.junction_id, delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, level, source],
        );

        const update = {
          route_id: r.id,
          junction_id: r.junction_id,
          junction_name: r.junction_name,
          short_name: r.short_name,
          station: r.station,
          coming_from: r.coming_from,
          delay_minutes: delay,
          usual_delay_minutes: usualDelay,
          total_seconds: totalSeconds,
          usual_seconds: usualSeconds,
          congestion_level: level,
          source,
          time: new Date(),
        };
        updates.push(update);

        if (level === 'heavy') this.gateway.broadcastHeavyAlert(update);
      }

      this.gateway.broadcastTrafficUpdate(updates);
      const gCount = updates.filter(u => u.source === 'google').length;
      this.log.log(`Routes updated: ${updates.length} | Google: ${gCount} | Simulator: ${updates.length - gCount}`);
    } else {
      // === JUNCTION-POINT fallback: approximate 400m northeast segment ===
      this.log.log(`Junction-point simulation: ${this.junctions.length} junctions (no routes defined)`);
      const updates: any[] = [];

      for (const j of this.junctions) {
        const destLat = +j.lat + 0.002;
        const destLng = +j.lng + 0.002;
        const { delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, source } =
          await this.fetchRouteTraffic(+j.lat, +j.lng, destLat, destLng);

        const level = this.getLevel(delay);
        const speedKmh = Math.max(5, Math.round(60 - delay * 5));

        await this.db.query(
          `INSERT INTO traffic_data
             (time, junction_id, delay_minutes, usual_delay_minutes,
              total_seconds, usual_seconds, free_flow_seconds, congestion_level, speed_kmh, source)
           VALUES (NOW(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [j.id, delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, level, speedKmh, source],
        );

        const update = {
          junction_id: j.id, junction_name: j.name, short_name: j.short_name,
          delay_minutes: delay, usual_delay_minutes: usualDelay,
          total_seconds: totalSeconds, usual_seconds: usualSeconds,
          congestion_level: level, speed_kmh: speedKmh, source, time: new Date(),
        };
        updates.push(update);
        if (level === 'heavy') this.gateway.broadcastHeavyAlert(update);
      }

      this.gateway.broadcastTrafficUpdate(updates);
    }
  }

  async runOnce() { await this.runSimulation(); }
}
