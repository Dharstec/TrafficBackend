import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';
import { MOCK_JUNCTION_ROUTES, MOCK_JUNCTION_ROUTES_LATEST_TRAFFIC } from '../../mock/mock-data';

@Injectable({ providedIn: 'root' })
export class JunctionRouteService {
  private mock: Record<number, any[]> = JSON.parse(JSON.stringify(MOCK_JUNCTION_ROUTES));

  constructor(private http: HttpClient) {}

  getAll() {
    if (environment.useMockData) return of(Object.values(this.mock).flat());
    return this.http.get<any[]>(`${environment.apiUrl}/junction-routes`);
  }

  getByJunction(junctionId: number) {
    if (environment.useMockData) return of(this.mock[junctionId] || []);
    return this.http.get<any[]>(`${environment.apiUrl}/junction-routes/junction/${junctionId}`);
  }

  getLatestTraffic() {
    if (environment.useMockData) return of(MOCK_JUNCTION_ROUTES_LATEST_TRAFFIC);
    return this.http.get<any[]>(`${environment.apiUrl}/junction-routes/latest-traffic`);
  }

  create(data: any) {
    if (environment.useMockData) {
      const all = Object.values(this.mock).flat();
      const rec = { ...data, id: Math.max(0, ...all.map((r: any) => r.id)) + 1 };
      this.mock[data.junction_id] = [...(this.mock[data.junction_id] || []), rec];
      return of(rec);
    }
    return this.http.post<any>(`${environment.apiUrl}/junction-routes`, data);
  }

  update(id: number, data: any) {
    if (environment.useMockData) {
      const list = this.mock[data.junction_id] || [];
      const idx = list.findIndex(r => r.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], ...data };
      return of(list[idx]);
    }
    return this.http.put<any>(`${environment.apiUrl}/junction-routes/${id}`, data);
  }

  remove(id: number) {
    if (environment.useMockData) {
      for (const jid of Object.keys(this.mock)) {
        this.mock[+jid] = this.mock[+jid].filter(r => r.id !== id);
      }
      return of({ success: true });
    }
    return this.http.delete<any>(`${environment.apiUrl}/junction-routes/${id}`);
  }
}
