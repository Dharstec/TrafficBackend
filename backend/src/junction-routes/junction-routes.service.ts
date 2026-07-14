import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';

@Injectable()
export class JunctionRoutesService {
  constructor(@Inject(DB_POOL) private db: Pool) {}

  async findAll() {
    try { await this.db.query('SELECT 1 FROM junction_routes LIMIT 1'); }
    catch (e: any) { if (e.code === '42P01') return []; throw e; }
    const res = await this.db.query(`
      SELECT jr.*,
        j.name AS junction_name, j.short_name, j.station, j.district,
        (SELECT delay_minutes FROM route_traffic_data
         WHERE route_id = jr.id ORDER BY time DESC LIMIT 1) AS delay_minutes,
        (SELECT usual_delay_minutes FROM route_traffic_data
         WHERE route_id = jr.id ORDER BY time DESC LIMIT 1) AS usual_delay_minutes,
        (SELECT total_seconds FROM route_traffic_data
         WHERE route_id = jr.id ORDER BY time DESC LIMIT 1) AS total_seconds,
        (SELECT usual_seconds FROM route_traffic_data
         WHERE route_id = jr.id ORDER BY time DESC LIMIT 1) AS usual_seconds,
        (SELECT congestion_level FROM route_traffic_data
         WHERE route_id = jr.id ORDER BY time DESC LIMIT 1) AS congestion_level,
        (SELECT source FROM route_traffic_data
         WHERE route_id = jr.id ORDER BY time DESC LIMIT 1) AS source
      FROM junction_routes jr
      JOIN junctions j ON j.id = jr.junction_id
      WHERE jr.is_active = true
      ORDER BY j.id, jr.id
    `);
    return res.rows;
  }

  async findByJunction(junctionId: number) {
    try { await this.db.query('SELECT 1 FROM junction_routes LIMIT 1'); }
    catch (e: any) { if (e.code === '42P01') return []; throw e; }
    const res = await this.db.query(
      `SELECT jr.*,
        (SELECT delay_minutes FROM route_traffic_data WHERE route_id=jr.id ORDER BY time DESC LIMIT 1) AS delay_minutes,
        (SELECT congestion_level FROM route_traffic_data WHERE route_id=jr.id ORDER BY time DESC LIMIT 1) AS congestion_level
       FROM junction_routes jr
       WHERE jr.junction_id=$1 AND jr.is_active=true ORDER BY jr.id`,
      [junctionId],
    );
    return res.rows;
  }

  async create(data: any) {
    const res = await this.db.query(
      `INSERT INTO junction_routes
         (junction_id, coming_from, origin_lat, origin_lng, dest_lat, dest_lng)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.junction_id, data.coming_from, data.origin_lat, data.origin_lng,
       data.dest_lat, data.dest_lng],
    );
    return res.rows[0];
  }

  async update(id: number, data: any) {
    const res = await this.db.query(
      `UPDATE junction_routes
       SET coming_from=$1, origin_lat=$2, origin_lng=$3, dest_lat=$4, dest_lng=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [data.coming_from, data.origin_lat, data.origin_lng,
       data.dest_lat, data.dest_lng, data.is_active ?? true, id],
    );
    return res.rows[0];
  }

  async remove(id: number) {
    await this.db.query('UPDATE junction_routes SET is_active=false WHERE id=$1', [id]);
    return { success: true };
  }

  // Returns all active routes with origin/dest coords — used by simulator
  async findAllActive() {
    try { await this.db.query('SELECT 1 FROM junction_routes LIMIT 1'); }
    catch (e: any) { if (e.code === '42P01') return []; throw e; }
    const res = await this.db.query(`
      SELECT jr.id, jr.junction_id, jr.coming_from,
             jr.origin_lat, jr.origin_lng, jr.dest_lat, jr.dest_lng,
             j.name AS junction_name, j.short_name, j.station
      FROM junction_routes jr
      JOIN junctions j ON j.id = jr.junction_id
      WHERE jr.is_active = true AND j.is_active = true
      ORDER BY jr.id
    `);
    return res.rows;
  }

  async getLatestRouteTraffic() {
    try {
      const res = await this.db.query(`
        SELECT DISTINCT ON (rtd.route_id)
          rtd.*, jr.coming_from, jr.junction_id,
          j.name AS junction_name, j.short_name, j.station, j.district,
          j.lat AS junction_lat, j.lng AS junction_lng
        FROM route_traffic_data rtd
        JOIN junction_routes jr ON jr.id = rtd.route_id
        JOIN junctions j ON j.id = jr.junction_id
        WHERE jr.is_active = true AND j.is_active = true
        ORDER BY rtd.route_id, rtd.time DESC
      `);
      return res.rows;
    } catch (e: any) {
      // Tables not created yet — return empty, not 500
      if (e.code === '42P01') return [];
      throw e;
    }
  }
}
