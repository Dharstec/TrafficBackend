import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, of, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { MOCK_USER } from '../../mock/mock-data';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<any>(
    JSON.parse(localStorage.getItem('traffic_user') || 'null')
  );
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    // UI-only mode: auto-authenticate so login is never shown.
    if (environment.useMockData && !this.token) {
      localStorage.setItem('traffic_token', 'mock-token');
      localStorage.setItem('traffic_user', JSON.stringify(MOCK_USER));
      this.currentUserSubject.next(MOCK_USER);
    }
  }

  get currentUser() { return this.currentUserSubject.value; }
  get token() { return localStorage.getItem('traffic_token'); }
  get isLoggedIn() { return environment.useMockData ? true : !!this.token; }

  login(email: string, password: string) {
    if (environment.useMockData) {
      return of({ access_token: 'mock-token', officer: MOCK_USER }).pipe(
        tap(res => {
          localStorage.setItem('traffic_token', res.access_token);
          localStorage.setItem('traffic_user', JSON.stringify(res.officer));
          this.currentUserSubject.next(res.officer);
        })
      );
    }
    return this.http.post<any>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('traffic_token', res.access_token);
        localStorage.setItem('traffic_user', JSON.stringify(res.officer));
        this.currentUserSubject.next(res.officer);
      })
    );
  }

  logout() {
    if (environment.useMockData) {
      // Nothing to log out of in UI-only mode — keep the demo session alive.
      return;
    }
    localStorage.removeItem('traffic_token');
    localStorage.removeItem('traffic_user');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }
}
