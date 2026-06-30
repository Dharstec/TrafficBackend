-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Junctions table (5 real Chennai junctions for demo)
CREATE TABLE IF NOT EXISTS junctions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(100),
  district VARCHAR(100) DEFAULT 'Chennai',
  sub_division VARCHAR(100),
  station VARCHAR(100),
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  location GEOMETRY(POINT, 4326),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_junctions_location ON junctions USING GIST(location);

-- Traffic data hypertable (time-series)
CREATE TABLE IF NOT EXISTS traffic_data (
  time TIMESTAMPTZ NOT NULL,
  junction_id INTEGER NOT NULL,
  delay_minutes DECIMAL(5,2) NOT NULL DEFAULT 0,
  congestion_level VARCHAR(20) NOT NULL DEFAULT 'usual',
  coming_from VARCHAR(255),
  going_to VARCHAR(255),
  speed_kmh DECIMAL(5,2),
  source VARCHAR(50) DEFAULT 'simulator'
);
SELECT create_hypertable('traffic_data', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_traffic_junction_time ON traffic_data (junction_id, time DESC);

-- Officers table
CREATE TABLE IF NOT EXISTS officers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  badge_number VARCHAR(50) UNIQUE NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'field_officer',
  assigned_junction_id INTEGER REFERENCES junctions(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Officer GPS location history (hypertable)
CREATE TABLE IF NOT EXISTS officer_locations (
  time TIMESTAMPTZ NOT NULL,
  officer_id INTEGER NOT NULL,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  location GEOMETRY(POINT, 4326),
  accuracy DECIMAL(8,2),
  speed DECIMAL(8,2)
);
SELECT create_hypertable('officer_locations', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_officer_loc_time ON officer_locations (officer_id, time DESC);

-- Check-ins table
CREATE TABLE IF NOT EXISTS check_ins (
  id SERIAL PRIMARY KEY,
  officer_id INTEGER NOT NULL REFERENCES officers(id),
  junction_id INTEGER NOT NULL REFERENCES junctions(id),
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  check_out_time TIMESTAMPTZ,
  check_in_type VARCHAR(20) DEFAULT 'auto',
  check_out_type VARCHAR(20),
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  is_active BOOLEAN DEFAULT true
);

-- Device status at check-in
CREATE TABLE IF NOT EXISTS device_checkins (
  id SERIAL PRIMARY KEY,
  checkin_id INTEGER REFERENCES check_ins(id),
  officer_id INTEGER REFERENCES officers(id),
  breath_analyzer BOOLEAN DEFAULT false,
  body_camera BOOLEAN DEFAULT false,
  signal_remote BOOLEAN DEFAULT false,
  challan_machine BOOLEAN DEFAULT false,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Incidents / reports
CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  officer_id INTEGER REFERENCES officers(id),
  junction_id INTEGER REFERENCES junctions(id),
  type VARCHAR(50) NOT NULL,
  description TEXT,
  photo_url VARCHAR(500),
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES officers(id)
);

-- =====================
-- Seed Data
-- =====================

-- 5 Chennai Junctions
INSERT INTO junctions (name, short_name, district, sub_division, station, lat, lng, location) VALUES
('Velachery Main Road X Gandhi Road Jn', 'Velachery-Gandhi', 'Chennai', 'South', 'Velachery', 13.0058, 80.2133, ST_SetSRID(ST_MakePoint(80.2133, 13.0058), 4326)),
('200 Feet Road - Rajeev Gandhi Salai X Radial Rd', '200ft-RGS', 'Chennai', 'South', 'Thoraipakkam', 12.9716, 80.2444, ST_SetSRID(ST_MakePoint(80.2444, 12.9716), 4326)),
('Velachery Main Rd X Maduvankarai Jn (Five Furlong)', 'Velachery-5Furlong', 'Chennai', 'South', 'Guindy', 13.0001, 80.2244, ST_SetSRID(ST_MakePoint(80.2244, 13.0001), 4326)),
('100 Ft Rd X Ashok Pillar', 'Ashok Pillar', 'Chennai', 'Central', 'Ashok Nagar', 13.0387, 80.2070, ST_SetSRID(ST_MakePoint(80.2070, 13.0387), 4326)),
('EVR Salai X NM Rd Jn (Sky Walk)', 'EVR-NM', 'Chennai', 'Central', 'Aminjikarai', 13.0665, 80.2337, ST_SetSRID(ST_MakePoint(80.2337, 13.0665), 4326))
ON CONFLICT DO NOTHING;

-- Admin user (password: Admin@123)
INSERT INTO officers (name, badge_number, phone, email, password_hash, role) VALUES
('Admin User', 'ADM001', '9999900001', 'admin@gctp.gov.in', '$2b$10$rQnK9V8QlF3mZvN2pX7Y4OqJmKsLdE8WnCfG6TaHbIuVxRyMzP1.e', 'admin')
ON CONFLICT DO NOTHING;

-- Supervisor (password: Super@123)
INSERT INTO officers (name, badge_number, phone, email, password_hash, role) VALUES
('Supervisor Kumar', 'SUP001', '9999900002', 'supervisor@gctp.gov.in', '$2b$10$rQnK9V8QlF3mZvN2pX7Y4OqJmKsLdE8WnCfG6TaHbIuVxRyMzP1.e', 'supervisor')
ON CONFLICT DO NOTHING;

-- Field Officers (password: Field@123)
INSERT INTO officers (name, badge_number, phone, email, password_hash, role, assigned_junction_id) VALUES
('Officer Ravi', 'FO001', '9999900003', 'ravi@gctp.gov.in', '$2b$10$rQnK9V8QlF3mZvN2pX7Y4OqJmKsLdE8WnCfG6TaHbIuVxRyMzP1.e', 'field_officer', 1),
('Officer Priya', 'FO002', '9999900004', 'priya@gctp.gov.in', '$2b$10$rQnK9V8QlF3mZvN2pX7Y4OqJmKsLdE8WnCfG6TaHbIuVxRyMzP1.e', 'field_officer', 2),
('Officer Senthil', 'FO003', '9999900005', 'senthil@gctp.gov.in', '$2b$10$rQnK9V8QlF3mZvN2pX7Y4OqJmKsLdE8WnCfG6TaHbIuVxRyMzP1.e', 'field_officer', 3)
ON CONFLICT DO NOTHING;
