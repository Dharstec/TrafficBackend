export const environment = {
  production: false,
  apiUrl: 'https://itmsapi.dharstec.com/api',
  wsUrl: 'https://itmsapi.dharstec.com',
  // UI-only mode: skips login + all backend calls, serves data from mock/mock-data.ts
  useMockData: false,

  // Auto-login for LOCAL TESTING ONLY. The login page auto-submits this
  // real seeded backend account (a genuine /auth/login call, real JWT —
  // not a UI bypass). Double-gated for safety: also requires the app to be
  // running on localhost/127.0.0.1 (see login.component.ts), so leaving
  // this true can never auto-login real visitors on the live site.
  autoLoginForTesting: true,
  testAccount: { email: 'admin@gctp.gov.in', password: 'password123' },

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
