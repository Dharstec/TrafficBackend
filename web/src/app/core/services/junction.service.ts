import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class JunctionService {
  constructor(private http: HttpClient) {}

  getAll() { return this.http.get<any[]>(`${environment.apiUrl}/junctions`); }
  getOne(id: number) { return this.http.get<any>(`${environment.apiUrl}/junctions/${id}`); }
  create(data: any) { return this.http.post<any>(`${environment.apiUrl}/junctions`, data); }
  update(id: number, data: any) { return this.http.put<any>(`${environment.apiUrl}/junctions/${id}`, data); }
  delete(id: number) { return this.http.delete<any>(`${environment.apiUrl}/junctions/${id}`); }
}
