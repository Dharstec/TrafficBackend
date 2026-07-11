import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
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
  styleUrls: ['./live-monitor.component.scss'],
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

  // ── Map-first top filter bar (District / Sub Division / Section / Min Delay) ──
  junctionsById: Record<number, any> = {};
  districts: string[] = [];
  subDivisions: string[] = [];
  sections: string[] = [];

  filterDistrict = '';
  filterSubDivision = '';
  filterSection = '';
  filterMinDelay: number | null = null;

  private appliedDistrict = '';
  private appliedSubDivision = '';
  private appliedSection = '';
  private appliedMinDelay: number | null = null;

  // ── Leaflet map ─────────────────────────────────────────────────────
  @ViewChild('leafletEl') leafletEl?: ElementRef<HTMLDivElement>;
  mapReady = false;
  selectedJunctionId: number | null = null;
  panelCollapsed = false;
  private map?: L.Map;
  private junctionMarkers = new Map<number, L.Marker>();
  private junctionDataById = new Map<number, any>();
  private junctionNumberById = new Map<number, number>();
  private nextJunctionNumber = 1;
  private officerMarkers = new Map<number, L.Marker>();

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
    this.loadJunctionMeta();
    this.subs.push(
      this.socket.trafficUpdates$.subscribe(updates => {
        updates.forEach(u => {
          const idx = this.trafficData.findIndex(d => d.junction_id === u.junction_id);
          if (idx >= 0) this.trafficData[idx] = { ...this.trafficData[idx], ...u };
          else this.trafficData.push(u);
          this.updateJunctionPin(u);
        });
        this.lastUpdate = new Date();
      }),
      this.socket.officerLocations$.subscribe(loc => {
        this.upsertOfficerLocation(loc);
        this.updateOfficerMarker(loc);
      }),
      this.socket.heavyAlerts$.subscribe(alert => {
        this.heavyAlerts.unshift({ ...alert, time: new Date(), acknowledged: false });
        if (this.heavyAlerts.length > 20) this.heavyAlerts.pop();
      }),
      this.socket.trafficCleared$.subscribe(() => this.load()),
    );
  }

  ngAfterViewInit() {
    // Defer to the next microtask so the map container has committed to the
    // DOM before Leaflet measures it, and setting mapReady doesn't trigger
    // NG0100 (ExpressionChangedAfterItHasBeenCheckedError) in dev mode.
    Promise.resolve().then(() => this.initMap());
  }

  load() {
    this.loadTodayDuty();
    this.trafficSvc.getLatest().subscribe(data => {
      this.trafficData = data;
      if (!this.hasRoutes) this.renderJunctionPins(data);
    });
    // Load route-level traffic (preferred when routes exist)
    this.routeSvc.getLatestTraffic().subscribe(data => {
      this.routeTrafficData = data;
      if (data.length > 0) {
        this.renderJunctionPins(data.map((r: any) => ({ ...r, lat: r.junction_lat, lng: r.junction_lng })));
      }
    });
    this.officerSvc.getLiveLocations().subscribe(data => {
      this.liveOfficers = data;
      this.renderOfficerMarkers(data);
    });
  }

  upsertOfficerLocation(o: any) {
    const idx = this.liveOfficers.findIndex((x: any) => x.officer_id === o.officer_id);
    if (idx >= 0) this.liveOfficers[idx] = { ...this.liveOfficers[idx], ...o };
    else this.liveOfficers.push(o);
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

  // Merged "Traffic Delay Monitor" — same rows/sort as freeFlowTraffic, plus the
  // District / Sub Division / Section / Min Delay filters from the map top bar.
  get mergedTraffic() {
    return this.freeFlowTraffic.filter(d => {
      const j = this.junctionsById[d.junction_id];
      if (this.appliedDistrict && j?.district !== this.appliedDistrict) return false;
      if (this.appliedSubDivision && j?.sub_division !== this.appliedSubDivision) return false;
      if (this.appliedSection && j?.station !== this.appliedSection && d.station !== this.appliedSection) return false;
      const maxDelay = Math.max(+d.delay_minutes || 0, +d.usual_delay_minutes || 0);
      if (this.appliedMinDelay != null && maxDelay < this.appliedMinDelay) return false;
      return true;
    });
  }

  loadJunctionMeta() {
    this.junctionSvc.getAll().subscribe(list => {
      this.junctionsById = {};
      list.forEach((j: any) => this.junctionsById[j.id] = j);
      this.districts = Array.from(new Set(list.map((j: any) => j.district).filter(Boolean))).sort();
      this.subDivisions = Array.from(new Set(list.map((j: any) => j.sub_division).filter(Boolean))).sort();
      this.sections = Array.from(new Set(list.map((j: any) => j.station).filter(Boolean))).sort();
    });
  }

  searchTraffic() {
    this.appliedDistrict = this.filterDistrict;
    this.appliedSubDivision = this.filterSubDivision;
    this.appliedSection = this.filterSection;
    this.appliedMinDelay = this.filterMinDelay;
  }

  officerForRow(d: any): string {
    const o = this.liveOfficers.find(o => o.junction_name === d.junction_name);
    return o ? o.name : '—';
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

  getColor(level: string) { return this.getCongestionColor(level); }

  // ── Map: single Leaflet engine, standard OpenStreetMap basemap ────────
  initMap() {
    if (!this.leafletEl) return;
    this.map = L.map(this.leafletEl.nativeElement).setView([11.0168, 76.9558], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.mapReady = true;

    if (this.displayData.length) {
      this.renderJunctionPins(this.hasRoutes
        ? this.routeTrafficData.map((r: any) => ({ ...r, lat: r.junction_lat, lng: r.junction_lng }))
        : this.trafficData);
    }
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  // Stable per-junction display number (01, 02, 03…) — assigned once on
  // first sighting and cached, so it never reshuffles as data refreshes.
  private getJunctionNumber(id: number): number {
    if (!this.junctionNumberById.has(id)) {
      this.junctionNumberById.set(id, this.nextJunctionNumber++);
    }
    return this.junctionNumberById.get(id)!;
  }

  // Teardrop pin icon — color and size both driven by the row's JSON fields
  // (congestion_level for color, delay_minutes for size), numbered so pins
  // can be matched back to their row in the Traffic Delay Monitor panel.
  // Selected pins get a pulsing halo + pop-in "lit" state.
  private pinIcon(d: any): L.DivIcon {
    const color = this.getCongestionColor(d.congestion_level);
    const isSelected = this.selectedJunctionId === d.junction_id;
    const label = String(this.getJunctionNumber(d.junction_id)).padStart(2, '0');
    const baseScale = Math.min(1.3, Math.max(0.85, 0.85 + (+d.delay_minutes || 0) / 40));
    const scale = isSelected ? baseScale * 1.15 : baseScale;
    const w = Math.round(26 * scale);
    const h = Math.round(36 * scale);
    const glow = isSelected
      ? `<circle cx="13" cy="13" r="12" fill="${color}" opacity="0.35">
           <animate attributeName="r" values="10;19;10" dur="1.4s" repeatCount="indefinite"/>
           <animate attributeName="opacity" values="0.4;0.05;0.4" dur="1.4s" repeatCount="indefinite"/>
         </circle>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 26 36" overflow="visible">
        ${glow}
        <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 23 13 23s13-13.5 13-23C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#ffffff" stroke-width="${isSelected ? 3 : 2}"/>
        <circle cx="13" cy="13" r="7.5" fill="#ffffff"/>
        <text x="13" y="16" font-size="7.5" font-family="Arial" font-weight="700" fill="${color}" text-anchor="middle">${label}</text>
      </svg>`;
    return L.divIcon({
      html: svg,
      className: 'lm-pin-icon' + (isSelected ? ' lm-pin-selected' : ''),
      iconSize: [w, h],
      iconAnchor: [w / 2, h],
      popupAnchor: [0, -h + 6],
    });
  }

  renderJunctionPins(data: any[]) {
    if (!this.map) return;
    data.forEach(d => {
      this.junctionDataById.set(d.junction_id, d);
      const icon = this.pinIcon(d);
      if (this.junctionMarkers.has(d.junction_id)) {
        const m = this.junctionMarkers.get(d.junction_id)!;
        m.setIcon(icon);
        m.setLatLng([d.lat, d.lng]);
      } else {
        const marker = L.marker([d.lat, d.lng], { icon }).addTo(this.map!);
        marker.bindTooltip(d.short_name || d.junction_name, {
          permanent: true, direction: 'top',
          offset: [0, -34],
          className: 'junction-web-label',
          opacity: 1,
        });
        marker.bindPopup(this.junctionPopup(d));
        marker.on('click', () => this.selectJunction(d));
        this.junctionMarkers.set(d.junction_id, marker);
      }
    });

    if (data.length > 0) {
      const bounds = L.latLngBounds(data.map(d => [d.lat, d.lng] as [number, number]));
      this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    }
  }

  updateJunctionPin(u: any) {
    const marker = this.junctionMarkers.get(u.junction_id);
    if (marker) {
      this.junctionDataById.set(u.junction_id, u);
      marker.setIcon(this.pinIcon(u));
      marker.setPopupContent(this.junctionPopup(u));
    }
  }

  // Clicking a row in the Traffic Delay Monitor panel (or a pin itself) pans/
  // zooms the map to that junction and lights up its pin with a pulsing halo.
  selectJunction(d: any) {
    const id = d.junction_id;
    const prevId = this.selectedJunctionId;
    this.selectedJunctionId = id;

    if (prevId != null && prevId !== id) this.refreshPinIcon(prevId);
    this.refreshPinIcon(id);

    const marker = this.junctionMarkers.get(id);
    if (marker && this.map) {
      this.map.flyTo(marker.getLatLng(), Math.max(this.map.getZoom(), 16), { duration: 0.6 });
      marker.openPopup();
    }
  }

  private refreshPinIcon(id: number) {
    const marker = this.junctionMarkers.get(id);
    const data = this.junctionDataById.get(id);
    if (marker && data) marker.setIcon(this.pinIcon(data));
  }

  private junctionPopup(d: any): string {
    const color = this.getCongestionColor(d.congestion_level);
    const usualColor = d.usual_delay_minutes > 0 ? '#d93025' : '#188038';
    return `
      <div style="font-family:'Segoe UI',Arial,sans-serif">
        <b>${d.junction_name}</b><br>
        Station: ${d.station || '—'}<br>
        Delay (free flow): <b style="color:${color}">${d.delay_minutes} min</b><br>
        Delay (vs usual): <b style="color:${usualColor}">${d.usual_delay_minutes > 0 ? '+' + d.usual_delay_minutes + ' min' : 'No delay'}</b><br>
        Status: <b style="color:${color}">${(d.congestion_level || '').toUpperCase()}</b>
      </div>
    `;
  }

  renderOfficerMarkers(officers: any[]) {
    officers.forEach(o => this.updateOfficerMarker(o));
  }

  updateOfficerMarker(o: any) {
    if (!this.map) return;
    const icon = L.divIcon({
      html: `<div style="background:#1976d2;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 4px rgba(0,0,0,0.3)">${o.badge_number?.slice(-2) || 'PO'}</div>`,
      className: '',
      iconSize: [28, 28], iconAnchor: [14, 14],
    });
    if (this.officerMarkers.has(o.officer_id)) {
      this.officerMarkers.get(o.officer_id)!.setLatLng([o.lat, o.lng]);
    } else {
      const marker = L.marker([o.lat, o.lng], { icon }).addTo(this.map);
      marker.bindPopup(`<div style="font-family:'Segoe UI',Arial,sans-serif"><b>${o.name}</b><br>Badge: ${o.badge_number}<br>Junction: ${o.junction_name || 'En route'}</div>`);
      this.officerMarkers.set(o.officer_id, marker);
    }
  }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
