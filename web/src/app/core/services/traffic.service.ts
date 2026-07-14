import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TrafficService {
  constructor(private http: HttpClient) {}

  getLatest() { return this.http.get<any[]>(`${environment.apiUrl}/traffic/latest`); }

  // Manual "Refresh Now" — backend calls Google once for every route.
  // Auto-refresh is off by default, so this button is what spends quota.
  refreshNow() {
    return this.http.post<any>(`${environment.apiUrl}/simulator/refresh`, {});
  }

  // Monthly Google free-tier usage { month, calls, limit, remaining }
  getUsage() {
    return this.http.get<any>(`${environment.apiUrl}/simulator/usage`);
  }

  getByJunction(id: number, hours = 24) {
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/junction/${id}?hours=${hours}`);
  }

  getHistory(junctionId: number, start: string, end: string) {
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/history?junction_id=${junctionId}&start=${start}&end=${end}`);
  }

  getSnapshot(date: string, time: string) {
    return this.http.get<any[]>(`${environment.apiUrl}/traffic/snapshot?date=${date}&time=${time}`);
  }

  getWeeklyReport(junctionId?: number) {
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
