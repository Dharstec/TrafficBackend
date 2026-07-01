import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';
import { TrafficGateway } from '../gateway/traffic.gateway';

@Injectable()
export class SimulatorService {
  private junctions: any[] = [];
  private readonly googleKey = process.env.GOOGLE_MAPS_API_KEY;

  constructor(
    @Inject(DB_POOL) private db: Pool,
    private gateway: TrafficGateway,
  ) {
    this.loadJunctions();
  }

  private async loadJunctions() {
    try {
      const res = await this.db.query('SELECT id, name, short_name, lat, lng FROM junctions WHERE is_active=true ORDER BY id');
      this.junctions = res.rows;
    } catch (e) {
      setTimeout(() => this.loadJunctions(), 5000);
    }
  }

  // Call Google Routes API — returns delay in minutes for the road near this junction
  private async fetchGoogleDelay(lat: number, lng: number): Promise<{ delay: number; source: string }> {
    if (!this.googleKey) {
      return { delay: this.fallbackDelay(), source: 'simulator' };
    }

    // Short route: junction → ~400m northeast, measures traffic on that road segment
    const body = {
      origin: { location: { latLng: { latitude: lat, longitude: lng } } },
      destination: { location: { latLng: { latitude: lat + 0.002, longitude: lng + 0.002 } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      departureTime: new Date().toISOString(),
    };

    try {
      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'X-Goog-Api-Key': this.googleKey,
          'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data: any = await res.json();

      if (data.error) {
        console.error('[Google Routes] API error:', data.error.message);
        return { delay: this.fallbackDelay(), source: 'simulator' };
      }

      const route = data.routes?.[0];
      if (!route) return { delay: this.fallbackDelay(), source: 'simulator' };

      // duration = travel time WITH traffic (e.g. "245s")
      // staticDuration = free-flow travel time WITHOUT traffic
      const withTraffic = parseInt((route.duration || '0s').replace('s', ''));
      const noTraffic = parseInt((route.staticDuration || '0s').replace('s', ''));
      const delaySec = Math.max(0, withTraffic - noTraffic);
      const delayMin = Math.round((delaySec / 60) * 10) / 10;

      console.log(`[Google Routes] lat=${lat} lng=${lng} withTraffic=${withTraffic}s noTraffic=${noTraffic}s delay=${delayMin}min`);
      return { delay: delayMin, source: 'google' };
    } catch (e: any) {
      console.error('[Google Routes] Fetch error:', e.message);
      return { delay: this.fallbackDelay(), source: 'simulator' };
    }
  }

  // Fallback when no API key — time-of-day weighted random
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
    if (!this.junctions.length) {
      await this.loadJunctions();
      return;
    }

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

      const update = { junction_id: j.id, junction_name: j.name, short_name: j.short_name, delay_minutes: delay, congestion_level: level, speed_kmh: speedKmh, time: new Date() };
      updates.push(update);

      // Alert supervisors when traffic is heavy
      if (level === 'heavy') {
        this.gateway.broadcastHeavyAlert(update);
      }
    }

    this.gateway.broadcastTrafficUpdate(updates);
    console.log(`[Simulator] Updated ${updates.length} junctions`);
  }

  async runOnce() {
    await this.loadJunctions();
    await this.runSimulation();
  }
}
