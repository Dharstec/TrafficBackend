import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, tap } from 'rxjs';

const API = 'https://itmsapi.dharstec.com/api';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<any>(
    JSON.parse(localStorage.getItem('m_user') || 'null')
  );
  user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  get user() { return this.userSubject.value; }
  get token() { return localStorage.getItem('m_token'); }
  get isLoggedIn() { return !!this.token; }

  login(email: string, password: string) {
    return this.http.post<any>(`${API}/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('m_token', res.access_token);
        localStorage.setItem('m_user', JSON.stringify(res.officer));
        this.userSubject.next(res.officer);
      })
    );
  }

  logout() {
    localStorage.clear();
    this.userSubject.next(null);
  }

  getHeaders() { return { Authorization: `Bearer ${this.token}` }; }
}
