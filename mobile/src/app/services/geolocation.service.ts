import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { Subject } from 'rxjs';

const API = 'http://3.111.130.232:3000/api';

export interface GeoPosition { lat: number; lng: number; accuracy?: number; }

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  position$ = new Subject<GeoPosition>();
  nearbyJunction$ = new Subject<any | null>();
  checkinResult$ = new Subject<any>();

  private watchId: string | null = null;
  private lastApiCallTime = 0;
  private readonly BACKEND_INTERVAL_MS = 15000; // call backend max every 15s

  constructor(private http: HttpClient, private auth: AuthService) {}

  async requestPermissions(): Promise<boolean> {
    try {
      const perm = await Geolocation.requestPermissions();
      return perm.location === 'granted' || perm.coarseLocation === 'granted';
    } catch (e) {
      console.error('Permission request failed', e);
      return false;
    }
  }

  async getCurrentPosition(): Promise<GeoPosition> {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  }

  async startTracking() {
    if (this.watchId) return; // already tracking

    await this.requestPermissions();

    try {
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 15000 },
        (position, err) => {
          if (err || !position) {
            console.error('[GPS] watchPosition error:', err);
            return;
          }

          const pos: GeoPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          };

          this.position$.next(pos);

          // Throttle: only call backend once every 15 seconds
          const now = Date.now();
          if (now - this.lastApiCallTime >= this.BACKEND_INTERVAL_MS) {
            this.lastApiCallTime = now;
            this.callBackend(pos);
          }
        },
      );
      console.log('[GPS] watchPosition started, id:', this.watchId);
    } catch (e) {
      console.error('[GPS] watchPosition failed:', e);
    }
  }

  stopTracking() {
    if (this.watchId) {
      Geolocation.clearWatch({ id: this.watchId });
      this.watchId = null;
      console.log('[GPS] Tracking stopped');
    }
  }

  // Restart tracking (called when app resumes from background)
  async restartTracking() {
    this.stopTracking();
    await this.startTracking();
  }

  private async callBackend(pos: GeoPosition) {
    if (!this.auth.token) return;
    const headers = new HttpHeaders(this.auth.getHeaders());

    try {
      // Update officer's last known location
      await this.http.post(`${API}/officers/location`, pos, { headers }).toPromise();

      // Auto check-in: finds nearest junction within 500m
      const result: any = await this.http.post(`${API}/checkins/auto`, pos, { headers }).toPromise();
      this.checkinResult$.next(result);

      if (result?.checked_in && !result?.already && result?.junction) {
        this.nearbyJunction$.next(result.junction);
      } else if (!result?.checked_in) {
        // Auto checkout: if moved >500m from checked-in junction
        const out: any = await this.http.post(`${API}/checkins/auto-checkout`, pos, { headers }).toPromise();
        if (out?.checked_out) {
          this.nearbyJunction$.next(null);
        }
      }
    } catch (e) {
      console.error('[GPS] Backend call failed:', e);
    }
  }
}
