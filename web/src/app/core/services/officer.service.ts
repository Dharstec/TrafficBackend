import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';
import { MOCK_OFFICERS, MOCK_LIVE_LOCATIONS, MOCK_TODAY_DUTY, MOCK_INCIDENTS } from '../../mock/mock-data';

@Injectable({ providedIn: 'root' })
export class OfficerService {
  private mock = [...MOCK_OFFICERS];
  private mockIncidents = [...MOCK_INCIDENTS];

  constructor(private http: HttpClient) {}

  getAll() {
    if (environment.useMockData) return of(this.mock);
    return this.http.get<any[]>(`${environment.apiUrl}/officers`);
  }

  getLiveLocations() {
    if (environment.useMockData) return of(MOCK_LIVE_LOCATIONS);
    return this.http.get<any[]>(`${environment.apiUrl}/officers/live-locations`);
  }

  getAllTodayDuty() {
    if (environment.useMockData) return of(MOCK_TODAY_DUTY);
    return this.http.get<any[]>(`${environment.apiUrl}/checkins/today/all`);
  }

  create(data: any) {
    if (environment.useMockData) {
      const rec = { ...data, id: Math.max(0, ...this.mock.map(o => o.id)) + 1, junction_name: null, checked_in_junction_name: null };
      this.mock.push(rec);
      return of(rec);
    }
    return this.http.post<any>(`${environment.apiUrl}/officers`, data);
  }

  update(id: number, data: any) {
    if (environment.useMockData) {
      const idx = this.mock.findIndex(o => o.id === id);
      if (idx >= 0) this.mock[idx] = { ...this.mock[idx], ...data };
      return of(this.mock[idx]);
    }
    return this.http.put<any>(`${environment.apiUrl}/officers/${id}`, data);
  }

  getIncidents(status?: string) {
    if (environment.useMockData) {
      return of(status ? this.mockIncidents.filter(i => i.status === status) : this.mockIncidents);
    }
    const q = status ? `?status=${status}` : '';
    return this.http.get<any[]>(`${environment.apiUrl}/incidents${q}`);
  }

  resolveIncident(id: number) {
    if (environment.useMockData) {
      const inc = this.mockIncidents.find(i => i.id === id);
      if (inc) inc.status = 'resolved';
      return of({ success: true });
    }
    return this.http.put(`${environment.apiUrl}/incidents/${id}/resolve`, {});
  }
}
