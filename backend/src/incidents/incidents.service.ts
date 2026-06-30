import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';

@Injectable()
export class IncidentsService {
  constructor(@Inject(DB_POOL) private db: Pool) {}

  async findAll(status?: string) {
    const filter = status ? 'WHERE i.status=$1' : '';
    const params = status ? [status] : [];
    const res = await this.db.query(
      `SELECT i.*, o.name AS officer_name, o.badge_number, j.name AS junction_name
       FROM incidents i
       JOIN officers o ON o.id=i.officer_id
       LEFT JOIN junctions j ON j.id=i.junction_id
       ${filter} ORDER BY i.created_at DESC`,
      params,
    );
    return res.rows;
  }

  async create(officerId: number, data: any) {
    const res = await this.db.query(
      `INSERT INTO incidents (officer_id, junction_id, type, description, photo_url)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [officerId, data.junction_id || null, data.type, data.description, data.photo_url || null],
    );
    return res.rows[0];
  }

  async resolve(id: number, resolvedBy: number) {
    const res = await this.db.query(
      `UPDATE incidents SET status='resolved', resolved_at=NOW(), resolved_by=$1
       WHERE id=$2 RETURNING *`,
      [resolvedBy, id],
    );
    return res.rows[0];
  }

  async updateStatus(id: number, status: string) {
    const res = await this.db.query(
      `UPDATE incidents SET status=$1 WHERE id=$2 RETURNING *`,
      [status, id],
    );
    return res.rows[0];
  }
}
