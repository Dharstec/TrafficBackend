export const environment = {
  production: false,
  apiUrl: 'http://3.111.130.232:3000/api',
  wsUrl: 'http://3.111.130.232:3000',
  // UI-only mode: skips login + all backend calls, serves data from mock/mock-data.ts
  useMockData: false,

  // ── Map engine switch ─────────────────────────────────────────────
  // 'google'  → real Google Map + live TrafficLayer on every road
  //             (10,000 free map loads/month, then $7 per 1,000)
  // 'leaflet' → 100% free map (CARTO tiles + our own route ribbons).
  // Any payment worry? Change this ONE word to 'leaflet' and rebuild —
  // everything else keeps working.
  mapEngine: 'leaflet' as 'google' | 'leaflet',
  // Browser key for Google Maps JavaScript API. Best practice: a SEPARATE
  // key from the server's Directions key, restricted by HTTP referrer,
  // with "Maps JavaScript API" enabled.
  googleMapsKey: 'AIzaSyDEDda1Pq0Bwm3gmUkxKHY9GvaBXQPteBs',
};
