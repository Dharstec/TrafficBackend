import { Component, OnInit } from '@angular/core';
import { JunctionService } from '../../core/services/junction.service';

@Component({
  selector: 'app-junctions',
  templateUrl: './junctions.component.html',
})
export class JunctionsComponent implements OnInit {
  junctions: any[] = [];
  showForm = false;
  editId: number | null = null;
  form = { name: '', short_name: '', district: 'Coimbatore', sub_division: '', station: '', lat: '', lng: '' };

  constructor(private svc: JunctionService) {}

  ngOnInit() { this.load(); }

  load() { this.svc.getAll().subscribe(d => this.junctions = d); }

  openAdd() { this.showForm = true; this.editId = null; this.form = { name: '', short_name: '', district: 'Coimbatore', sub_division: '', station: '', lat: '', lng: '' }; }

  openEdit(j: any) {
    this.showForm = true;
    this.editId = j.id;
    this.form = { name: j.name, short_name: j.short_name, district: j.district, sub_division: j.sub_division, station: j.station, lat: j.lat, lng: j.lng };
  }

  save() {
    const obs = this.editId
      ? this.svc.update(this.editId, this.form)
      : this.svc.create(this.form);
    obs.subscribe(() => { this.showForm = false; this.load(); });
  }

  delete(id: number) {
    if (confirm('Deactivate this junction?')) {
      this.svc.delete(id).subscribe(() => this.load());
    }
  }

  getCongestionClass(level: string) {
    return { 'text-success': level==='usual', 'text-warning': level==='normal', 'text-danger': level==='intermediate', 'text-purple': level==='heavy' };
  }
}
