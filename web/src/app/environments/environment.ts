export const environment = {
  production: false,
  apiUrl: 'http://3.111.130.232:3000/api',
  wsUrl: 'http://3.111.130.232:3000',
  // UI-only mode: skips login + all backend calls, serves data from mock/mock-data.ts
  useMockData: false,
  // Browser key for Google Maps JavaScript API (live TrafficLayer on the
  // dashboard map). Best practice: create a SEPARATE key from the server's
  // Directions key, restrict it by HTTP referrer (your dashboard's domain),
  // and enable "Maps JavaScript API" on it. 10,000 map loads/month are free.
  googleMapsKey: 'AIzaSyBdKzi2G2iIAPzI2lc3HUSFYzsfkcdVWQs',
};
