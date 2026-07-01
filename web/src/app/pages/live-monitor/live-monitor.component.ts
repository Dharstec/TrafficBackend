import { Component, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { TrafficService } from '../../core/services/traffic.service';
import { OfficerService } from '../../core/services/officer.service';
import { JunctionService } from '../../core/services/junction.service';
import { SocketService } from '../../core/services/socket.service';
import { JunctionRouteService } from '../../core/services/junction-route.service';
import { Subscription } from 'rxjs';
import * as L from 'leaflet';

@Component({
  selector: 'app-live-monitor',
  templateUrl: './live-monitor.component.html',
})
export class LiveMonitorComponent implements OnInit, AfterViewInit, OnDestroy {
  trafficData: any[] = [];      // junction-level (fallback)
  routeTrafficData: any[] = []; // route-level (preferred)
  liveOfficers: any[] = [];
  todayDuty: any[] = [];
  heavyAlerts: any[] = [];

  get hasRoutes() { return this.routeTrafficData.length > 0; }
  // Use route data if available, else junction data
  get displayData() { return this.hasRoutes ? this.routeTrafficData : this.trafficData; }
  activeTab: 'map' | 'officers' | 'duty' = 'map';
  lastUpdate = new Date();

  // Filters for each panel
  searchFreeFlow = '';
  filterFreeFlow = '';
  searchUsual = '';
  filterUsual = '';

  private map: L.Map;
  private junctionLayers = new Map<number, L.CircleMarker>();
  private officerLayers = new Map<number, L.Marker>();
  private subs: Subscription[] = [];

  constructor(
    private trafficSvc: TrafficService,
    private officerSvc: OfficerService,
    private junctionSvc: JunctionService,
    private socket: SocketService,
    private routeSvc: JunctionRouteService,
  ) {}

  ngOnInit() {
    this.load();
    this.subs.push(
      this.socket.trafficUpdates$.subscribe(updates => {
        updates.forEach(u => {
          const idx = this.trafficData.findIndex(d => d.junction_id === u.junction_id);
          if (idx >= 0) this.trafficData[idx] = { ...this.trafficData[idx], ...u };
          else this.trafficData.push(u);
          if (this.map) this.updateMapCircle(u);
        });
        this.lastUpdate = new Date();
      }),
      this.socket.officerLocations$.subscribe(loc => this.updateOfficerMarker(loc)),
      this.socket.heavyAlerts$.subscribe(alert => {
        this.heavyAlerts.unshift({ ...alert, time: new Date(), acknowledged: false });
        if (this.heavyAlerts.length > 20) this.heavyAlerts.pop();
      }),
      this.socket.trafficCleared$.subscribe(() => this.load()),
    );
  }

  ngAfterViewInit() {
    this.initMap();
  }

  load() {
    this.loadTodayDuty();
    this.trafficSvc.getLatest().subscribe(data => {
      this.trafficData = data;
      if (this.map && !this.hasRoutes) this.renderJunctionCircles(data);
    });
    // Load route-level traffic (preferred when routes exist)
    this.routeSvc.getLatestTraffic().subscribe(data => {
      this.routeTrafficData = data;
      if (this.map && data.length > 0) this.renderJunctionCircles(data.map(r => ({
        ...r, lat: r.junction_lat, lng: r.junction_lng,
      })));
    });
    this.officerSvc.getLiveLocations().subscribe(data => {
      this.liveOfficers = data;
      if (this.map) this.renderOfficerMarkers(data);
    });
  }

  loadTodayDuty() {
    this.officerSvc.getAllTodayDuty().subscribe(d => this.todayDuty = d);
  }

  acknowledgeAlert(i: number) { this.heavyAlerts[i].acknowledged = true; }

  // Delay from Free Flow — sorted by highest delay, routes preferred
  get freeFlowTraffic() {
    return this.displayData
      .filter(d =>
        (!this.searchFreeFlow ||
          d.junction_name?.toLowerCase().includes(this.searchFreeFlow.toLowerCase()) ||
          d.coming_from?.toLowerCase().includes(this.searchFreeFlow.toLowerCase()) ||
          d.station?.toLowerCase().includes(this.searchFreeFlow.toLowerCase())) &&
        (!this.filterFreeFlow || d.congestion_level === this.filterFreeFlow)
      )
      .sort((a, b) => (+b.delay_minutes || 0) - (+a.delay_minutes || 0));
  }

  // Delay from Usual Traffic — sorted by highest unusual delay
  get usualTraffic() {
    return this.displayData
      .filter(d =>
        (!this.searchUsual ||
          d.junction_name?.toLowerCase().includes(this.searchUsual.toLowerCase()) ||
          d.coming_from?.toLowerCase().includes(this.searchUsual.toLowerCase()) ||
          d.station?.toLowerCase().includes(this.searchUsual.toLowerCase())) &&
        (!this.filterUsual || d.congestion_level === this.filterUsual)
      )
      .sort((a, b) => (+b.usual_delay_minutes || 0) - (+a.usual_delay_minutes || 0));
  }

  formatDuration(min: number): string {
    if (!min || min < 1) return '< 1m';
    const h = Math.floor(min / 60); const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  getCongestionColor(level: string): string {
    const m: any = { usual: '#4caf50', normal: '#ff9800', intermediate: '#f44336', heavy: '#7b1fa2' };
    return m[level] || '#9e9e9e';
  }

  initMap() {
    this.map = L.map('live-map').setView([11.0168, 76.9558], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(this.map);

    const legend = (L as any).control({ position: 'topright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'bg-white p-2 rounded shadow-sm');
      div.style.fontSize = '0.75rem';
      div.innerHTML = `
        <div class="fw-bold mb-1">Congestion</div>
        <div><span style="background:#4caf50;display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px"></span>Usual</div>
        <div><span style="background:#ff9800;display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px"></span>Normal</div>
        <div><span style="background:#f44336;display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px"></span>Intermediate</div>
        <div><span style="background:#7b1fa2;display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px"></span>Heavy</div>
        <hr class="my-1">
        <div><span style="background:#1976d2;display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px"></span>Officer</div>`;
      return div;
    };
    legend.addTo(this.map);

    if (this.trafficData.length) this.renderJunctionCircles(this.trafficData);
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  renderJunctionCircles(data: any[]) {
    data.forEach(d => {
      const color = this.getCongestionColor(d.congestion_level);
      const radius = Math.min(8 + (+d.delay_minutes || 1), 24);
      if (this.junctionLayers.has(d.junction_id)) {
        const m = this.junctionLayers.get(d.junction_id)!;
        m.setStyle({ color, fillColor: color });
        m.setRadius(radius);
      } else {
        const circle = L.circleMarker([d.lat, d.lng], {
          radius, color, fillColor: color, fillOpacity: 0.85, weight: 2,
        }).addTo(this.map);
        circle.bindTooltip(d.short_name || d.junction_name, {
          permanent: true, direction: 'top',
          offset: [0, -radius - 2],
          className: 'junction-web-label',
          opacity: 1,
        });
        circle.bindPopup(`
          <b>${d.junction_name}</b><br>
          Station: ${d.station}<br>
          Delay (free flow): <b>${d.delay_minutes} min</b><br>
          Delay (vs usual): <b>${d.usual_delay_minutes > 0 ? '+' + d.usual_delay_minutes + ' min' : 'No delay'}</b><br>
          Status: <b style="color:${color}">${d.congestion_level?.toUpperCase()}</b>
        `);
        this.junctionLayers.set(d.junction_id, circle);
      }
    });

    if (data.length > 0) {
      const bounds = L.latLngBounds(data.map(d => [d.lat, d.lng] as [number, number]));
      this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    }
  }

  updateMapCircle(u: any) {
    const circle = this.junctionLayers.get(u.junction_id);
    if (circle) {
      const color = this.getCongestionColor(u.congestion_level);
      circle.setStyle({ color, fillColor: color });
      circle.setRadius(Math.min(8 + (+u.delay_minutes || 1), 24));
    }
  }

  renderOfficerMarkers(officers: any[]) {
    officers.forEach(o => this.updateOfficerMarker(o));
  }

  updateOfficerMarker(o: any) {
    if (!this.map) return;
    const icon = L.divIcon({
      html: `<div style="background:#1976d2;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${o.badge_number?.slice(-2) || 'PO'}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    if (this.officerLayers.has(o.officer_id)) {
      this.officerLayers.get(o.officer_id)!.setLatLng([o.lat, o.lng]);
    } else {
      const marker = L.marker([o.lat, o.lng], { icon }).addTo(this.map);
      marker.bindPopup(`<b>${o.name}</b><br>Badge: ${o.badge_number}<br>Junction: ${o.junction_name || 'En route'}`);
      this.officerLayers.set(o.officer_id, marker);
    }
  }

  getColor(level: string) { return this.getCongestionColor(level); }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
