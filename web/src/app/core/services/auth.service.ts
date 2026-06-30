import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject, tap } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<any>(
    JSON.parse(localStorage.getItem('traffic_user') || 'null')
  );
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {}

  get currentUser() { return this.currentUserSubject.value; }
  get token() { return localStorage.getItem('traffic_token'); }
  get isLoggedIn() { return !!this.token; }

  login(email: string, password: string) {
    return this.http.post<any>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem('traffic_token', res.access_token);
        localStorage.setItem('traffic_user', JSON.stringify(res.officer));
        this.currentUserSubject.next(res.officer);
      })
    );
  }

  logout() {
    localStorage.removeItem('traffic_token');
    localStorage.removeItem('traffic_user');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }
}
