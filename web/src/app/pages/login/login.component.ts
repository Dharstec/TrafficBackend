import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { SocketService } from '../../core/services/socket.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router, private socket: SocketService) {}

  login() {
    this.loading = true;
    this.error = '';
    this.auth.login(this.email, this.password).subscribe({
      next: (res) => {
        this.socket.connect(res.officer);
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.error = 'Invalid email or password';
        this.loading = false;
      },
    });
  }
}
