import { Component, OnInit } from '@angular/core';
import { NavController, ToastController } from '@ionic/angular';
import { CheckinService } from '../../services/checkin.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-incident',
  templateUrl: './incident.page.html',
})
export class IncidentPage implements OnInit {
  junctions: any[] = [];
  activeCheckin: any = null;

  form = {
    type: 'device_malfunction',
    junction_id: null,
    description: '',
    photo_url: '',
  };

  submitting = false;

  constructor(
    private checkinSvc: CheckinService,
    private auth: AuthService,
    private navCtrl: NavController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit() {
    this.checkinSvc.getJunctions().subscribe(d => this.junctions = d);
    this.checkinSvc.getActiveCheckin().subscribe(d => {
      this.activeCheckin = d;
      if (d) this.form.junction_id = d.junction_id;
    });
  }

  async submit() {
    if (!this.form.description.trim()) {
      const toast = await this.toastCtrl.create({ message: 'Please enter a description', duration: 2000, color: 'warning', position: 'top' });
      toast.present();
      return;
    }

    this.submitting = true;
    this.checkinSvc.submitIncident(this.form).subscribe({
      next: async () => {
        this.submitting = false;
        const toast = await this.toastCtrl.create({ message: 'Incident reported successfully', duration: 2500, color: 'success', position: 'top' });
        toast.present();
        this.navCtrl.back();
      },
      error: async () => {
        this.submitting = false;
        const toast = await this.toastCtrl.create({ message: 'Failed to submit. Try again.', duration: 2000, color: 'danger', position: 'top' });
        toast.present();
      },
    });
  }
}
