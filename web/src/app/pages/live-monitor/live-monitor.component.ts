import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { TrafficService } from '../../core/services/traffic.service';
import { OfficerService } from '../../core/services/officer.service';
import { JunctionService } from '../../core/services/junction.service';
import { SocketService } from '../../core/services/socket.service';
import { JunctionRouteService } from '../../core/services/junction-route.service';
import { UiService } from '../../core/services/ui.service';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
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
  refreshing = false;

  // Filters for each panel
  searchFreeFlow = '';
  filterFreeFlow = '';
  searchUsual = '';
  filterUsual = '';

  // ── Floating filter chips (District / Sub Division / Section / Min Delay) ──
  junctionsById: Record<number, any> = {};
  districts: string[] = [];
  subDivisions: string[] = [];
  sections: string[] = [];
  minDelayOptions = [1, 3, 6, 10];

  filterDistrict = '';
  filterSubDivision = '';
  filterSection = '';
  filterMinDelay: number | null = null;

  // Which chip's dropdown panel is currently open (null = all closed).
  // The panel is position:fixed and anchored to the clicked chip's
  // bounding rect — the chip row scrolls horizontally, and CSS overflow-x:
  // auto on an ancestor forces overflow-y to clip too, so an absolutely
  // positioned dropdown inside that row gets cut off.
  openChip: 'district' | 'subDivision' | 'section' | 'minDelay' | null = null;
  chipPanelPos = { top: 0, left: 0 };

  // ── Leaflet map ─────────────────────────────────────────────────────
  @ViewChild('leafletEl') leafletEl?: ElementRef<HTMLDivElement>;
  mapReady = false;
  selectedJunctionId: number | null = null;
  panelCollapsed = false;
  baseLayer: 'map' | 'satellite' | 'terrain' | 'dark' = 'map';
  private map?: L.Map;
  private baseLayers: Partial<Record<'map' | 'satellite' | 'terrain' | 'dark', L.TileLayer>> = {};
  private satLabels?: L.TileLayer;
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
    private ui: UiService,
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
      // Sidebar collapse changes the map container's width — re-measure
      // Leaflet once the 0.25s CSS width transition has finished.
      this.ui.sidebarCollapsed$.pipe(skip(1)).subscribe(() => {
        setTimeout(() => this.map?.invalidateSize({ animate: true }), 280);
      }),
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

  // Map shell is [hidden] while other tabs are active — after re-showing,
  // Leaflet must re-measure the container or tiles/pins render misaligned.
  showMapTab() {
    this.activeTab = 'map';
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  acknowledgeAlert(i: number) { this.heavyAlerts[i].acknowledged = true; }

  // Manual Google API refresh — backend runs its full pass (one Directions
  // call per route), then we re-pull the tables. WebSocket pushes update the
  // pins live while it runs.
  refreshNow() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.trafficSvc.refreshNow().subscribe({
      next: () => {
        this.load();
        this.lastUpdate = new Date();
        this.refreshing = false;
      },
      error: () => { this.refreshing = false; },
    });
  }

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
  // District / Sub Division / Section / Min Delay filter chips floating over the map.
  get mergedTraffic() {
    return this.freeFlowTraffic.filter(d => this.passesChipFilters(d));
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

  toggleChip(name: 'district' | 'subDivision' | 'section' | 'minDelay', event: MouseEvent) {
    if (this.openChip === name) {
      this.openChip = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.chipPanelPos = { top: rect.bottom + 6, left: rect.left };
    this.openChip = name;
  }

  selectDistrict(v: string) { this.filterDistrict = v; this.openChip = null; this.applyChipFilters(); }
  selectSubDivision(v: string) { this.filterSubDivision = v; this.openChip = null; this.applyChipFilters(); }
  selectSection(v: string) { this.filterSection = v; this.openChip = null; this.applyChipFilters(); }
  selectMinDelay(v: number | null) { this.filterMinDelay = v; this.openChip = null; this.applyChipFilters(); }

  clearAllFilters() {
    this.filterDistrict = '';
    this.filterSubDivision = '';
    this.filterSection = '';
    this.filterMinDelay = null;
    this.openChip = null;
    this.applyChipFilters();
  }

  private passesChipFilters(d: any): boolean {
    const j = this.junctionsById[d.junction_id];
    if (this.filterDistrict && j?.district !== this.filterDistrict) return false;
    if (this.filterSubDivision && j?.sub_division !== this.filterSubDivision) return false;
    if (this.filterSection && j?.station !== this.filterSection && d.station !== this.filterSection) return false;
    const maxDelay = Math.max(+d.delay_minutes || 0, +d.usual_delay_minutes || 0);
    if (this.filterMinDelay != null && maxDelay < this.filterMinDelay) return false;
    return true;
  }

  private get pinSourceData() {
    return this.hasRoutes
      ? this.routeTrafficData.map((r: any) => ({ ...r, lat: r.junction_lat, lng: r.junction_lng }))
      : this.trafficData;
  }

  // Instantly reflects the filter chips on the map by toggling marker
  // visibility, without re-fitting bounds or losing the current view.
  private applyChipFilters() {
    if (!this.map) return;
    const visibleIds = new Set(this.pinSourceData.filter(d => this.passesChipFilters(d)).map(d => d.junction_id));
    this.junctionMarkers.forEach((marker, id) => {
      const shouldShow = visibleIds.has(id);
      const onMap = this.map!.hasLayer(marker);
      if (shouldShow && !onMap) marker.addTo(this.map!);
      if (!shouldShow && onMap) this.map!.removeLayer(marker);
    });
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

  // ── Map: single Leaflet engine, Google-Maps-style base layers ─────────
  // All tiles are free with attribution — no Google billing:
  //   Default   → CARTO Voyager (clean, Google-like light cartography)
  //   Satellite → Esri World Imagery + Esri place labels
  //   Terrain   → OpenTopoMap
  //   Dark      → CARTO Dark Matter (control-room night mode)
  initMap() {
    if (!this.leafletEl) return;
    this.map = L.map(this.leafletEl.nativeElement, { zoomControl: false })
      .setView([11.0168, 76.9558], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    this.baseLayers = {
      map: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19,
      }),
      satellite: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Esri, Maxar, Earthstar Geographics', maxZoom: 19 },
      ),
      terrain: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)',
        maxZoom: 17,
      }),
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 19,
      }),
    };
    this.satLabels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Esri', maxZoom: 19 },
    );
    this.baseLayers.map!.addTo(this.map);

    this.mapReady = true;

    if (this.displayData.length) {
      this.renderJunctionPins(this.hasRoutes
        ? this.routeTrafficData.map((r: any) => ({ ...r, lat: r.junction_lat, lng: r.junction_lng }))
        : this.trafficData);
    }
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  setBaseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    if (!this.map || layer === this.baseLayer) return;
    const prev = this.baseLayers[this.baseLayer];
    if (prev) this.map.removeLayer(prev);
    if (this.satLabels) this.map.removeLayer(this.satLabels);

    this.baseLayer = layer;
    this.baseLayers[layer]?.addTo(this.map);
    if (layer === 'satellite') this.satLabels?.addTo(this.map);
  }

  // Big preview thumb (Google Maps behavior): one tap flips Map ↔ Satellite.
  toggleQuickLayer() {
    this.setBaseLayer(this.baseLayer === 'satellite' ? 'map' : 'satellite');
  }

  // Google's "my location" equivalent — re-fit the view around every pin.
  fitAllPins() {
    if (!this.map || this.junctionMarkers.size === 0) return;
    const pts: [number, number][] = [];
    this.junctionMarkers.forEach(m => {
      if (this.map!.hasLayer(m)) {
        const ll = m.getLatLng();
        pts.push([ll.lat, ll.lng]);
      }
    });
    if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
  }

  // Stable per-junction display number (01, 02, 03…) — assigned once on
  // first sighting and cached, so it never reshuffles as data refreshes.
  private getJunctionNumber(id: number): number {
    if (!this.junctionNumberById.has(id)) {
      this.junctionNumberById.set(id, this.nextJunctionNumber++);
    }
    return this.junctionNumberById.get(id)!;
  }

  // Pin size tier by delay severity: 1-2m small, 3-5m medium, 6-9m large,
  // 10m+ extra large — the higher the delay, the more noticeable the pin.
  private pinSizeForDelay(delayMinutes: number): { w: number; h: number } {
    const d = +delayMinutes || 0;
    if (d >= 10) return { w: 40, h: 55 }; // Extra large
    if (d >= 6) return { w: 33, h: 45 };  // Large
    if (d >= 3) return { w: 27, h: 37 };  // Medium
    return { w: 22, h: 30 };              // Small (0-2m)
  }

  // Teardrop pin icon — color and size both driven by the row's JSON fields
  // (congestion_level for color, delay_minutes for size), numbered so pins
  // can be matched back to their row in the Traffic Delay Monitor panel.
  // Selected pins get a pulsing halo + pop-in "lit" state.
  private pinIcon(d: any): L.DivIcon {
    const color = this.getCongestionColor(d.congestion_level);
    const isSelected = this.selectedJunctionId === d.junction_id;
    const label = String(this.getJunctionNumber(d.junction_id)).padStart(2, '0');
    const { w: baseW, h: baseH } = this.pinSizeForDelay(d.delay_minutes);
    const selMult = isSelected ? 1.15 : 1;
    const w = Math.round(baseW * selMult);
    const h = Math.round(baseH * selMult);
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

    this.applyChipFilters();
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
