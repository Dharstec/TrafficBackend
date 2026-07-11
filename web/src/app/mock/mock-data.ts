// Dummy data used across the app when environment.useMockData = true.
// Lets the whole UI be exercised without a running backend or login.

export const MOCK_USER = {
  id: 1,
  name: 'Demo Admin',
  badge_number: 'ADMIN001',
  email: 'admin@demo.local',
  role: 'admin',
};

export const MOCK_JUNCTIONS: any[] = [
  {
    id: 1, name: 'Gandhipuram Junction', short_name: 'Gandhipuram',
    district: 'Coimbatore', sub_division: 'Coimbatore City', station: 'Gandhipuram PS',
    lat: 11.0168, lng: 76.9558, is_active: true,
    current_congestion: 'heavy', current_delay: 12.4, active_officers: 2, assigned_officers: 3,
  },
  {
    id: 2, name: 'Ukkadam Junction', short_name: 'Ukkadam',
    district: 'Coimbatore', sub_division: 'Coimbatore City', station: 'Ukkadam PS',
    lat: 11.0016, lng: 76.9663, is_active: true,
    current_congestion: 'intermediate', current_delay: 7.8, active_officers: 1, assigned_officers: 2,
  },
  {
    id: 3, name: 'Peelamedu Junction', short_name: 'Peelamedu',
    district: 'Coimbatore', sub_division: 'Coimbatore City', station: 'Peelamedu PS',
    lat: 11.0296, lng: 77.0266, is_active: true,
    current_congestion: 'normal', current_delay: 4.2, active_officers: 1, assigned_officers: 1,
  },
  {
    id: 4, name: 'Race Course Junction', short_name: 'RaceCourse',
    district: 'Coimbatore', sub_division: 'Coimbatore City', station: 'RS Puram PS',
    lat: 11.0041, lng: 76.9642, is_active: true,
    current_congestion: 'usual', current_delay: 1.6, active_officers: 0, assigned_officers: 1,
  },
  {
    id: 5, name: 'Singanallur Junction', short_name: 'Singanallur',
    district: 'Coimbatore', sub_division: 'Coimbatore City', station: 'Singanallur PS',
    lat: 11.0011, lng: 77.0294, is_active: true,
    current_congestion: 'heavy', current_delay: 14.1, active_officers: 2, assigned_officers: 2,
  },
  {
    id: 6, name: 'Town Hall Junction', short_name: 'TownHall',
    district: 'Coimbatore', sub_division: 'Coimbatore City', station: 'Town Hall PS',
    lat: 11.0018, lng: 76.9629, is_active: false,
    current_congestion: null, current_delay: null, active_officers: 0, assigned_officers: 0,
  },
];

export const MOCK_OFFICERS: any[] = [
  { id: 1, name: 'Demo Admin', badge_number: 'ADMIN001', phone: '9876500001', email: 'admin@demo.local', role: 'admin', assigned_junction_id: null, junction_name: null, is_active: true, checked_in_junction_name: null },
  { id: 2, name: 'Karthik R', badge_number: 'FO001', phone: '9876500002', email: 'karthik@demo.local', role: 'field_officer', assigned_junction_id: 1, junction_name: 'Gandhipuram Junction', is_active: true, checked_in_junction_name: 'Gandhipuram Junction' },
  { id: 3, name: 'Priya S', badge_number: 'FO002', phone: '9876500003', email: 'priya@demo.local', role: 'field_officer', assigned_junction_id: 2, junction_name: 'Ukkadam Junction', is_active: true, checked_in_junction_name: 'Ukkadam Junction' },
  { id: 4, name: 'Manikandan V', badge_number: 'FO003', phone: '9876500004', email: 'mani@demo.local', role: 'field_officer', assigned_junction_id: 3, junction_name: 'Peelamedu Junction', is_active: true, checked_in_junction_name: null },
  { id: 5, name: 'Divya M', badge_number: 'SUP001', phone: '9876500005', email: 'divya@demo.local', role: 'supervisor', assigned_junction_id: 5, junction_name: 'Singanallur Junction', is_active: true, checked_in_junction_name: 'Singanallur Junction' },
  { id: 6, name: 'Suresh Kumar', badge_number: 'FO004', phone: '9876500006', email: 'suresh@demo.local', role: 'field_officer', assigned_junction_id: 4, junction_name: 'Race Course Junction', is_active: false, checked_in_junction_name: null },
];

export const MOCK_LIVE_LOCATIONS: any[] = [
  { officer_id: 2, name: 'Karthik R', badge_number: 'FO001', lat: 11.0168, lng: 76.9558, junction_name: 'Gandhipuram Junction', time: new Date().toISOString() },
  { officer_id: 3, name: 'Priya S', badge_number: 'FO002', lat: 11.0016, lng: 76.9663, junction_name: 'Ukkadam Junction', time: new Date().toISOString() },
  { officer_id: 5, name: 'Divya M', badge_number: 'SUP001', lat: 11.0011, lng: 77.0294, junction_name: 'Singanallur Junction', time: new Date().toISOString() },
  { officer_id: 4, name: 'Manikandan V', badge_number: 'FO003', lat: 11.031, lng: 77.021, junction_name: null, time: new Date().toISOString() },
];

const today = new Date().toISOString().split('T')[0];
export const MOCK_TODAY_DUTY: any[] = [
  { officer_name: 'Karthik R', badge_number: 'FO001', short_name: 'Gandhipuram', check_in_time: `${today}T08:05:00`, check_out_time: null, duration_minutes: 245, is_active: true },
  { officer_name: 'Priya S', badge_number: 'FO002', short_name: 'Ukkadam', check_in_time: `${today}T08:15:00`, check_out_time: null, duration_minutes: 235, is_active: true },
  { officer_name: 'Divya M', badge_number: 'SUP001', short_name: 'Singanallur', check_in_time: `${today}T07:50:00`, check_out_time: null, duration_minutes: 260, is_active: true },
  { officer_name: 'Manikandan V', badge_number: 'Peelamedu', check_in_time: `${today}T09:00:00`, check_out_time: `${today}T13:00:00`, duration_minutes: 240, is_active: false },
  { officer_name: 'Suresh Kumar', badge_number: 'FO004', short_name: 'RaceCourse', check_in_time: `${today}T08:30:00`, check_out_time: `${today}T12:30:00`, duration_minutes: 240, is_active: false },
];

export const MOCK_INCIDENTS: any[] = [
  { id: 1, type: 'accident', officer_name: 'Karthik R', junction_name: 'Gandhipuram Junction', description: 'Two-wheeler collision near signal, minor injury', status: 'open', created_at: new Date(Date.now() - 20 * 60000).toISOString() },
  { id: 2, type: 'signal_failure', officer_name: 'Priya S', junction_name: 'Ukkadam Junction', description: 'Traffic signal stuck on red for east approach', status: 'in_progress', created_at: new Date(Date.now() - 55 * 60000).toISOString() },
  { id: 3, type: 'roadblock', officer_name: 'Divya M', junction_name: 'Singanallur Junction', description: 'Illegal parking blocking left-turn lane', status: 'open', created_at: new Date(Date.now() - 90 * 60000).toISOString() },
  { id: 4, type: 'accident', officer_name: 'Manikandan V', junction_name: 'Peelamedu Junction', description: 'Minor fender-bender, cleared quickly', status: 'resolved', created_at: new Date(Date.now() - 4 * 3600000).toISOString() },
];

export const MOCK_TRAFFIC_LATEST: any[] = MOCK_JUNCTIONS.filter(j => j.is_active).map(j => ({
  junction_id: j.id,
  junction_name: j.name,
  short_name: j.short_name,
  station: j.station,
  district: j.district,
  lat: j.lat,
  lng: j.lng,
  congestion_level: j.current_congestion,
  delay_minutes: j.current_delay,
  usual_delay_minutes: j.current_congestion === 'heavy' ? +(j.current_delay * 0.6).toFixed(1)
    : j.current_congestion === 'intermediate' ? +(j.current_delay * 0.3).toFixed(1)
    : 0,
  active_officers: j.active_officers,
}));

// Route-level (per-road) traffic — powers the "Junctions" route panel and
// the two-flow tables on Live Monitor.
export const MOCK_JUNCTION_ROUTES: Record<number, any[]> = {
  1: [
    { id: 101, junction_id: 1, coming_from: 'Avinashi Road (from East)', origin_lat: 11.0205, origin_lng: 76.9695, dest_lat: 11.0168, dest_lng: 76.9558, congestion_level: 'heavy', delay_minutes: 13.2 },
    { id: 102, junction_id: 1, coming_from: 'Cross Cut Road (from South)', origin_lat: 11.0092, origin_lng: 76.9541, dest_lat: 11.0168, dest_lng: 76.9558, congestion_level: 'intermediate', delay_minutes: 8.1 },
  ],
  2: [
    { id: 201, junction_id: 2, coming_from: 'Trichy Road (from South East)', origin_lat: 10.9928, origin_lng: 76.9782, dest_lat: 11.0016, dest_lng: 76.9663, congestion_level: 'intermediate', delay_minutes: 7.9 },
    { id: 202, junction_id: 2, coming_from: 'Sungam Bypass (from West)', origin_lat: 11.0002, origin_lng: 76.9525, dest_lat: 11.0016, dest_lng: 76.9663, congestion_level: 'normal', delay_minutes: 4.5 },
  ],
  3: [
    { id: 301, junction_id: 3, coming_from: 'Avinashi Road (from Airport)', origin_lat: 11.0301, origin_lng: 77.0431, dest_lat: 11.0296, dest_lng: 77.0266, congestion_level: 'normal', delay_minutes: 4.0 },
  ],
  5: [
    { id: 501, junction_id: 5, coming_from: 'Trichy Road (from City)', origin_lat: 10.9987, origin_lng: 77.0142, dest_lat: 11.0011, dest_lng: 77.0294, congestion_level: 'heavy', delay_minutes: 15.0 },
    { id: 502, junction_id: 5, coming_from: 'Bypass Road (from South)', origin_lat: 10.9865, origin_lng: 77.0301, dest_lat: 11.0011, dest_lng: 77.0294, congestion_level: 'heavy', delay_minutes: 12.7 },
  ],
};

export const MOCK_JUNCTION_ROUTES_LATEST_TRAFFIC: any[] = Object.values(MOCK_JUNCTION_ROUTES)
  .flat()
  .map((r: any) => {
    const j = MOCK_JUNCTIONS.find(x => x.id === r.junction_id)!;
    const usual = r.congestion_level === 'heavy' ? +(r.delay_minutes * 0.55).toFixed(1)
      : r.congestion_level === 'intermediate' ? +(r.delay_minutes * 0.25).toFixed(1)
      : 0;
    return {
      ...r,
      junction_name: j.name,
      short_name: j.short_name,
      station: j.station,
      junction_lat: j.lat,
      junction_lng: j.lng,
      usual_delay_minutes: usual,
      total_seconds: Math.round(r.delay_minutes * 60),
      usual_seconds: Math.round((r.delay_minutes - usual) * 60),
    };
  });
