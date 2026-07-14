import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { DB_POOL } from '../database/database.module';
import { TrafficGateway } from '../gateway/traffic.gateway';
import { JunctionRoutesService } from '../junction-routes/junction-routes.service';

@Injectable()
export class SimulatorService {
  private readonly log = new Logger(SimulatorService.name);
  private junctions: any[] = [];

  // ── Google free-tier protection ────────────────────────────────────
  // Directions API with traffic data ("Advanced") gives 5,000 free calls
  // per month; we cap below that so the bill can never leave ₹0. Usage is
  // persisted to a JSON file so PM2 restarts don't reset the counter.
  private usageFile = path.join(process.cwd(), 'api-usage.json');
  private googleAllowed = false;

  get freeLimit(): number {
    return +(process.env.GOOGLE_FREE_LIMIT || 4500);
  }

  get autoRefreshEnabled(): boolean {
    return process.env.AUTO_REFRESH === 'true';
  }

  private readUsage(): { month: string; calls: number } {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    try {
      const saved = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      if (saved.month === month) return saved; // new month → fresh counter
    } catch { }
    return { month, calls: 0 };
  }

  private addUsage(calls: number) {
    const u = this.readUsage();
    u.calls += calls;
    try {
      fs.writeFileSync(this.usageFile, JSON.stringify(u));
    } catch (e: any) {
      this.log.error(`[Quota] Could not persist usage file: ${e.message}`);
    }
  }

  getUsage() {
    const u = this.readUsage();
    return {
      month: u.month,
      calls: u.calls,
      limit: this.freeLimit,
      remaining: Math.max(0, this.freeLimit - u.calls),
      auto_refresh: this.autoRefreshEnabled,
    };
  }

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

  // Fetch CURRENT traffic only — ONE Google call per route. "Usual" is no
  // longer a second paid call: it's computed from our own stored history
  // (see usualFromHistory), which costs nothing.
  private async fetchRouteTraffic(
    originLat: number, originLng: number,
    destLat: number, destLng: number,
  ): Promise<{
    delay: number; totalSeconds: number; freeFlowSeconds: number;
    source: string; polyline?: string | null;
  }> {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    // googleAllowed is set per run: key present AND monthly free quota left
    if (!googleKey || !this.googleAllowed) {
      const delay = this.fallbackDelay();
      return { delay, totalSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${originLat},${originLng}&destination=${destLat},${destLng}` +
      `&traffic_model=best_guess&departure_time=now&key=${googleKey}`;

    try {
      const curRes = await fetch(url).then(r => r.json());

      this.logGoogleResponse('LIVE', curRes);

      if (curRes.status !== 'OK') {
        this.log.error(`[Google] ${curRes.status}: ${curRes.error_message || ''}`);
        return { delay: this.fallbackDelay(), totalSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
      }

      const leg = curRes.routes[0].legs[0];
      const freeFlowSeconds: number = leg.duration?.value ?? 0;
      const totalSeconds: number = leg.duration_in_traffic?.value ?? freeFlowSeconds;
      const delay = Math.round((Math.max(0, totalSeconds - freeFlowSeconds) / 60) * 10) / 10;

      // Encoded road shape — the dashboard draws the traffic-colored line
      // along the real road with it (Google Maps traffic-view style).
      const polyline: string | null = curRes.routes[0].overview_polyline?.points ?? null;

      this.log.log(`[Google] ${originLat},${originLng}→${destLat},${destLng} total=${totalSeconds}s delay=${delay}m (1 call)`);
      return { delay, totalSeconds, freeFlowSeconds, source: 'google', polyline };
    } catch (e: any) {
      this.log.error(`[Google] Fetch error: ${e.message}`);
      return { delay: this.fallbackDelay(), totalSeconds: 0, freeFlowSeconds: 0, source: 'simulator' };
    }
  }

  // "Usual" travel time from OUR OWN history — zero Google cost.
  // Primary: average of this route's readings at the same weekday + same
  // hour over the past 6 weeks. Fallback (young history): same hour on any
  // day over 4 weeks. No history at all → usual = current (no delay shown).
  private async usualFromHistory(
    table: 'route_traffic_data' | 'traffic_data',
    idColumn: 'route_id' | 'junction_id',
    id: number,
    totalSeconds: number,
  ): Promise<{ usualSeconds: number; usualDelay: number }> {
    if (!totalSeconds) return { usualSeconds: 0, usualDelay: 0 };
    try {
      const primary = await this.db.query(
        `SELECT AVG(total_seconds) AS avg, COUNT(*) AS n FROM ${table}
         WHERE ${idColumn}=$1 AND source='google' AND total_seconds > 0
           AND EXTRACT(DOW FROM time) = EXTRACT(DOW FROM NOW())
           AND EXTRACT(HOUR FROM time) = EXTRACT(HOUR FROM NOW())
           AND time > NOW() - INTERVAL '42 days'`,
        [id],
      );
      let avg = +primary.rows[0]?.avg || 0;
      if ((+primary.rows[0]?.n || 0) < 3) {
        const fallback = await this.db.query(
          `SELECT AVG(total_seconds) AS avg, COUNT(*) AS n FROM ${table}
           WHERE ${idColumn}=$1 AND source='google' AND total_seconds > 0
             AND EXTRACT(HOUR FROM time) = EXTRACT(HOUR FROM NOW())
             AND time > NOW() - INTERVAL '28 days'`,
          [id],
        );
        if ((+fallback.rows[0]?.n || 0) >= 1) avg = +fallback.rows[0].avg || 0;
      }
      if (!avg) return { usualSeconds: totalSeconds, usualDelay: 0 };
      const usualSeconds = Math.round(avg);
      const usualDelay = Math.round((Math.max(0, totalSeconds - usualSeconds) / 60) * 10) / 10;
      return { usualSeconds, usualDelay };
    } catch {
      return { usualSeconds: totalSeconds, usualDelay: 0 };
    }
  }

  // Log what Google actually answered. Always prints a readable one-line
  // summary; set GOOGLE_LOG=full in .env to also dump the complete raw JSON.
  private logGoogleResponse(tag: string, res: any) {
    try {
      const leg = res?.routes?.[0]?.legs?.[0];
      if (!leg) {
        this.log.warn(`[Google ${tag}] status=${res?.status} ${res?.error_message || ''} (no route in response)`);
        return;
      }
      this.log.log(`[Google ${tag}] ` + JSON.stringify({
        status: res.status,
        road: res.routes[0].summary,
        from: leg.start_address,
        to: leg.end_address,
        distance: leg.distance?.text,
        duration: `${leg.duration?.text} (${leg.duration?.value}s)`,
        duration_in_traffic: leg.duration_in_traffic
          ? `${leg.duration_in_traffic.text} (${leg.duration_in_traffic.value}s)`
          : 'not returned',
      }));
      if (process.env.GOOGLE_LOG === 'full') {
        this.log.log(`[Google ${tag} RAW] ${JSON.stringify(res)}`);
      }
    } catch (e: any) {
      this.log.error(`[Google ${tag}] could not log response: ${e.message}`);
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

  // Auto mode is OPT-IN: the cron only calls Google when AUTO_REFRESH=true
  // in .env. Default is button-only — the dashboard's "Refresh Now" hits
  // POST /simulator/refresh, so API calls happen only on click.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cronTick() {
    if (!this.autoRefreshEnabled) return;
    await this.runSimulation();
  }

  async runSimulation() {
    await this.loadJunctions();

    // Prefer routes if defined; fallback to junction-point approximation
    const routes = await this.routesSvc.findAllActive();
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;

    // Free-tier guard: ONE Google call per route (current only — "usual"
    // comes from our own history for free). If this run would cross the
    // monthly cap, skip Google entirely for the run.
    const targets = routes.length > 0 ? routes.length : this.junctions.length;
    const callsNeeded = targets;
    const usage = this.readUsage();
    this.googleAllowed = !!googleKey && usage.calls + callsNeeded <= this.freeLimit;
    if (googleKey && !this.googleAllowed) {
      this.log.warn(
        `[Quota] ${usage.calls}/${this.freeLimit} calls used in ${usage.month} — ` +
        `this run needs ${callsNeeded}, staying on simulator to protect the free tier`,
      );
    }

    if (routes.length > 0) {
      // === ROUTE-BASED mode: one Google call per route ===
      this.log.log(`Route-based simulation: ${routes.length} routes | Google: ${googleKey ? 'YES' : 'NO'}`);
      const updates: any[] = [];

      for (const r of routes) {
        const { delay, totalSeconds, freeFlowSeconds, source, polyline } =
          await this.fetchRouteTraffic(+r.origin_lat, +r.origin_lng, +r.dest_lat, +r.dest_lng);

        // Free: usual = this route's own average at the same weekday+hour
        const { usualSeconds, usualDelay } =
          await this.usualFromHistory('route_traffic_data', 'route_id', r.id, totalSeconds);

        const level = this.getLevel(delay);

        await this.db.query(
          `INSERT INTO route_traffic_data
             (time, route_id, junction_id, delay_minutes, usual_delay_minutes,
              total_seconds, usual_seconds, free_flow_seconds, congestion_level, source)
           VALUES (NOW(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [r.id, r.junction_id, delay, usualDelay, totalSeconds, usualSeconds, freeFlowSeconds, level, source],
        );

        // Remember the road shape on the route itself — it barely changes,
        // and the map draws the colored traffic line with it.
        if (polyline) {
          try {
            await this.db.query('UPDATE junction_routes SET polyline=$1 WHERE id=$2', [polyline, r.id]);
          } catch (e: any) {
            if (e.code !== '42703') throw e; // column not migrated yet — skip quietly
          }
        }

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
          polyline: polyline ?? r.polyline ?? null,
          time: new Date(),
        };
        updates.push(update);

        if (level === 'heavy') this.gateway.broadcastHeavyAlert(update);
      }

      this.gateway.broadcastTrafficUpdate(updates);
      const gCount = updates.filter(u => u.source === 'google').length;
      if (gCount > 0) this.addUsage(gCount); // 1 call per road
      const after = this.readUsage();
      this.log.log(
        `Routes updated: ${updates.length} | Google: ${gCount} | Simulator: ${updates.length - gCount}` +
        ` | Quota: ${after.calls}/${this.freeLimit} this month`,
      );
    } else {
      // === JUNCTION-POINT fallback: approximate 400m northeast segment ===
      this.log.log(`Junction-point simulation: ${this.junctions.length} junctions (no routes defined)`);
      const updates: any[] = [];

      for (const j of this.junctions) {
        const destLat = +j.lat + 0.002;
        const destLng = +j.lng + 0.002;
        const { delay, totalSeconds, freeFlowSeconds, source } =
          await this.fetchRouteTraffic(+j.lat, +j.lng, destLat, destLng);

        // Free: usual = this junction's own average at the same weekday+hour
        const { usualSeconds, usualDelay } =
          await this.usualFromHistory('traffic_data', 'junction_id', j.id, totalSeconds);

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
      const gCount = updates.filter(u => u.source === 'google').length;
      if (gCount > 0) this.addUsage(gCount); // 1 call per road
      const after = this.readUsage();
      this.log.log(
        `Junctions updated: ${updates.length} | Google: ${gCount} | Simulator: ${updates.length - gCount}` +
        ` | Quota: ${after.calls}/${this.freeLimit} this month`,
      );
    }
  }

  async runOnce() { await this.runSimulation(); }
}
