import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { AuthService } from './services/auth.service';
import { GeolocationService } from './services/geolocation.service';

@Component({
  selector: 'app-root',
  template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>',
})
export class AppComponent implements OnInit {
  constructor(
    private auth: AuthService,
    private router: Router,
    private geo: GeolocationService,
  ) {}

  ngOnInit() {
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], { replaceUrl: true });
    }

    // When app comes back to foreground, restart GPS tracking
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && this.auth.isLoggedIn) {
        console.log('[App] Resumed — restarting GPS tracking');
        this.geo.restartTracking();
      }
    });
  }
}
