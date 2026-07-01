import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';

const API = 'http://3.111.130.232:3000/api';

@Injectable({ providedIn: 'root' })
export class CheckinService {
  constructor(private http: HttpClient, private auth: AuthService) {}

  private headers() { return new HttpHeaders(this.auth.getHeaders()); }

  getActiveCheckin() {
    return this.http.get<any>(`${API}/checkins/my/active`, { headers: this.headers() });
  }

  getMyCheckins() {
    return this.http.get<any[]>(`${API}/checkins/my`, { headers: this.headers() });
  }

  manualCheckin(junctionId: number, lat: number, lng: number) {
    return this.http.post<any>(`${API}/checkins/manual`, { junction_id: junctionId, lat, lng }, { headers: this.headers() });
  }

  checkout() {
    return this.http.post<any>(`${API}/checkins/checkout`, {}, { headers: this.headers() });
  }

  saveDeviceStatus(checkinId: number, devices: any) {
    return this.http.post<any>(`${API}/checkins/devices`, { checkin_id: checkinId, ...devices }, { headers: this.headers() });
  }

  getJunctions() {
    return this.http.get<any[]>(`${API}/junctions`, { headers: this.headers() });
  }

  getTrafficLatest() {
    return this.http.get<any[]>(`${API}/traffic/latest`, { headers: this.headers() });
  }

  submitIncident(data: any) {
    return this.http.post<any>(`${API}/incidents`, data, { headers: this.headers() });
  }

  autoCheckinTest(lat: number, lng: number) {
    return this.http.post<any>(`${API}/checkins/auto`, { lat, lng }, { headers: this.headers() });
  }

  autoCheckoutTest(lat: number, lng: number) {
    return this.http.post<any>(`${API}/checkins/auto-checkout`, { lat, lng }, { headers: this.headers() });
  }

  createTestJunctionHere(lat: number, lng: number) {
    return this.http.post<any>(`${API}/junctions/set-test`, { lat, lng }, { headers: this.headers() });
  }

  getTodayDuty() {
    return this.http.get<any[]>(`${API}/checkins/my/today`, { headers: this.headers() });
  }

  clearTraffic(junctionId: number) {
    return this.http.post<any>(`${API}/traffic/clear`, { junction_id: junctionId }, { headers: this.headers() });
  }
}
