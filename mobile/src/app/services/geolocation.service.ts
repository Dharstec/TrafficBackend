import { Injectable } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { Subject, interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

const API = 'http://3.111.130.232:3000/api';

export interface GeoPosition { lat: number; lng: number; accuracy?: number; }

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  position$ = new Subject<GeoPosition>();
  nearbyJunction$ = new Subject<any | null>();

  private trackingSub: Subscription;
  private lastCheckinJunctionId: number | null = null;

  constructor(private http: HttpClient, private auth: AuthService) {}

  async getCurrentPosition(): Promise<GeoPosition> {
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  }

  startTracking(intervalMs = 10000) {
    if (this.trackingSub) return;
    this.trackingSub = interval(intervalMs).pipe(
      switchMap(() => this.tick())
    ).subscribe();
  }

  stopTracking() {
    this.trackingSub?.unsubscribe();
    this.trackingSub = null;
  }

  private async tick() {
    try {
      const pos = await this.getCurrentPosition();
      this.position$.next(pos);
      const headers = new HttpHeaders(this.auth.getHeaders());

      // Send location to backend
      await this.http.post(`${API}/officers/location`, pos, { headers }).toPromise();

      // Check for auto check-in/out
      const result: any = await this.http.post(`${API}/checkins/auto`, pos, { headers }).toPromise();

      if (result?.checked_in && result?.junction) {
        this.lastCheckinJunctionId = result.junction.id;
        this.nearbyJunction$.next(result.junction);
      } else {
        // Check if we should auto checkout
        const out: any = await this.http.post(`${API}/checkins/auto-checkout`, pos, { headers }).toPromise();
        if (out?.checked_out) {
          this.lastCheckinJunctionId = null;
          this.nearbyJunction$.next(null);
        }
      }
    } catch (e) {
      console.error('Tracking tick error', e);
    }
  }
}
