import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LoadingController, ToastController } from '@ionic/angular';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
})
export class LoginPage {
  email = '';
  password = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    private loadingCtrl: LoadingController,
    private toastCtrl: ToastController,
  ) {}

  async login() {
    const loading = await this.loadingCtrl.create({ message: 'Signing in...' });
    await loading.present();

    this.auth.login(this.email, this.password).subscribe({
      next: async () => {
        await loading.dismiss();
        this.router.navigate(['/home'], { replaceUrl: true });
      },
      error: async (err) => {
        await loading.dismiss();
        const msg = err?.status === 0
          ? `Cannot reach server (${err.status}). Check network.`
          : err?.error?.message || err?.message || `Error ${err?.status}`;
        const toast = await this.toastCtrl.create({
          message: msg,
          duration: 4000,
          color: 'danger',
          position: 'top',
        });
        toast.present();
      },
    });
  }
}
