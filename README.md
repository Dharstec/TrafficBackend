# GCTP Traffic Monitoring System — Demo

## Stack
- **Backend**: Node.js (NestJS) + Socket.io  
- **Web**: Angular 17 + Leaflet maps  
- **Mobile**: Ionic 7 (Angular) + Capacitor  
- **Database**: PostgreSQL + TimescaleDB + PostGIS  

## Demo Data
- 5 Chennai junctions (real coordinates)
- Traffic simulator runs every 5 minutes automatically
- Congestion colors: Green (1-2 min), Orange (3-5 min), Red (6-9 min), Dark Red (10+ min)

---

## Step 1 — Start Database

```bash
docker compose up -d db
```

Wait ~20 seconds for TimescaleDB to initialize and run init.sql.

---

## Step 2 — Start Backend

```bash
cd backend
npm install
npm run start:dev
```

Backend runs at: http://localhost:3000  
API docs base: http://localhost:3000/api

---

## Step 3 — Start Web App

```bash
cd web
npm install
npm start
```

Web runs at: http://localhost:4200

---

## Step 4 — Start Mobile App (Browser)

```bash
cd mobile
npm install
npm start
```

Mobile runs at: http://localhost:8100

---

## Login Credentials

| Role         | Email                        | Password   |
|--------------|------------------------------|------------|
| Admin        | admin@gctp.gov.in            | Admin@123  |
| Supervisor   | supervisor@gctp.gov.in       | Admin@123  |
| Field Officer| ravi@gctp.gov.in             | Field@123  |
| Field Officer| priya@gctp.gov.in            | Field@123  |

---

## Features Covered

### Web Dashboard
- Live monitor with real-time congestion list + map
- City map view with color-coded circles (bubble size = severity)
- Congestion snapshot — pick any date/time
- Weekly congestion reports
- Junction/Signal management (CRUD)
- Traffic Police management + incident tracking

### Mobile App (Ionic)
- Field Officer login
- **Auto check-in**: GPS detects junction within 200m → auto checks in
- **Auto checkout**: GPS detects officer moved beyond 200m → auto checks out
- Device status check (Breath Analyzer, Body Camera, Signal Remote, Challan Machine)
- Manual check-in override
- Junction list view with real-time congestion status
- Map view showing all junctions + officer's own location
- Incident reporting (device malfunction, road condition, contradiction)

### Backend API
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login |
| GET | /api/junctions | All junctions + current status |
| GET | /api/junctions/nearby?lat=&lng=&radius=200 | PostGIS 200m query |
| GET | /api/traffic/latest | Latest congestion per junction |
| GET | /api/traffic/history | TimescaleDB history |
| GET | /api/traffic/snapshot | Congestion at specific date/time |
| GET | /api/traffic/report/weekly | Weekly summary |
| POST | /api/checkins/auto | Auto check-in with PostGIS |
| POST | /api/checkins/auto-checkout | Auto checkout |
| GET | /api/officers/live-locations | Active officer GPS positions |
| POST | /api/incidents | Submit incident |
| WS | ws://localhost:3000 | Real-time traffic + officer updates |

---

## Scale to 300 Junctions / 1000 Officers
The code is ready for production scale:
1. Replace `simulator.service.ts` `simulateDelay()` with real Google Maps Routes API call
2. Increase junction count in the DB seed
3. Add Redis for WebSocket scaling (Socket.io adapter)
4. Deploy DB on TimescaleDB Cloud

---

## Architecture

```
Browser/Mobile  ←→  NestJS (REST + WebSocket)  ←→  PostgreSQL
                                                     ├── TimescaleDB (traffic_data, officer_locations)
                                                     └── PostGIS (200m geofencing queries)
```
