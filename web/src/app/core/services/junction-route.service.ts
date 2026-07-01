import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class JunctionRouteService {
  constructor(private http: HttpClient) {}

  getAll() { return this.http.get<any[]>(`${environment.apiUrl}/junction-routes`); }
  getByJunction(junctionId: number) { return this.http.get<any[]>(`${environment.apiUrl}/junction-routes/junction/${junctionId}`); }
  getLatestTraffic() { return this.http.get<any[]>(`${environment.apiUrl}/junction-routes/latest-traffic`); }
  create(data: any) { return this.http.post<any>(`${environment.apiUrl}/junction-routes`, data); }
  update(id: number, data: any) { return this.http.put<any>(`${environment.apiUrl}/junction-routes/${id}`, data); }
  remove(id: number) { return this.http.delete<any>(`${environment.apiUrl}/junction-routes/${id}`); }
}
