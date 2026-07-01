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

  // Uses Google Directions API — widely enabled, returns duration_in_traffic
  private async fetchGoogleDelay(
    lat: number,
    lng: number,
  ): Promise<{ delay: number; source: string }> {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleKey) {
      return { delay: this.fallbackDelay(), source: 'simulator' };
    }

    // Destination ~400m northeast — short segment to measure traffic on this road
    const destLat = lat + 0.002;
    const destLng = lng + 0.002;
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${lat},${lng}` +
      `&destination=${destLat},${destLng}` +
      `&departure_time=now` +
      `&traffic_model=best_guess` +
      `&key=${googleKey}`;

    try {
      const res = await fetch(url);

      if (!res.ok) {
        this.log.error(`[Google] HTTP ${res.status}`);
        return { delay: this.fallbackDelay(), source: 'simulator' };
      }

      const data: any = await res.json();

      if (data.status !== 'OK') {
        this.log.error(
          `[Google] Status=${data.status} ${data.error_message || ''}`,
        );
        return { delay: this.fallbackDelay(), source: 'simulator' };
      }

      const leg = data.routes?.[0]?.legs?.[0];
      if (!leg) return { delay: this.fallbackDelay(), source: 'simulator' };

      // duration_in_traffic = travel time with live traffic
      // duration = free-flow travel time
      const withTraffic =
        leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0;
      const noTraffic = leg.duration?.value ?? 0;
      const delaySec = Math.max(0, withTraffic - noTraffic);
      const delayMin = Math.round((delaySec / 60) * 10) / 10;

      this.log.log(
        `[Google] lat=${lat} lng=${lng} traffic=${withTraffic}s free=${noTraffic}s delay=${delayMin}min`,
      );
      return { delay: delayMin, source: 'google' };
    } catch (e: any) {
      this.log.error(`[Google] Fetch error: ${e.message}`);
      return { delay: this.fallbackDelay(), source: 'simulator' };
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
      `Running simulation for ${this.junctions.length} junctions | Google API: ${googleKey ? 'YES (' + googleKey.slice(0, 8) + '...)' : 'NO — using simulator'}`,
    );

    const updates: any[] = [];

    for (const j of this.junctions) {
      const { delay, source } = await this.fetchGoogleDelay(+j.lat, +j.lng);
      const level = this.getLevel(delay);
      const speedKmh = Math.max(5, Math.round(60 - delay * 5));

      await this.db.query(
        `INSERT INTO traffic_data (time, junction_id, delay_minutes, congestion_level, speed_kmh, source)
         VALUES (NOW(), $1, $2, $3, $4, $5)`,
        [j.id, delay, level, speedKmh, source],
      );

      const update = {
        junction_id: j.id,
        junction_name: j.name,
        short_name: j.short_name,
        delay_minutes: delay,
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
    this.log.log(
      `Updated ${updates.length} junctions | Google: ${googleCount} | Simulator: ${updates.length - googleCount}`,
    );
  }

  async runOnce() {
    await this.runSimulation();
  }
}
