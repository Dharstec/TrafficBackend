import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';
import { MOCK_TRAFFIC_LATEST } from '../../mock/mock-data';

@Injectable({ providedIn: 'root' })
export class TrafficService {
  constructor(private http: HttpClient) {}

  getLatest() {
    if (environment.useMockData) return of(MOCK_TRAFFIC_LATEST);
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/latest`);
  }

  // Manual "Refresh Now" — the only way Google gets called (auto cron is
  // off by default). Response includes updated monthly usage.
  refreshNow() {
    if (environment.useMockData) return of({ refreshed: true } as any);
    return this.http.post<any>(`${environment.apiUrl}/simulator/refresh`, {});
  }

  // Monthly Google free-tier usage { month, calls, limit, remaining }
  getUsage() {
    if (environment.useMockData) return of({ month: '', calls: 120, limit: 4500, remaining: 4380 });
    return this.http.get<any>(`${environment.apiUrl}/simulator/usage`);
  }

  getByJunction(id: number, hours = 24) {
    if (environment.useMockData) {
      return of(MOCK_TRAFFIC_LATEST.filter(d => d.junction_id === id));
    }
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/junction/${id}?hours=${hours}`);
  }

  getHistory(junctionId: number, start: string, end: string) {
    if (environment.useMockData) {
      return of(MOCK_TRAFFIC_LATEST.filter(d => d.junction_id === junctionId));
    }
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/history?junction_id=${junctionId}&start=${start}&end=${end}`);
  }

  getSnapshot(date: string, time: string) {
    if (environment.useMockData) return of(MOCK_TRAFFIC_LATEST);
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/snapshot?date=${date}&time=${time}`);
  }

  getWeeklyReport(junctionId?: number) {
    if (environment.useMockData) {
      return of(junctionId ? MOCK_TRAFFIC_LATEST.filter(d => d.junction_id === junctionId) : MOCK_TRAFFIC_LATEST);
    }
    const q = junctionId ? `?junction_id=${junctionId}` : '';
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/report/weekly${q}`);
  }

  getCongestionColor(level: string): string {
    const map: Record<string, string> = {
      usual: '#4caf50',
      normal: '#ff9800',
      intermediate: '#f44336',
      heavy: '#7b1fa2',
    };
    return map[level] || '#9e9e9e';
  }

  getCongestionRadius(delay: number): number {
    if (delay <= 2) return 8;
    if (delay <= 5) return 12;
    if (delay <= 9) return 16;
    return 22;
  }
}
