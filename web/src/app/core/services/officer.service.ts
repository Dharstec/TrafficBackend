import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OfficerService {
  constructor(private http: HttpClient) {}

  getAll() { return this.http.get<any[]>(`${environment.apiUrl}/officers`); }
  getLiveLocations() { return this.http.get<any[]>(`${environment.apiUrl}/officers/live-locations`); }
  getAllTodayDuty() { return this.http.get<any[]>(`${environment.apiUrl}/checkins/today/all`); }
  create(data: any) { return this.http.post<any>(`${environment.apiUrl}/officers`, data); }
  update(id: number, data: any) { return this.http.put<any>(`${environment.apiUrl}/officers/${id}`, data); }
  getIncidents(status?: string) {
    const q = status ? `?status=${status}` : '';
    return this.http.get<any[]>(`${environment.apiUrl}/incidents${q}`);
  }
}
