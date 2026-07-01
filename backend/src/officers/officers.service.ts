import { Injectable, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class OfficersService {
  constructor(@Inject(DB_POOL) private db: Pool) {}

  async findAll() {
    const res = await this.db.query(`
      SELECT o.id, o.name, o.badge_number, o.phone, o.email, o.role,
             o.assigned_junction_id, o.is_active, o.created_at,
             j.name AS junction_name,
             ci.id AS active_checkin_id,
             ci.junction_id AS checked_in_junction_id,
             ci.check_in_time,
             cij.name AS checked_in_junction_name
      FROM officers o
      LEFT JOIN junctions j ON j.id = o.assigned_junction_id
      LEFT JOIN check_ins ci ON ci.officer_id = o.id AND ci.is_active = true
      LEFT JOIN junctions cij ON cij.id = ci.junction_id
      ORDER BY o.id
    `);
    return res.rows;
  }

  async findOne(id: number) {
    const res = await this.db.query(
      `SELECT o.*, j.name AS junction_name
       FROM officers o LEFT JOIN junctions j ON j.id=o.assigned_junction_id
       WHERE o.id=$1`,
      [id],
    );
    return res.rows[0];
  }

  async create(data: any) {
    if (!data.name || !data.badge_number || !data.email || !data.password) {
      throw new BadRequestException('name, badge_number, email and password are required');
    }

    // Validate assigned_junction_id exists if provided
    const junctionId = data.assigned_junction_id ? +data.assigned_junction_id : null;
    if (junctionId) {
      const jCheck = await this.db.query('SELECT id FROM junctions WHERE id=$1 AND is_active=true', [junctionId]);
      if (!jCheck.rows.length) throw new BadRequestException(`Junction with id ${junctionId} does not exist`);
    }

    const hash = await bcrypt.hash(data.password, 10);
    try {
      const res = await this.db.query(
        `INSERT INTO officers (name, badge_number, phone, email, password_hash, role, assigned_junction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, badge_number, email, role`,
        [data.name, data.badge_number, data.phone, data.email, hash, data.role || 'field_officer', junctionId],
      );
      return res.rows[0];
    } catch (e: any) {
      if (e.code === '23505') {
        const field = e.detail?.includes('badge_number') ? 'badge_number' : 'email';
        throw new ConflictException(`An officer with this ${field} already exists`);
      }
      throw e;
    }
  }

  async update(id: number, data: any) {
    const res = await this.db.query(
      `UPDATE officers SET name=$1, phone=$2, role=$3, assigned_junction_id=$4, is_active=$5
       WHERE id=$6 RETURNING id, name, badge_number, email, role`,
      [data.name, data.phone, data.role, data.assigned_junction_id || null, data.is_active, id],
    );
    return res.rows[0];
  }

  async updateLocation(officerId: number, lat: number, lng: number, accuracy?: number) {
    await this.db.query(
      `INSERT INTO officer_locations (time, officer_id, lat, lng, accuracy)
       VALUES (NOW(), $1, $2, $3, $4)`,
      [officerId, lat, lng, accuracy || null],
    );
  }

  async getLocationHistory(officerId: number, hours = 8) {
    const res = await this.db.query(
      `SELECT * FROM officer_locations
       WHERE officer_id=$1 AND time > NOW() - INTERVAL '${hours} hours'
       ORDER BY time DESC`,
      [officerId],
    );
    return res.rows;
  }

  async getActiveLiveLocations() {
    const res = await this.db.query(`
      SELECT DISTINCT ON (ol.officer_id)
        ol.officer_id, ol.lat, ol.lng, ol.time,
        o.name, o.badge_number, o.role,
        ci.junction_id AS checked_in_junction_id,
        j.name AS junction_name
      FROM officer_locations ol
      JOIN officers o ON o.id = ol.officer_id
      LEFT JOIN check_ins ci ON ci.officer_id = ol.officer_id AND ci.is_active = true
      LEFT JOIN junctions j ON j.id = ci.junction_id
      WHERE ol.time > NOW() - INTERVAL '5 minutes'
      ORDER BY ol.officer_id, ol.time DESC
    `);
    return res.rows;
  }
}
