import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.gov.gctp.traffic',
  appName: 'GCTP Traffic',
  webDir: 'www/browser',
  server: { androidScheme: 'https' },
  plugins: {
    Geolocation: { permissions: ['location'] },
  },
};

export default config;
