import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { environment } from '../../environments/environment';
import { MOCK_JUNCTIONS } from '../../mock/mock-data';

@Injectable({ providedIn: 'root' })
export class JunctionService {
  private mock = [...MOCK_JUNCTIONS];

  constructor(private http: HttpClient) {}

  getAll() {
    if (environment.useMockData) return of(this.mock);
    return this.http.get<any[]>(`${environment.apiUrl}/junctions`);
  }

  getOne(id: number) {
    if (environment.useMockData) return of(this.mock.find(j => j.id === id));
    return this.http.get<any>(`${environment.apiUrl}/junctions/${id}`);
  }

  create(data: any) {
    if (environment.useMockData) {
      const rec = { ...data, id: Math.max(0, ...this.mock.map(j => j.id)) + 1, active_officers: 0, assigned_officers: 0 };
      this.mock.push(rec);
      return of(rec);
    }
    return this.http.post<any>(`${environment.apiUrl}/junctions`, data);
  }

  update(id: number, data: any) {
    if (environment.useMockData) {
      const idx = this.mock.findIndex(j => j.id === id);
      if (idx >= 0) this.mock[idx] = { ...this.mock[idx], ...data };
      return of(this.mock[idx]);
    }
    return this.http.put<any>(`${environment.apiUrl}/junctions/${id}`, data);
  }

  delete(id: number) {
    if (environment.useMockData) {
      const idx = this.mock.findIndex(j => j.id === id);
      if (idx >= 0) this.mock[idx].is_active = false;
      return of({ success: true });
    }
    return this.http.delete<any>(`${environment.apiUrl}/junctions/${id}`);
  }
}
