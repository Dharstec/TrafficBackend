import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';

@Injectable()
export class JunctionsService {
  constructor(@Inject(DB_POOL) private db: Pool) {}

  async findAll() {
    const res = await this.db.query(`
      SELECT j.*,
        (SELECT delay_minutes FROM traffic_data WHERE junction_id=j.id ORDER BY time DESC LIMIT 1) AS current_delay,
        (SELECT congestion_level FROM traffic_data WHERE junction_id=j.id ORDER BY time DESC LIMIT 1) AS current_congestion,
        (SELECT COUNT(*) FROM check_ins WHERE junction_id=j.id AND is_active=true) AS active_officers
      FROM junctions j WHERE j.is_active=true ORDER BY j.id
    `);
    return res.rows;
  }

  async findOne(id: number) {
    const res = await this.db.query('SELECT * FROM junctions WHERE id=$1', [id]);
    return res.rows[0];
  }

  async create(data: any) {
    const res = await this.db.query(
      `INSERT INTO junctions (name, short_name, district, sub_division, station, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [data.name, data.short_name, data.district, data.sub_division, data.station, data.lat, data.lng],
    );
    return res.rows[0];
  }

  async update(id: number, data: any) {
    const res = await this.db.query(
      `UPDATE junctions SET name=$1, short_name=$2, district=$3, sub_division=$4, station=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [data.name, data.short_name, data.district, data.sub_division, data.station, data.is_active, id],
    );
    return res.rows[0];
  }

  async setTestJunction(lat: number, lng: number) {
    // Delete old test junction if exists, then create fresh one at current GPS
    await this.db.query(`DELETE FROM check_ins WHERE junction_id IN (SELECT id FROM junctions WHERE short_name='TEST-HERE')`);
    await this.db.query(`DELETE FROM traffic_data WHERE junction_id IN (SELECT id FROM junctions WHERE short_name='TEST-HERE')`);
    await this.db.query(`DELETE FROM junctions WHERE short_name='TEST-HERE'`);

    const res = await this.db.query(
      `INSERT INTO junctions (name, short_name, district, sub_division, station, lat, lng)
       VALUES ('My Test Junction (Current Location)', 'TEST-HERE', 'Coimbatore', 'Test', 'My Location', $1, $2)
       RETURNING *`,
      [lat, lng],
    );

    // Seed one traffic reading so it shows on map/dashboard
    await this.db.query(
      `INSERT INTO traffic_data (time, junction_id, delay_minutes, congestion_level, source)
       VALUES (NOW(), $1, 3, 'normal', 'test')`,
      [res.rows[0].id],
    );

    return { junction: res.rows[0], message: `Test junction created at ${lat}, ${lng}` };
  }

  async remove(id: number) {
    await this.db.query('UPDATE junctions SET is_active=false WHERE id=$1', [id]);
    return { success: true };
  }

  async findNearby(lat: number, lng: number, radiusMeters = 200) {
    // Haversine formula in SQL — no PostGIS needed
    const res = await this.db.query(
      `SELECT *,
         6371000 * 2 * ASIN(SQRT(
           POWER(SIN(RADIANS(lat - $1) / 2), 2) +
           COS(RADIANS($1)) * COS(RADIANS(lat)) *
           POWER(SIN(RADIANS(lng - $2) / 2), 2)
         )) AS distance_meters
       FROM junctions
       WHERE is_active=true
         AND 6371000 * 2 * ASIN(SQRT(
           POWER(SIN(RADIANS(lat - $1) / 2), 2) +
           COS(RADIANS($1)) * COS(RADIANS(lat)) *
           POWER(SIN(RADIANS(lng - $2) / 2), 2)
         )) <= $3
       ORDER BY distance_meters ASC`,
      [lat, lng, radiusMeters],
    );
    return res.rows;
  }
}
