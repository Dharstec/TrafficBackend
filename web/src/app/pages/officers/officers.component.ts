import { Component, OnInit } from '@angular/core';
import { OfficerService } from '../../core/services/officer.service';
import { JunctionService } from '../../core/services/junction.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-officers',
  templateUrl: './officers.component.html',
})
export class OfficersComponent implements OnInit {
  officers: any[] = [];
  junctions: any[] = [];
  incidents: any[] = [];
  activeTab: 'officers' | 'incidents' = 'officers';
  showForm = false;
  editId: number | null = null;
  saving = false;
  errorMsg = '';

  form = {
    name: '', badge_number: '', phone: '', email: '',
    password: '', role: 'field_officer', assigned_junction_id: '', is_active: true,
  };

  constructor(
    private svc: OfficerService,
    private junctionSvc: JunctionService,
    private http: HttpClient,
  ) {}

  ngOnInit() { this.load(); }

  load() {
    this.svc.getAll().subscribe(d => this.officers = d);
    this.junctionSvc.getAll().subscribe(d => this.junctions = d);
    this.svc.getIncidents().subscribe(d => this.incidents = d);
  }

  openAdd() {
    this.editId = null;
    this.errorMsg = '';
    this.form = { name: '', badge_number: '', phone: '', email: '', password: '', role: 'field_officer', assigned_junction_id: '', is_active: true };
    this.showForm = true;
  }

  openEdit(o: any) {
    this.editId = o.id;
    this.errorMsg = '';
    this.form = {
      name: o.name,
      badge_number: o.badge_number,
      phone: o.phone || '',
      email: o.email,
      password: '',
      role: o.role,
      assigned_junction_id: o.assigned_junction_id || '',
      is_active: o.is_active,
    };
    this.showForm = true;
  }

  save() {
    this.saving = true;
    this.errorMsg = '';

    const payload: any = {
      name: this.form.name,
      phone: this.form.phone,
      role: this.form.role,
      assigned_junction_id: this.form.assigned_junction_id || null,
      is_active: this.form.is_active,
    };

    let obs;
    if (this.editId) {
      obs = this.http.put(`${environment.apiUrl}/officers/${this.editId}`, payload);
    } else {
      obs = this.svc.create({
        ...payload,
        badge_number: this.form.badge_number,
        email: this.form.email,
        password: this.form.password || 'Field@123',
      });
    }

    obs.subscribe({
      next: () => { this.saving = false; this.showForm = false; this.load(); },
      error: (e: any) => { this.saving = false; this.errorMsg = e?.error?.message || 'Failed to save officer'; },
    });
  }

  resolveIncident(id: number) {
    this.http.put(`${environment.apiUrl}/incidents/${id}/resolve`, {}).subscribe(() => this.load());
  }
}
