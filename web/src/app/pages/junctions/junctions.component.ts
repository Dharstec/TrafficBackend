import { Component, OnInit } from '@angular/core';
import { JunctionService } from '../../core/services/junction.service';
import { JunctionRouteService } from '../../core/services/junction-route.service';

@Component({
  selector: 'app-junctions',
  templateUrl: './junctions.component.html',
})
export class JunctionsComponent implements OnInit {
  junctions: any[] = [];
  showForm = false;
  editId: number | null = null;
  form = { name: '', short_name: '', district: 'Coimbatore', sub_division: '', station: '', lat: '', lng: '' };

  // Route management
  expandedJunctionId: number | null = null;
  routesByJunction: Record<number, any[]> = {};
  showRouteForm = false;
  editRouteId: number | null = null;
  routeForm = { junction_id: 0, coming_from: '', origin_lat: '', origin_lng: '', dest_lat: '', dest_lng: '' };
  savingRoute = false;

  constructor(
    private svc: JunctionService,
    private routeSvc: JunctionRouteService,
  ) {}

  ngOnInit() { this.load(); }

  load() { this.svc.getAll().subscribe(d => this.junctions = d); }

  openAdd() {
    this.showForm = true; this.editId = null;
    this.form = { name: '', short_name: '', district: 'Coimbatore', sub_division: '', station: '', lat: '', lng: '' };
  }

  openEdit(j: any) {
    this.showForm = true; this.editId = j.id;
    this.form = { name: j.name, short_name: j.short_name, district: j.district, sub_division: j.sub_division, station: j.station, lat: j.lat, lng: j.lng };
  }

  save() {
    const obs = this.editId ? this.svc.update(this.editId, this.form) : this.svc.create(this.form);
    obs.subscribe(() => { this.showForm = false; this.load(); });
  }

  delete(id: number) {
    if (confirm('Deactivate this junction?')) this.svc.delete(id).subscribe(() => this.load());
  }

  // ── Route management ──────────────────────────────────────────

  toggleRoutes(j: any) {
    if (this.expandedJunctionId === j.id) {
      this.expandedJunctionId = null;
      this.showRouteForm = false;
    } else {
      this.expandedJunctionId = j.id;
      this.showRouteForm = false;
      this.loadRoutes(j.id);
    }
  }

  loadRoutes(junctionId: number) {
    this.routeSvc.getByJunction(junctionId).subscribe(routes => {
      this.routesByJunction[junctionId] = routes;
    });
  }

  openAddRoute(j: any) {
    this.showRouteForm = true;
    this.editRouteId = null;
    this.routeForm = {
      junction_id: j.id,
      coming_from: '',
      origin_lat: '',
      origin_lng: '',
      dest_lat: j.lat,   // destination = junction location
      dest_lng: j.lng,
    };
  }

  openEditRoute(r: any) {
    this.showRouteForm = true;
    this.editRouteId = r.id;
    this.routeForm = {
      junction_id: r.junction_id,
      coming_from: r.coming_from,
      origin_lat: r.origin_lat,
      origin_lng: r.origin_lng,
      dest_lat: r.dest_lat,
      dest_lng: r.dest_lng,
    };
  }

  saveRoute() {
    this.savingRoute = true;
    const obs = this.editRouteId
      ? this.routeSvc.update(this.editRouteId, this.routeForm)
      : this.routeSvc.create(this.routeForm);
    obs.subscribe({
      next: () => {
        this.savingRoute = false;
        this.showRouteForm = false;
        this.editRouteId = null;
        this.loadRoutes(this.routeForm.junction_id);
      },
      error: () => { this.savingRoute = false; },
    });
  }

  deleteRoute(r: any) {
    if (confirm(`Remove route "${r.coming_from}"?`)) {
      this.routeSvc.remove(r.id).subscribe(() => this.loadRoutes(r.junction_id));
    }
  }

  cancelRoute() { this.showRouteForm = false; this.editRouteId = null; }
}
