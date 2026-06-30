import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CheckinService } from '../../services/checkin.service';
import { GeolocationService } from '../../services/geolocation.service';
import * as L from 'leaflet';

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
})
export class MapPage implements OnInit, AfterViewInit {
  private map: L.Map;
  private myMarker: L.Marker;
  junctions: any[] = [];
  trafficData: any[] = [];

  constructor(private checkinSvc: CheckinService, private geo: GeolocationService) {}

  ngOnInit() {
    this.checkinSvc.getJunctions().subscribe(d => this.junctions = d);
    this.checkinSvc.getTrafficLatest().subscribe(d => {
      this.trafficData = d;
      if (this.map) this.renderJunctions();
    });
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 300);
  }

  async initMap() {
    this.map = L.map('mobile-map').setView([13.0200, 80.2300], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(this.map);

    try {
      const pos = await this.geo.getCurrentPosition();
      this.map.setView([pos.lat, pos.lng], 14);
      const myIcon = L.divIcon({
        html: '<div style="background:#1976d2;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
        iconSize: [16, 16], iconAnchor: [8, 8],
      });
      this.myMarker = L.marker([pos.lat, pos.lng], { icon: myIcon }).addTo(this.map);
      this.myMarker.bindPopup('<b>You are here</b>');

      // Draw 200m circle
      L.circle([pos.lat, pos.lng], { radius: 200, color: '#1976d2', fillColor: '#1976d2', fillOpacity: 0.08, weight: 1 }).addTo(this.map);
    } catch (e) {
      console.error('Cannot get location', e);
    }

    this.renderJunctions();
  }

  getColor(level: string): string {
    const m: Record<string, string> = { usual: '#4caf50', normal: '#ff9800', intermediate: '#f44336', heavy: '#7b1fa2' };
    return m[level] || '#9e9e9e';
  }

  renderJunctions() {
    if (!this.map) return;
    this.junctions.forEach(j => {
      const traffic = this.trafficData.find(t => t.junction_id === j.id);
      const color = traffic ? this.getColor(traffic.congestion_level) : '#9e9e9e';
      const radius = traffic ? (traffic.delay_minutes <= 2 ? 8 : traffic.delay_minutes <= 5 ? 12 : traffic.delay_minutes <= 9 ? 16 : 22) : 8;
      L.circleMarker([j.lat, j.lng], { radius, color, fillColor: color, fillOpacity: 0.85, weight: 2 })
        .addTo(this.map)
        .bindPopup(`<b>${j.name}</b><br>Delay: ${traffic?.delay_minutes ?? '?'} min<br>Status: ${traffic?.congestion_level ?? 'unknown'}`);
    });
  }
}
