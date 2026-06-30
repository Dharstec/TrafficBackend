import { Component, OnInit, AfterViewInit } from '@angular/core';
import { TrafficService } from '../../core/services/traffic.service';
import * as L from 'leaflet';

@Component({
  selector: 'app-map-view',
  templateUrl: './map-view.component.html',
})
export class MapViewComponent implements OnInit, AfterViewInit {
  trafficData: any[] = [];
  snapshotDate = new Date().toISOString().split('T')[0];
  snapshotTime = '08:00';
  mode: 'live' | 'snapshot' = 'live';
  private map: L.Map;
  private layers = new Map<number, L.CircleMarker>();

  constructor(private trafficSvc: TrafficService) {}

  ngOnInit() { this.loadLive(); }

  ngAfterViewInit() { this.initMap(); }

  initMap() {
    this.map = L.map('city-map').setView([13.0200, 80.2300], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.map);
    if (this.trafficData.length) this.renderCircles(this.trafficData);
  }

  loadLive() {
    this.trafficSvc.getLatest().subscribe(data => {
      this.trafficData = data;
      if (this.map) this.renderCircles(data);
    });
  }

  loadSnapshot() {
    this.trafficSvc.getSnapshot(this.snapshotDate, this.snapshotTime).subscribe(data => {
      this.trafficData = data;
      if (this.map) this.renderCircles(data);
    });
  }

  renderCircles(data: any[]) {
    this.layers.forEach(l => l.remove());
    this.layers.clear();
    data.forEach(d => {
      const color = this.trafficSvc.getCongestionColor(d.congestion_level);
      const radius = this.trafficSvc.getCongestionRadius(d.delay_minutes || 1);
      const circle = L.circleMarker([d.lat, d.lng], {
        radius, color, fillColor: color, fillOpacity: 0.85, weight: 2,
      }).addTo(this.map);
      circle.bindPopup(`
        <b>${d.junction_name}</b><br>
        District: ${d.district}<br>
        Delay: <b>${d.delay_minutes} min</b><br>
        Status: <span style="color:${color};font-weight:bold">${d.congestion_level?.toUpperCase()}</span>
      `);
      this.layers.set(d.junction_id, circle);
    });
  }

  switchMode(m: 'live' | 'snapshot') {
    this.mode = m;
    if (m === 'live') this.loadLive();
  }
}
