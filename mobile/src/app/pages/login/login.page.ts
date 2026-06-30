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
      error: async () => {
        await loading.dismiss();
        const toast = await this.toastCtrl.create({
          message: 'Invalid email or password',
          duration: 2500,
          color: 'danger',
          position: 'top',
        });
        toast.present();
      },
    });
  }
}
