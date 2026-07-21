import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { SocketService } from '../../core/services/socket.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router, private socket: SocketService) {}

  ngOnInit() {
    // Local testing convenience: auto-submit a real seeded account so
    // localhost never needs manual typing. Hostname check means this can
    // never fire on the deployed site even if the flag is left on by
    // mistake in a build.
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (environment.autoLoginForTesting && isLocalHost && !this.auth.isLoggedIn) {
      this.email = environment.testAccount.email;
      this.password = environment.testAccount.password;
      this.login();
    }
  }

  login() {
    this.loading = true;
    this.error = '';
    this.auth.login(this.email, this.password).subscribe({
      next: (res) => {
        this.socket.connect(res.officer);
        this.router.navigate(['/live-monitor']);
      },
      error: () => {
        this.error = 'Invalid email or password';
        this.loading = false;
      },
    });
  }
}
