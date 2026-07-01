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

  private async fetchGoogleDelay(
    lat: number,
    lng: number,
  ): Promise<{ delay: number; source: string }> {
    // Read key dynamically so it works even if env loaded after class init
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!googleKey) {
      return { delay: this.fallbackDelay(), source: 'simulator' };
    }

    // Short route ~400m northeast — measures live traffic on this road segment
    const body = {
      origin: { location: { latLng: { latitude: lat, longitude: lng } } },
      destination: {
        location: {
          latLng: { latitude: lat + 0.002, longitude: lng + 0.002 },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: new Date().toISOString(),
    };

    try {
      const res = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'X-Goog-Api-Key': googleKey,
            'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        this.log.error(`[Google] HTTP ${res.status}: ${errText}`);
        return { delay: this.fallbackDelay(), source: 'simulator' };
      }

      const data: any = await res.json();

      if (data.error) {
        this.log.error(`[Google] API error: ${data.error.message} (code ${data.error.code})`);
        return { delay: this.fallbackDelay(), source: 'simulator' };
      }

      const route = data.routes?.[0];
      if (!route) {
        this.log.warn(`[Google] No route returned for lat=${lat} lng=${lng}`);
        return { delay: this.fallbackDelay(), source: 'simulator' };
      }

      const withTraffic = parseInt((route.duration ?? '0s').replace('s', ''), 10);
      const noTraffic = parseInt((route.staticDuration ?? '0s').replace('s', ''), 10);
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
    // Always reload so newly added junctions are included
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
    const sources = updates.map(u => u.source);
    const googleCount = sources.filter(s => s === 'google').length;
    this.log.log(
      `Updated ${updates.length} junctions | Google: ${googleCount} | Simulator: ${updates.length - googleCount}`,
    );
  }

  async runOnce() {
    await this.runSimulation();
  }
}
