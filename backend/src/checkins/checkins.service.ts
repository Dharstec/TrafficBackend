import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';

const HAVERSINE_SQL = `
  6371000 * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(lat - $1) / 2), 2) +
    COS(RADIANS($1)) * COS(RADIANS(lat)) *
    POWER(SIN(RADIANS(lng - $2) / 2), 2)
  ))
`;

@Injectable()
export class CheckinsService {
  constructor(@Inject(DB_POOL) private db: Pool) {}

  async autoCheckin(officerId: number, lat: number, lng: number) {
    const nearby = await this.db.query(
      `SELECT id, name, ${HAVERSINE_SQL} AS distance_meters
       FROM junctions
       WHERE is_active = true AND ${HAVERSINE_SQL} <= 200
       ORDER BY distance_meters ASC LIMIT 1`,
      [lat, lng, lat, lng],
    );
    if (!nearby.rows.length) return { checked_in: false, message: 'No junction within 200 meters' };

    const junction = nearby.rows[0];
    const existing = await this.db.query(
      `SELECT * FROM check_ins WHERE officer_id=$1 AND junction_id=$2 AND is_active=true`,
      [officerId, junction.id],
    );
    if (existing.rows.length) return { checked_in: true, already: true, junction, checkin: existing.rows[0] };

    await this.db.query(
      `UPDATE check_ins SET is_active=false, check_out_time=NOW(), check_out_type='auto' WHERE officer_id=$1 AND is_active=true`,
      [officerId],
    );
    const res = await this.db.query(
      `INSERT INTO check_ins (officer_id, junction_id, check_in_type, lat, lng) VALUES ($1,$2,'auto',$3,$4) RETURNING *`,
      [officerId, junction.id, lat, lng],
    );
    return { checked_in: true, junction, checkin: res.rows[0] };
  }

  async manualCheckin(officerId: number, junctionId: number, lat: number, lng: number) {
    await this.db.query(
      `UPDATE check_ins SET is_active=false, check_out_time=NOW(), check_out_type='auto' WHERE officer_id=$1 AND is_active=true`,
      [officerId],
    );
    const res = await this.db.query(
      `INSERT INTO check_ins (officer_id, junction_id, check_in_type, lat, lng) VALUES ($1,$2,'manual',$3,$4) RETURNING *`,
      [officerId, junctionId, lat, lng],
    );
    const junction = await this.db.query('SELECT * FROM junctions WHERE id=$1', [junctionId]);
    return { checked_in: true, junction: junction.rows[0], checkin: res.rows[0] };
  }

  async autoCheckout(officerId: number, lat: number, lng: number) {
    const active = await this.db.query(
      `SELECT ci.*, j.lat AS jlat, j.lng AS jlng FROM check_ins ci JOIN junctions j ON j.id=ci.junction_id WHERE ci.officer_id=$1 AND ci.is_active=true`,
      [officerId],
    );
    if (!active.rows.length) return { checked_out: false, message: 'No active checkin' };

    const row = active.rows[0];
    const dist = haversineMeters(lat, lng, +row.jlat, +row.jlng);
    if (dist <= 200) return { checked_out: false, message: 'Still within 200 meters' };

    await this.db.query(
      `UPDATE check_ins SET is_active=false, check_out_time=NOW(), check_out_type='auto' WHERE officer_id=$1 AND is_active=true`,
      [officerId],
    );
    return { checked_out: true, distance: Math.round(dist) };
  }

  async manualCheckout(officerId: number) {
    await this.db.query(
      `UPDATE check_ins SET is_active=false, check_out_time=NOW(), check_out_type='manual' WHERE officer_id=$1 AND is_active=true`,
      [officerId],
    );
    return { checked_out: true };
  }

  async saveDeviceStatus(officerId: number, checkinId: number, devices: any) {
    await this.db.query(
      `INSERT INTO device_checkins (checkin_id, officer_id, breath_analyzer, body_camera, signal_remote, challan_machine)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [checkinId, officerId, devices.breath_analyzer, devices.body_camera, devices.signal_remote, devices.challan_machine],
    );
    return { saved: true };
  }

  async getActiveCheckins() {
    const res = await this.db.query(`
      SELECT ci.*, o.name AS officer_name, o.badge_number, j.name AS junction_name, j.lat, j.lng
      FROM check_ins ci
      JOIN officers o ON o.id=ci.officer_id
      JOIN junctions j ON j.id=ci.junction_id
      WHERE ci.is_active=true
      ORDER BY ci.check_in_time DESC
    `);
    return res.rows;
  }

  async getMyCheckins(officerId: number, limit = 20) {
    const res = await this.db.query(
      `SELECT ci.*, j.name AS junction_name
       FROM check_ins ci JOIN junctions j ON j.id=ci.junction_id
       WHERE ci.officer_id=$1 ORDER BY ci.check_in_time DESC LIMIT $2`,
      [officerId, limit],
    );
    return res.rows;
  }

  async getActiveCheckin(officerId: number) {
    const res = await this.db.query(
      `SELECT ci.*, j.name AS junction_name, j.lat, j.lng,
         ROUND(EXTRACT(EPOCH FROM (NOW() - ci.check_in_time))/60) AS minutes_at_junction
       FROM check_ins ci JOIN junctions j ON j.id=ci.junction_id
       WHERE ci.officer_id=$1 AND ci.is_active=true`,
      [officerId],
    );
    return res.rows[0] || null;
  }

  // Today's full duty log for an officer — all check-ins with duration
  async getTodayDuty(officerId: number) {
    const res = await this.db.query(
      `SELECT
         ci.id, ci.junction_id, ci.check_in_time, ci.check_out_time,
         ci.check_in_type, ci.check_out_type, ci.is_active,
         j.name AS junction_name, j.short_name,
         ROUND(EXTRACT(EPOCH FROM (COALESCE(ci.check_out_time, NOW()) - ci.check_in_time))/60) AS duration_minutes
       FROM check_ins ci
       JOIN junctions j ON j.id=ci.junction_id
       WHERE ci.officer_id=$1 AND ci.check_in_time >= CURRENT_DATE
       ORDER BY ci.check_in_time ASC`,
      [officerId],
    );
    return res.rows;
  }

  // All officers' today duty — for supervisor view
  async getAllTodayDuty() {
    const res = await this.db.query(`
      SELECT
        ci.id, ci.officer_id, ci.junction_id, ci.check_in_time, ci.check_out_time,
        ci.check_in_type, ci.check_out_type, ci.is_active,
        o.name AS officer_name, o.badge_number, o.phone,
        j.name AS junction_name, j.short_name,
        ROUND(EXTRACT(EPOCH FROM (COALESCE(ci.check_out_time, NOW()) - ci.check_in_time))/60) AS duration_minutes
      FROM check_ins ci
      JOIN officers o ON o.id=ci.officer_id
      JOIN junctions j ON j.id=ci.junction_id
      WHERE ci.check_in_time >= CURRENT_DATE
      ORDER BY ci.check_in_time DESC
    `);
    return res.rows;
  }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg: number) { return deg * Math.PI / 180; }
