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
  form = { name: '', badge_number: '', phone: '', email: '', password: 'Field@123', role: 'field_officer', assigned_junction_id: '' };

  constructor(private svc: OfficerService, private junctionSvc: JunctionService, private http: HttpClient) {}

  ngOnInit() { this.load(); }

  load() {
    this.svc.getAll().subscribe(d => this.officers = d);
    this.junctionSvc.getAll().subscribe(d => this.junctions = d);
    this.svc.getIncidents().subscribe(d => this.incidents = d);
  }

  save() {
    this.svc.create(this.form).subscribe(() => { this.showForm = false; this.load(); });
  }

  resolveIncident(id: number) {
    this.http.put(`${environment.apiUrl}/incidents/${id}/resolve`, {}).subscribe(() => this.load());
  }

  getStatusClass(s: string) {
    return { 'badge-success': s === 'open', 'bg-warning': s === 'in_progress', 'bg-secondary': s === 'resolved' };
  }
}
