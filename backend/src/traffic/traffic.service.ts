import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';
import { TrafficGateway } from '../gateway/traffic.gateway';

@Injectable()
export class TrafficService {
  constructor(
    @Inject(DB_POOL) private db: Pool,
    private gateway: TrafficGateway,
  ) {}

  async getLatestRouteTraffic() {
    const query = (withPolyline: boolean) => `
      SELECT DISTINCT ON (rtd.route_id)
        rtd.*, jr.coming_from, jr.junction_id,
        jr.origin_lat, jr.origin_lng, jr.dest_lat, jr.dest_lng,
        ${withPolyline ? 'jr.polyline,' : ''}
        j.name AS junction_name, j.short_name, j.station, j.district,
        j.lat AS junction_lat, j.lng AS junction_lng
      FROM route_traffic_data rtd
      JOIN junction_routes jr ON jr.id = rtd.route_id
      JOIN junctions j ON j.id = jr.junction_id
      WHERE jr.is_active = true AND j.is_active = true
      ORDER BY rtd.route_id, rtd.time DESC
    `;
    try {
      return (await this.db.query(query(true))).rows;
    } catch (e: any) {
      if (e.code === '42P01') return [];
      // polyline column not migrated yet — serve data without road shapes
      if (e.code === '42703') return (await this.db.query(query(false))).rows;
      throw e;
    }
  }

  async getLatest() {
    // Deleted (deactivated) junctions must not appear on the live monitor,
    // and neither should their old history rows.
    const res = await this.db.query(`
      SELECT DISTINCT ON (junction_id)
        td.*, j.name AS junction_name, j.lat, j.lng, j.district, j.sub_division, j.station
      FROM traffic_data td
      JOIN junctions j ON j.id = td.junction_id
      WHERE j.is_active = true
      ORDER BY junction_id, time DESC
    `);
    return res.rows;
  }

  async getByJunction(junctionId: number, hours = 24) {
    const res = await this.db.query(
      `SELECT * FROM traffic_data
       WHERE junction_id=$1 AND time > NOW() - INTERVAL '${hours} hours'
       ORDER BY time DESC`,
      [junctionId],
    );
    return res.rows;
  }

  async getHistory(junctionId: number, startDate: string, endDate: string) {
    const res = await this.db.query(
      `SELECT time_bucket('5 minutes', time) AS bucket,
              AVG(delay_minutes) AS avg_delay,
              MAX(delay_minutes) AS max_delay,
              mode() WITHIN GROUP (ORDER BY congestion_level) AS congestion_level,
              junction_id
       FROM traffic_data
       WHERE junction_id=$1 AND time BETWEEN $2 AND $3
       GROUP BY bucket, junction_id
       ORDER BY bucket DESC`,
      [junctionId, startDate, endDate],
    );
    return res.rows;
  }

  async getCongestionSnapshot(date: string, time: string) {
    const ts = `${date} ${time}`;
    const res = await this.db.query(
      `SELECT DISTINCT ON (junction_id)
         td.*, j.name AS junction_name, j.lat, j.lng
       FROM traffic_data td
       JOIN junctions j ON j.id = td.junction_id
       WHERE td.time <= $1::timestamptz AND j.is_active = true
       ORDER BY junction_id, time DESC`,
      [ts],
    );
    return res.rows;
  }

  async getWeeklyReport(junctionId?: number) {
    const filter = junctionId ? 'AND junction_id=$1' : '';
    const params = junctionId ? [junctionId] : [];
    const res = await this.db.query(
      `SELECT junction_id,
              date_trunc('day', time) AS day,
              AVG(delay_minutes) AS avg_delay,
              MAX(delay_minutes) AS peak_delay,
              COUNT(*) AS readings,
              j.name AS junction_name
       FROM traffic_data td
       JOIN junctions j ON j.id=td.junction_id
       WHERE time > NOW() - INTERVAL '7 days' AND j.is_active = true ${filter}
       GROUP BY junction_id, day, j.name
       ORDER BY day DESC, avg_delay DESC`,
      params,
    );
    return res.rows;
  }

  async insertTrafficData(data: {
    junction_id: number;
    delay_minutes: number;
    coming_from?: string;
    going_to?: string;
    speed_kmh?: number;
  }) {
    const level = this.getLevel(data.delay_minutes);
    await this.db.query(
      `INSERT INTO traffic_data (time, junction_id, delay_minutes, congestion_level, coming_from, going_to, speed_kmh)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6)`,
      [data.junction_id, data.delay_minutes, level, data.coming_from, data.going_to, data.speed_kmh],
    );
  }

  // Officer reports traffic is clear at their junction
  async clearTraffic(officerId: number, junctionId: number) {
    const j = await this.db.query('SELECT name, short_name FROM junctions WHERE id=$1', [junctionId]);
    await this.db.query(
      `INSERT INTO traffic_data (junction_id, delay_minutes, congestion_level, speed_kmh, source)
       VALUES ($1, 1, 'usual', 55, 'officer_clear')`,
      [junctionId],
    );
    const update = { junction_id: junctionId, delay_minutes: 1, congestion_level: 'usual', speed_kmh: 55, time: new Date() };
    this.gateway.broadcastTrafficUpdate([update]);
    this.gateway.broadcastTrafficCleared({ ...update, junction_name: j.rows[0]?.name, cleared_by: officerId });
    return { cleared: true, junction_id: junctionId };
  }

  // Supervisor acknowledges alert for a junction
  async acknowledgeAlert(junctionId: number, supervisorId: number) {
    return { acknowledged: true, junction_id: junctionId, by: supervisorId };
  }

  getLevel(delay: number): string {
    if (delay <= 2) return 'usual';
    if (delay <= 5) return 'normal';
    if (delay <= 9) return 'intermediate';
    return 'heavy';
  }
}
