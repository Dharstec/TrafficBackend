import { Component, OnInit, AfterViewInit } from '@angular/core';
import { CheckinService } from '../../services/checkin.service';
import { GeolocationService } from '../../services/geolocation.service';
import * as L from 'leaflet';

const CBE_LAT = 11.0168;
const CBE_LNG = 76.9558;

@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
})
export class MapPage implements OnInit, AfterViewInit {
  private map: L.Map;
  private junctionLayer: L.LayerGroup;
  junctions: any[] = [];
  trafficData: any[] = [];

  constructor(private checkinSvc: CheckinService, private geo: GeolocationService) {}

  ngOnInit() {
    this.checkinSvc.getJunctions().subscribe(d => {
      this.junctions = d;
      this.tryRender();
    });
    this.checkinSvc.getTrafficLatest().subscribe(d => {
      this.trafficData = d;
      this.tryRender();
    });
  }

  ngAfterViewInit() {
    setTimeout(() => this.initMap(), 300);
  }

  async initMap() {
    this.map = L.map('mobile-map').setView([CBE_LAT, CBE_LNG], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(this.map);

    this.junctionLayer = L.layerGroup().addTo(this.map);

    // Show user location
    try {
      const pos = await this.geo.getCurrentPosition();
      const myIcon = L.divIcon({
        html: '<div style="background:#1976d2;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',
        iconSize: [16, 16], iconAnchor: [8, 8], className: '',
      });
      L.marker([pos.lat, pos.lng], { icon: myIcon })
        .addTo(this.map)
        .bindPopup('<b>You are here</b>');
      L.circle([pos.lat, pos.lng], {
        radius: 200, color: '#1976d2', fillColor: '#1976d2', fillOpacity: 0.08, weight: 1,
      }).addTo(this.map);
    } catch (e) {}

    this.tryRender();
  }

  tryRender() {
    if (!this.map || !this.junctionLayer) return;
    this.junctionLayer.clearLayers();
    this.renderJunctions();
  }

  getColor(level: string): string {
    const m: Record<string, string> = {
      usual: '#4caf50',
      normal: '#ff9800',
      intermediate: '#f44336',
      heavy: '#7b1fa2',
    };
    return m[level] || '#9e9e9e';
  }

  renderJunctions() {
    // Works for 5 or 500 junctions — circleMarkers are SVG-based and very fast
    this.junctions.forEach(j => {
      const traffic = this.trafficData.find(t => t.junction_id === j.id);
      const color = this.getColor(traffic?.congestion_level);
      const radius = traffic
        ? Math.min(8 + traffic.delay_minutes, 24)   // scales with delay, max 24px
        : 8;

      const marker = L.circleMarker([j.lat, j.lng], {
        radius,
        color: '#fff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      });

      // Tooltip: short name always visible at zoom ≥ 13, hidden below
      marker.bindTooltip(j.short_name, {
        permanent: true,
        direction: 'top',
        offset: [0, -radius - 2],
        className: 'junction-label',
        opacity: 1,
      });

      // Popup on tap: full details
      marker.bindPopup(
        `<div style="min-width:160px">
          <b style="font-size:13px">${j.name}</b><br>
          <span style="color:#666;font-size:11px">${j.station || ''}</span><br><br>
          <span style="font-size:12px">Delay: <b>${traffic?.delay_minutes ?? '—'} min</b></span><br>
          <span style="font-size:12px">Status: <b style="color:${color}">${(traffic?.congestion_level ?? 'No data').toUpperCase()}</b></span>
        </div>`
      );

      this.junctionLayer.addLayer(marker);
    });

    // Auto-zoom to fit all junctions on screen
    if (this.junctions.length > 0) {
      const bounds = L.latLngBounds(this.junctions.map(j => [j.lat, j.lng] as [number, number]));
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }
}
