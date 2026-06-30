-- EC2 full database setup — run once on EC2
-- password for ALL officers: password123

-- =====================
-- Tables
-- =====================
CREATE TABLE IF NOT EXISTS junctions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  short_name VARCHAR(100),
  district VARCHAR(100) DEFAULT 'Coimbatore',
  sub_division VARCHAR(100),
  station VARCHAR(100),
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS traffic_data (
  id SERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  junction_id INTEGER NOT NULL,
  delay_minutes DECIMAL(5,2) NOT NULL DEFAULT 0,
  congestion_level VARCHAR(20) NOT NULL DEFAULT 'usual',
  coming_from VARCHAR(255),
  going_to VARCHAR(255),
  speed_kmh DECIMAL(5,2),
  source VARCHAR(50) DEFAULT 'simulator'
);

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

CREATE TABLE IF NOT EXISTS officer_locations (
  id SERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  officer_id INTEGER NOT NULL,
  lat DECIMAL(10, 7) NOT NULL,
  lng DECIMAL(10, 7) NOT NULL,
  accuracy DECIMAL(8,2),
  speed DECIMAL(8,2)
);

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_junctions_lat_lng ON junctions (lat, lng);
CREATE INDEX IF NOT EXISTS idx_traffic_junction_time ON traffic_data (junction_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_officer_loc_time ON officer_locations (officer_id, time DESC);

-- =====================
-- Seed: 5 Coimbatore Junctions
-- =====================
INSERT INTO junctions (name, short_name, district, sub_division, station, lat, lng) VALUES
('Gandhipuram Central Bus Stand Junction', 'Gandhipuram-CBS', 'Coimbatore', 'Central',  'Gandhipuram',    11.0170, 76.9558),
('Race Course Road X Avinashi Road Junction','RCR-Avinashi',  'Coimbatore', 'Central',  'Race Course',    11.0093, 76.9630),
('RS Puram DB Road X Shanmugam Road Jn',    'RSPuram-DB',    'Coimbatore', 'West',     'RS Puram',       11.0064, 76.9547),
('Saibaba Colony Main Road Junction',        'Saibaba-Colony','Coimbatore', 'North',    'Saibaba Colony', 11.0241, 76.9638),
('Peelamedu Junction (Airport Road)',        'Peelamedu',     'Coimbatore', 'East',     'Peelamedu',      11.0243, 77.0270)
ON CONFLICT DO NOTHING;

-- =====================
-- Seed: Officers  (ALL password: password123)
-- hash = $2b$10$XF9mLCy5ggYje5jMTxx/Fe3uDIT6ajHZ59wljISzF9/6i8zEEr0Ky
-- =====================
INSERT INTO officers (name, badge_number, phone, email, password_hash, role) VALUES
('Admin User',       'ADM001', '9999900001', 'admin@gctp.gov.in',      '$2b$10$XF9mLCy5ggYje5jMTxx/Fe3uDIT6ajHZ59wljISzF9/6i8zEEr0Ky', 'admin'),
('Supervisor Kumar', 'SUP001', '9999900002', 'supervisor@gctp.gov.in', '$2b$10$XF9mLCy5ggYje5jMTxx/Fe3uDIT6ajHZ59wljISzF9/6i8zEEr0Ky', 'supervisor')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

INSERT INTO officers (name, badge_number, phone, email, password_hash, role, assigned_junction_id) VALUES
('Officer Ravi',    'FO001', '9999900003', 'ravi@gctp.gov.in',    '$2b$10$XF9mLCy5ggYje5jMTxx/Fe3uDIT6ajHZ59wljISzF9/6i8zEEr0Ky', 'field_officer', 1),
('Officer Priya',   'FO002', '9999900004', 'priya@gctp.gov.in',   '$2b$10$XF9mLCy5ggYje5jMTxx/Fe3uDIT6ajHZ59wljISzF9/6i8zEEr0Ky', 'field_officer', 2),
('Officer Senthil', 'FO003', '9999900005', 'senthil@gctp.gov.in', '$2b$10$XF9mLCy5ggYje5jMTxx/Fe3uDIT6ajHZ59wljISzF9/6i8zEEr0Ky', 'field_officer', 3)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- =====================
-- Seed: Initial traffic data for each junction
-- =====================
INSERT INTO traffic_data (junction_id, delay_minutes, congestion_level, speed_kmh, source)
SELECT id, 3, 'normal', 30, 'seed' FROM junctions ON CONFLICT DO NOTHING;

SELECT 'Setup complete!' AS status;
SELECT id, email, role FROM officers;
SELECT id, short_name, lat, lng FROM junctions;
