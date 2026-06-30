import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { DB_POOL } from '../database/database.module';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_POOL) private db: Pool,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const res = await this.db.query('SELECT * FROM officers WHERE email=$1 AND is_active=true', [email]);
    const officer = res.rows[0];
    if (!officer) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, officer.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const payload = { sub: officer.id, email: officer.email, role: officer.role };
    return {
      access_token: this.jwt.sign(payload),
      officer: {
        id: officer.id,
        name: officer.name,
        email: officer.email,
        role: officer.role,
        badge_number: officer.badge_number,
        assigned_junction_id: officer.assigned_junction_id,
      },
    };
  }

  async hashPassword(password: string) {
    return bcrypt.hash(password, 10);
  }
}
