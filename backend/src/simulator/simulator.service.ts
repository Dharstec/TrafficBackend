import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';
import { TrafficGateway } from '../gateway/traffic.gateway';

@Injectable()
export class SimulatorService {
  private readonly log = new Logger(SimulatorService.name);
  private junctions: any[] = [];

  constructor(
    @Inject(DB_POOL) private db: Pool,
    private gateway: TrafficGateway,
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

  // Fetch BOTH current traffic AND usual traffic (same time next week = historical pattern)
  private async fetchGoogleData(lat: number, lng: number): Promise<{
    delay: number;
    usualDelay: number;
    totalSeconds: number;
    usualSeconds: number;
    freeFlowSeconds: number;
    source: string;
  }> {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      const delay = this.fallbackDelay();
      return { delay, usualDelay: 0, totalSeconds: 0, usualSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
    }

    const destLat = lat + 0.002;
    const destLng = lng + 0.002;

    // Current live traffic
    const currentUrl =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${lat},${lng}&destination=${destLat},${destLng}` +
      `&departure_time=now&traffic_model=best_guess&key=${googleKey}`;

    // Same time next week — Google uses historical patterns for future timestamps
    const nextWeekTs = Math.floor((Date.now() + 7 * 24 * 3600 * 1000) / 1000);
    const usualUrl =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${lat},${lng}&destination=${destLat},${destLng}` +
      `&departure_time=${nextWeekTs}&traffic_model=best_guess&key=${googleKey}`;

    try {
      const [currentRes, usualRes] = await Promise.all([
        fetch(currentUrl).then(r => r.json()),
        fetch(usualUrl).then(r => r.json()),
      ]);

      if (currentRes.status !== 'OK') {
        this.log.error(`[Google] Current failed: ${currentRes.status} ${currentRes.error_message || ''}`);
        const delay = this.fallbackDelay();
        return { delay, usualDelay: 0, totalSeconds: 0, usualSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
      }

      const leg = currentRes.routes[0].legs[0];
      const freeFlowSeconds: number = leg.duration?.value ?? 0;
      const totalSeconds: number = leg.duration_in_traffic?.value ?? freeFlowSeconds;
      const delayFromFreeFlow = Math.max(0, totalSeconds - freeFlowSeconds);
      const delay = Math.round((delayFromFreeFlow / 60) * 10) / 10;

      let usualSeconds = totalSeconds;
      let usualDelay = 0;

      if (usualRes.status === 'OK') {
        const usualLeg = usualRes.routes[0].legs[0];
        usualSeconds = usualLeg.duration_in_traffic?.value ?? usualLeg.duration?.value ?? totalSeconds;
        const usualDelayMs = Math.max(0, totalSeconds - usualSeconds);
        usualDelay = Math.round((usualDelayMs / 60) * 10) / 10;
      }

      this.log.log(
        `[Google] lat=${lat} total=${totalSeconds}s usual=${usualSeconds}s freeFlow=${freeFlowSeconds}s ` +
        `delay=${delay}min usualDelay=${usualDelay}min`,
      );

      return { delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, source: 'google' };
    } catch (e: any) {
      this.log.error(`[Google] Error: ${e.message}`);
      const delay = this.fallbackDelay();
      return { delay, usualDelay: 0, totalSeconds: 0, usualSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
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

    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    this.log.log(
      `Simulation: ${this.junctions.length} junctions | Google: ${googleKey ? 'YES' : 'NO'}`,
    );

    const updates: any[] = [];

    for (const j of this.junctions) {
      const { delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, source } =
        await this.fetchGoogleData(+j.lat, +j.lng);

      const level = this.getLevel(delay);
      const speedKmh = Math.max(5, Math.round(60 - delay * 5));

      await this.db.query(
        `INSERT INTO traffic_data
           (time, junction_id, delay_minutes, usual_delay_minutes,
            total_seconds, usual_seconds, free_flow_seconds,
            congestion_level, speed_kmh, source)
         VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [j.id, delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, level, speedKmh, source],
      );

      const update = {
        junction_id: j.id,
        junction_name: j.name,
        short_name: j.short_name,
        delay_minutes: delay,
        usual_delay_minutes: usualDelay,
        total_seconds: totalSeconds,
        usual_seconds: usualSeconds,
        congestion_level: level,
        speed_kmh: speedKmh,
        source,
        time: new Date(),
      };
      updates.push(update);

      if (level === 'heavy') {
        this.gateway.broadcastHeavyAlert(update);
      }
    }

    this.gateway.broadcastTrafficUpdate(updates);
    const googleCount = updates.filter(u => u.source === 'google').length;
    this.log.log(`Updated ${updates.length} junctions | Google: ${googleCount} | Simulator: ${updates.length - googleCount}`);
  }

  async runOnce() {
    await this.runSimulation();
  }
}
