import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { AuthService } from '../../services/auth.service';
import { CheckinService } from '../../services/checkin.service';
import { GeolocationService } from '../../services/geolocation.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
})
export class HomePage implements OnInit, OnDestroy {
  user: any;
  activeCheckin: any = null;
  junctions: any[] = [];
  trafficData: any[] = [];
  todayDuty: any[] = [];

  deviceStatus = { breath_analyzer: false, body_camera: false, signal_remote: false, challan_machine: false };
  showDeviceCheck = false;
  clearingTraffic = false;

  // Live GPS status (visible to all)
  currentLat: number | null = null;
  currentLng: number | null = null;
  currentAccuracy: number | null = null;
  lastCheckinResponse: string = '';

  // GPS test panel (supervisor/admin only)
  showTestPanel = false;
  myLat: number | null = null;
  myLng: number | null = null;
  gpsAccuracy: number | null = null;
  testJunction: any = null;
  testResult: string = '';
  testResultOk: boolean = true;
  gpsLoading = false;
  dropLoading = false;
  checkinLoading = false;
  checkoutLoading = false;
  testStep = 1;

  private subs: Subscription[] = [];

  constructor(
    private auth: AuthService,
    private checkinSvc: CheckinService,
    private geo: GeolocationService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {}

  ngOnInit() {
    this.user = this.auth.user;
    this.load();
    this.geo.startTracking();
    this.subs.push(
      this.geo.position$.subscribe(pos => {
        this.currentLat = pos.lat;
        this.currentLng = pos.lng;
        this.currentAccuracy = pos.accuracy || null;
      }),
      this.geo.checkinResult$.subscribe(result => {
        this.lastCheckinResponse = result?.checked_in
          ? `✓ Checked in: ${result.junction?.name}`
          : `Not in range: ${result?.message || ''}`;
      }),
      this.geo.nearbyJunction$.subscribe(junction => {
        if (junction) this.showAutoCheckinAlert(junction);
        else { this.activeCheckin = null; this.toast('Auto checkout — moved beyond 200m', 'warning'); }
        this.load();
      })
    );
  }

  load() {
    this.checkinSvc.getActiveCheckin().subscribe(d => this.activeCheckin = d);
    this.checkinSvc.getJunctions().subscribe(d => this.junctions = d);
    this.checkinSvc.getTrafficLatest().subscribe(d => this.trafficData = d);
    this.checkinSvc.getTodayDuty().subscribe(d => this.todayDuty = d);
  }

  // Today's total time at junctions
  get totalDutyMinutes(): number {
    return this.todayDuty.reduce((sum, d) => sum + (+d.duration_minutes || 0), 0);
  }

  formatDuration(minutes: number): string {
    if (!minutes || minutes < 1) return '< 1 min';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m} min`;
  }

  // Officer marks junction traffic as clear
  async clearTraffic() {
    if (!this.activeCheckin) return;
    this.clearingTraffic = true;
    this.checkinSvc.clearTraffic(this.activeCheckin.junction_id).subscribe({
      next: async () => {
        this.clearingTraffic = false;
        await this.toast('Traffic cleared! Supervisor notified.', 'success');
        this.load();
      },
      error: async () => {
        this.clearingTraffic = false;
        await this.toast('Failed to update traffic', 'danger');
      }
    });
  }

  // ── GPS Test Panel ────────────────────────────────────────────

  async getMyGPS() {
    this.gpsLoading = true;
    this.testResult = '';
    try {
      const pos = await this.geo.getCurrentPosition();
      this.myLat = pos.lat;
      this.myLng = pos.lng;
      this.gpsAccuracy = pos.accuracy || null;
      this.testStep = 2;
      this.testResult = `Got your GPS: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`;
      this.testResultOk = true;
    } catch (e) {
      this.testResult = 'GPS failed. Allow location in browser and try again.';
      this.testResultOk = false;
    }
    this.gpsLoading = false;
  }

  async dropJunctionHere() {
    if (!this.myLat || !this.myLng) return;
    this.dropLoading = true;
    this.testResult = '';
    try {
      const res: any = await this.checkinSvc.createTestJunctionHere(this.myLat, this.myLng).toPromise();
      this.testJunction = res.junction;
      this.testStep = 3;
      this.testResult = `Junction created at YOUR location. You are 0m away — inside 200m zone.`;
      this.testResultOk = true;
      this.load();
    } catch (e) {
      this.testResult = 'Failed to create junction. Is the backend running?';
      this.testResultOk = false;
    }
    this.dropLoading = false;
  }

  async testCheckin() {
    if (!this.myLat || !this.myLng) return;
    this.checkinLoading = true;
    this.testResult = '';
    try {
      const res: any = await this.checkinSvc.autoCheckinTest(this.myLat, this.myLng).toPromise();
      if (res?.checked_in) {
        this.testStep = 4;
        this.testResult = `CHECK-IN SUCCESS! Junction: "${res.junction?.name}". Distance: ~0m.`;
        this.testResultOk = true;
        this.showDeviceCheck = true;
        this.load();
        await this.toast('Checked in at your location!', 'success');
      } else {
        this.testResult = `Not checked in: ${res?.message}`;
        this.testResultOk = false;
      }
    } catch (e: any) {
      this.testResult = `Error: ${JSON.stringify(e?.error)}`;
      this.testResultOk = false;
    }
    this.checkinLoading = false;
  }

  async testCheckoutSimulate() {
    if (!this.myLat || !this.myLng) return;
    this.checkoutLoading = true;
    this.testResult = '';
    const farLat = this.myLat + 0.00225;
    try {
      const res: any = await this.checkinSvc.autoCheckoutTest(farLat, this.myLng).toPromise();
      if (res?.checked_out) {
        this.testStep = 1;
        this.testJunction = null;
        this.testResult = `CHECKOUT SUCCESS! Simulated ${res.distance}m away. Test complete!`;
        this.testResultOk = true;
        this.load();
        await this.toast(`Checkout! ${res.distance}m away`, 'success');
      } else {
        this.testResult = `Not checked out: ${res?.message}`;
        this.testResultOk = false;
      }
    } catch (e: any) {
      this.testResult = `Error: ${JSON.stringify(e?.error)}`;
      this.testResultOk = false;
    }
    this.checkoutLoading = false;
  }

  // ── Normal app methods ────────────────────────────────────────

  async showAutoCheckinAlert(junction: any) {
    const alert = await this.alertCtrl.create({
      header: 'Auto Check-in',
      message: `Within 200m of<br><b>${junction.name}</b><br>Checked in automatically.`,
      buttons: ['OK'],
    });
    await alert.present();
    this.showDeviceCheck = true;
    this.load();
  }

  async saveDeviceStatus() {
    if (!this.activeCheckin) return;
    this.checkinSvc.saveDeviceStatus(this.activeCheckin.id, this.deviceStatus).subscribe(async () => {
      this.showDeviceCheck = false;
      await this.toast('Device status saved', 'success');
    });
  }

  async doCheckout() {
    const alert = await this.alertCtrl.create({
      header: 'Confirm Checkout',
      message: 'Check out from this junction?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Check Out', handler: () => {
          this.checkinSvc.checkout().subscribe(async () => {
            this.activeCheckin = null;
            await this.toast('Checked out', 'success');
            this.load();
          });
        }},
      ],
    });
    await alert.present();
  }

  getCongestionColor(level: string) {
    const m: Record<string, string> = { usual: '#4caf50', normal: '#ff9800', intermediate: '#f44336', heavy: '#7b1fa2' };
    return m[level] || '#9e9e9e';
  }

  getTrafficForJunction(id: number) { return this.trafficData.find(d => d.junction_id === id); }
  getCurrentTraffic() {
    if (!this.activeCheckin) return null;
    return this.getTrafficForJunction(this.activeCheckin.junction_id);
  }

  logout() { this.auth.logout(); this.router.navigate(['/login']); }
  goToIncident() { this.router.navigate(['/incident']); }
  goToMap() { this.router.navigate(['/map']); }

  private async toast(message: string, color: string) {
    const t = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    t.present();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.geo.stopTracking();
  }
}
