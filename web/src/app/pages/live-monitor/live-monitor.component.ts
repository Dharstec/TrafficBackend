import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TrafficService } from '../../core/services/traffic.service';
import { OfficerService } from '../../core/services/officer.service';
import { JunctionService } from '../../core/services/junction.service';
import { SocketService } from '../../core/services/socket.service';
import { JunctionRouteService } from '../../core/services/junction-route.service';
import { UiService } from '../../core/services/ui.service';
import { environment } from '../../environments/environment';
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import * as L from 'leaflet';

// Google Maps JS API is loaded at runtime only when mapEngine==='google'.
declare const google: any;

// ── DUAL MAP ENGINE ────────────────────────────────────────────────────
// environment.mapEngine decides which engine runs:
//   'google'  → real Google Map + live TrafficLayer (exact Google look,
//               free up to 10,000 map loads/month)
//   'leaflet' → 100% free forever (CARTO tiles + our own route ribbons)
// Both engines share ALL data logic — pins, popups, filters, panel.
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
  // Time of the newest traffic row in the DB — NOT the page-open time.
  lastUpdate: Date | null = null;
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

  openChip: 'district' | 'subDivision' | 'section' | 'minDelay' | null = null;
  chipPanelPos = { top: 0, left: 0 };

  // ── Map state (shared between engines) ──────────────────────────────
  @ViewChild('leafletEl') leafletEl?: ElementRef<HTMLDivElement>;
  mapReady = false;
  mapKeyMissing = false;
  selectedJunctionId: number | null = null;
  panelCollapsed = false;
  layersExpanded = false;
  baseLayer: 'map' | 'satellite' | 'terrain' | 'dark' = 'map';

  get useGoogle(): boolean {
    return environment.mapEngine === 'google' && !!environment.googleMapsKey;
  }

  // Leaflet engine
  private map?: L.Map;
  private baseLayers: Partial<Record<'map' | 'satellite' | 'terrain' | 'dark', L.TileLayer>> = {};
  private satLabels?: L.TileLayer;
  // One road-ribbon per route: colored fill + slightly darker edge (Leaflet only —
  // on the Google engine the built-in TrafficLayer colors every road instead).
  private routeLines = new Map<number, { casing: L.Polyline; main: L.Polyline }>();
  private cityMaskL?: L.Polygon;

  // Google engine
  private gmap: any;
  private trafficLayer: any;
  private infoWindow: any;
  private cityMaskG: any;

  // Shared marker registries (hold L.Marker or google.maps.Marker)
  private junctionMarkers = new Map<number, any>();
  private junctionDataById = new Map<number, any>();
  private junctionNumberById = new Map<number, number>();
  private nextJunctionNumber = 1;
  private officerMarkers = new Map<number, any>();

  private subs: Subscription[] = [];

  constructor(
    private trafficSvc: TrafficService,
    private officerSvc: OfficerService,
    private junctionSvc: JunctionService,
    private socket: SocketService,
    private routeSvc: JunctionRouteService,
    private ui: UiService,
    private http: HttpClient,
  ) {}

  ngOnInit() {
    this.load();
    this.loadJunctionMeta();
    this.subs.push(
      this.socket.trafficUpdates$.subscribe(updates => {
        let routeChanged = false;
        updates.forEach(u => {
          if (u.route_id) {
            const ri = this.routeTrafficData.findIndex((r: any) => (r.route_id ?? r.id) === u.route_id);
            if (ri >= 0) this.routeTrafficData[ri] = { ...this.routeTrafficData[ri], ...u };
            else this.routeTrafficData.push(u);
            routeChanged = true;
          } else {
            const idx = this.trafficData.findIndex(d => d.junction_id === u.junction_id);
            if (idx >= 0) this.trafficData[idx] = { ...this.trafficData[idx], ...u };
            else this.trafficData.push(u);
            this.updateJunctionPin(u);
          }
        });
        if (routeChanged) {
          this.renderJunctionPins(this.pinSourceData);
          this.renderRouteLines(this.routeTrafficData);
        }
        this.touchLastUpdate(updates);
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
      // Sidebar collapse changes the map container's width — Leaflet needs a
      // manual re-measure; the Google engine watches its container itself.
      this.ui.sidebarCollapsed$.pipe(skip(1)).subscribe(() => {
        setTimeout(() => { if (!this.useGoogle) this.map?.invalidateSize({ animate: true }); }, 280);
      }),
    );
  }

  ngAfterViewInit() {
    Promise.resolve().then(() => this.initMap());
  }

  load() {
    // Today's Duty tab removed from the UI — loadTodayDuty() kept but not called.
    this.trafficSvc.getLatest().subscribe(data => {
      this.trafficData = data;
      this.touchLastUpdate(data);
      if (!this.hasRoutes) this.renderJunctionPins(this.pinSourceData);
    });
    this.routeSvc.getLatestTraffic().subscribe(data => {
      this.routeTrafficData = data;
      this.touchLastUpdate(data);
      if (data.length > 0) {
        this.renderJunctionPins(this.pinSourceData);
        this.renderRouteLines(data);
      }
    });
    this.officerSvc.getLiveLocations().subscribe(data => {
      this.liveOfficers = data;
      this.renderOfficerMarkers(data);
    });
  }

  // Header time = newest row's DB timestamp, never the browser clock.
  private touchLastUpdate(rows: any[]) {
    const ts = rows.map(r => new Date(r.time).getTime()).filter(t => !isNaN(t));
    if (!ts.length) return;
    const newest = new Date(Math.max(...ts));
    if (!this.lastUpdate || newest > this.lastUpdate) this.lastUpdate = newest;
  }

  upsertOfficerLocation(o: any) {
    const idx = this.liveOfficers.findIndex((x: any) => x.officer_id === o.officer_id);
    if (idx >= 0) this.liveOfficers[idx] = { ...this.liveOfficers[idx], ...o };
    else this.liveOfficers.push(o);
  }

  loadTodayDuty() {
    this.officerSvc.getAllTodayDuty().subscribe(d => this.todayDuty = d);
  }

  // Map shell is [hidden] while other tabs are active — re-measure on return.
  showMapTab() {
    this.activeTab = 'map';
    setTimeout(() => {
      if (this.useGoogle) {
        if (this.gmap && (window as any).google) google.maps.event.trigger(this.gmap, 'resize');
      } else {
        this.map?.invalidateSize();
      }
    }, 50);
  }

  acknowledgeAlert(i: number) { this.heavyAlerts[i].acknowledged = true; }

  // Manual Google API refresh — ONE Directions call per route (usual comes
  // from DB history, free). Quota status lives in the backend logs.
  refreshNow() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.trafficSvc.refreshNow().subscribe({
      next: () => {
        this.load();
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

  get mergedTraffic() {
    return this.freeFlowTraffic.filter(d => this.passesChipFilters(d));
  }

  // ── Panel grouping: one collapsible block per junction, default expanded ──
  collapsedJunctions = new Set<number>();

  toggleGroup(id: number) {
    if (this.collapsedJunctions.has(id)) this.collapsedJunctions.delete(id);
    else this.collapsedJunctions.add(id);
  }

  isCollapsed(id: number) { return this.collapsedJunctions.has(id); }

  get groupedTraffic() {
    const groups = new Map<number, any>();
    for (const d of this.mergedTraffic) {
      let g = groups.get(d.junction_id);
      if (!g) {
        g = {
          junction_id: d.junction_id,
          junction_name: d.junction_name,
          short_name: d.short_name,
          station: d.station,
          rows: [],
        };
        groups.set(d.junction_id, g);
      }
      g.rows.push(d);
    }
    return Array.from(groups.values()).map(g => ({ ...g, worst: g.rows[0] }));
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

  // One pin per junction: worst road drives color/size; all roads kept for the popup.
  private get pinSourceData() {
    if (!this.hasRoutes) return this.trafficData;
    const byJunction = new Map<number, any[]>();
    this.routeTrafficData.forEach((r: any) => {
      const list = byJunction.get(r.junction_id) || [];
      list.push(r);
      byJunction.set(r.junction_id, list);
    });
    return Array.from(byJunction.values()).map(routes => {
      const sorted = [...routes].sort((a, b) => (+b.delay_minutes || 0) - (+a.delay_minutes || 0));
      const worst = sorted[0];
      return {
        ...worst,
        lat: worst.junction_lat ?? this.junctionsById[worst.junction_id]?.lat,
        lng: worst.junction_lng ?? this.junctionsById[worst.junction_id]?.lng,
        all_routes: sorted,
      };
    }).filter(d => d.lat != null && d.lng != null);
  }

  // Toggles marker (and Leaflet ribbon) visibility to match the filter chips.
  private applyChipFilters() {
    const activeMap = this.useGoogle ? this.gmap : this.map;
    if (!activeMap) return;
    const visibleIds = new Set(this.pinSourceData.filter(d => this.passesChipFilters(d)).map(d => d.junction_id));

    this.junctionMarkers.forEach((marker, id) => {
      const shouldShow = visibleIds.has(id);
      if (this.useGoogle) {
        const onMap = marker.getMap() != null;
        if (shouldShow && !onMap) marker.setMap(this.gmap);
        if (!shouldShow && onMap) marker.setMap(null);
      } else {
        const onMap = this.map!.hasLayer(marker);
        if (shouldShow && !onMap) marker.addTo(this.map!);
        if (!shouldShow && onMap) this.map!.removeLayer(marker);
      }
    });

    if (!this.useGoogle) {
      this.routeLines.forEach(group => {
        const shouldShow = visibleIds.has((group.main as any)._junctionId);
        [group.casing, group.main].forEach(layer => {
          const onMap = this.map!.hasLayer(layer);
          if (shouldShow && !onMap) layer.addTo(this.map!);
          if (!shouldShow && onMap) this.map!.removeLayer(layer);
        });
      });
    }
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
    const m: any = { usual: '#4caf50', normal: '#ff9800', intermediate: '#f44336', heavy: '#795548' };
    return m[level] || '#9e9e9e';
  }

  getColor(level: string) { return this.getCongestionColor(level); }

  // ── Engine dispatch ──────────────────────────────────────────────────
  initMap() {
    if (!this.leafletEl) return;
    if (this.useGoogle) this.initGoogleMap();
    else this.initLeafletMap();
  }

  renderJunctionPins(data: any[]) {
    if (this.useGoogle) this.gRenderJunctionPins(data);
    else this.lfRenderJunctionPins(data);
  }

  updateJunctionPin(u: any) {
    const marker = this.junctionMarkers.get(u.junction_id);
    if (!marker) return;
    this.junctionDataById.set(u.junction_id, u);
    marker.setIcon(this.useGoogle ? this.gPinIcon(u) : this.lfPinIcon(u));
    if (!this.useGoogle) marker.setPopupContent(this.junctionPopup(u));
  }

  selectJunction(d: any) {
    const id = d.junction_id;
    const prevId = this.selectedJunctionId;
    this.selectedJunctionId = id;
    if (prevId != null && prevId !== id) this.refreshPinIcon(prevId);
    this.refreshPinIcon(id);

    const marker = this.junctionMarkers.get(id);
    if (!marker) return;
    if (this.useGoogle && this.gmap) {
      this.gmap.panTo(marker.getPosition());
      if (this.gmap.getZoom() < 16) this.gmap.setZoom(16);
      const data = this.junctionDataById.get(id) || d;
      this.infoWindow.setContent(this.junctionPopup(data));
      this.infoWindow.open({ map: this.gmap, anchor: marker });
    } else if (this.map) {
      this.map.flyTo(marker.getLatLng(), Math.max(this.map.getZoom(), 16), { duration: 0.6 });
      marker.openPopup();
    }
  }

  private refreshPinIcon(id: number) {
    const marker = this.junctionMarkers.get(id);
    const data = this.junctionDataById.get(id);
    if (marker && data) marker.setIcon(this.useGoogle ? this.gPinIcon(data) : this.lfPinIcon(data));
  }

  renderOfficerMarkers(officers: any[]) {
    officers.forEach(o => this.updateOfficerMarker(o));
  }

  updateOfficerMarker(o: any) {
    if (this.useGoogle) this.gUpdateOfficerMarker(o);
    else this.lfUpdateOfficerMarker(o);
  }

  fitAllPins() {
    if (this.junctionMarkers.size === 0) return;
    if (this.useGoogle && this.gmap && (window as any).google) {
      const bounds = new google.maps.LatLngBounds();
      let any = false;
      this.junctionMarkers.forEach(m => {
        if (m.getMap() != null) { bounds.extend(m.getPosition()); any = true; }
      });
      if (any) this.gmap.fitBounds(bounds, 60);
    } else if (this.map) {
      const pts: [number, number][] = [];
      this.junctionMarkers.forEach(m => {
        if (this.map!.hasLayer(m)) {
          const ll = m.getLatLng();
          pts.push([ll.lat, ll.lng]);
        }
      });
      if (pts.length) this.map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 15 });
    }
  }

  setBaseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    if (layer === this.baseLayer) return;
    if (this.useGoogle) this.gSetBaseLayer(layer);
    else this.lfSetBaseLayer(layer);
  }

  // The big thumb always reflects the CURRENTLY selected layer.
  get currentLayerMeta() {
    const meta = {
      map: { name: 'Default', icon: 'bi-map-fill', thumbClass: 'lm-thumb-map' },
      satellite: { name: 'Satellite', icon: 'bi-globe-americas', thumbClass: 'lm-thumb-sat' },
      terrain: { name: 'Terrain', icon: 'bi-image-alt', thumbClass: 'lm-thumb-terrain' },
      dark: { name: 'Dark', icon: 'bi-moon-stars', thumbClass: 'lm-thumb-dark' },
    };
    return meta[this.baseLayer];
  }

  chooseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    this.setBaseLayer(layer);
    this.layersExpanded = false;
  }

  // ── Shared pin visuals ───────────────────────────────────────────────
  private getJunctionNumber(id: number): number {
    if (!this.junctionNumberById.has(id)) {
      this.junctionNumberById.set(id, this.nextJunctionNumber++);
    }
    return this.junctionNumberById.get(id)!;
  }

  // Pin size tier by congestion level — the worse the traffic, the bigger.
  private pinSizeForLevel(level: string): { w: number; h: number } {
    switch (level) {
      case 'heavy': return { w: 42, h: 58 };
      case 'intermediate': return { w: 34, h: 46 };
      case 'normal': return { w: 28, h: 38 };
      default: return { w: 22, h: 30 }; // usual
    }
  }

  // Teardrop pin SVG shared by both engines.
  private pinSvg(d: any): { svg: string; w: number; h: number; isSelected: boolean } {
    const color = this.getCongestionColor(d.congestion_level);
    const isSelected = this.selectedJunctionId === d.junction_id;
    const label = String(this.getJunctionNumber(d.junction_id)).padStart(2, '0');
    const { w: baseW, h: baseH } = this.pinSizeForLevel(d.congestion_level);
    const selMult = isSelected ? 1.18 : 1;
    const w = Math.round(baseW * selMult);
    const h = Math.round(baseH * selMult);
    const glow = isSelected
      ? `<circle cx="13" cy="13" r="12" fill="${color}" opacity="0.3"/>`
      : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 26 36" overflow="visible">
        ${glow}
        <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 23 13 23s13-13.5 13-23C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#ffffff" stroke-width="${isSelected ? 3 : 2}"/>
        <circle cx="13" cy="13" r="7.5" fill="#ffffff"/>
        <text x="13" y="16" font-size="7.5" font-family="Arial" font-weight="700" fill="${color}" text-anchor="middle">${label}</text>
      </svg>`;
    return { svg, w, h, isSelected };
  }

  private junctionPopup(d: any): string {
    const color = this.getCongestionColor(d.congestion_level);

    if (d.all_routes?.length > 1) {
      const roads = d.all_routes.map((r: any, i: number) => {
        const c = this.getCongestionColor(r.congestion_level);
        const travel = r.total_seconds ? ` · ${Math.round(r.total_seconds / 60)} min travel` : '';
        return `<div style="margin:4px 0;${i === 0 ? 'font-weight:700' : ''}">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};margin-right:6px"></span>
            ${r.coming_from || 'Road ' + (i + 1)} — <b style="color:${c}">${r.delay_minutes}m delay</b>${travel}
          </div>`;
      }).join('');
      return `
        <div style="font-family:'Segoe UI',Arial,sans-serif;min-width:230px">
          <b>${d.junction_name}</b><br>
          <span style="color:#666">Station: ${d.station || '—'}</span>
          <hr style="margin:6px 0">
          <div style="font-size:0.82em;color:#666;margin-bottom:2px">${d.all_routes.length} roads — highest delay first</div>
          ${roads}
        </div>
      `;
    }

    const usualColor = d.usual_delay_minutes > 0 ? '#d93025' : '#188038';
    return `
      <div style="font-family:'Segoe UI',Arial,sans-serif">
        <b>${d.junction_name}</b><br>
        Station: ${d.station || '—'}<br>
        ${d.coming_from ? `Road: ${d.coming_from}<br>` : ''}
        Delay (free flow): <b style="color:${color}">${d.delay_minutes} min</b><br>
        Delay (vs usual): <b style="color:${usualColor}">${d.usual_delay_minutes > 0 ? '+' + d.usual_delay_minutes + ' min' : 'No delay'}</b><br>
        Status: <b style="color:${color}">${(d.congestion_level || '').toUpperCase()}</b>
      </div>
    `;
  }

  private didFitBounds = false;

  private maskFill(): string {
    return this.baseLayer === 'dark' ? '#14161c' : '#e9edf2';
  }

  // ══════════════════════════════════════════════════════════════════════
  // GOOGLE ENGINE — real Google Map + live TrafficLayer on every road
  // ══════════════════════════════════════════════════════════════════════

  private loadGoogleScript(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).google?.maps) return resolve();
      (window as any).__gmapsReady = () => resolve();
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly&loading=async&callback=__gmapsReady`;
      s.async = true;
      s.onerror = () => reject(new Error('Google Maps script failed to load'));
      document.head.appendChild(s);
    });
  }

  private static readonly NIGHT_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
    { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  ];

  private async initGoogleMap() {
    const key = environment.googleMapsKey;
    try {
      await this.loadGoogleScript(key);
    } catch {
      this.mapKeyMissing = true;
      return;
    }

    // City-locked: opens on Chennai, cannot pan/zoom away from the city.
    this.gmap = new google.maps.Map(this.leafletEl!.nativeElement, {
      center: { lat: 13.0475, lng: 80.2090 },
      zoom: 11,
      minZoom: 11,
      restriction: {
        latLngBounds: { north: 13.35, south: 12.75, east: 80.40, west: 79.90 },
        strictBounds: true,
      },
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
      clickableIcons: false,
      mapTypeId: 'roadmap',
    });

    // THE feature: Google's own live traffic on every road in the city.
    this.trafficLayer = new google.maps.TrafficLayer();
    this.trafficLayer.setMap(this.gmap);

    this.infoWindow = new google.maps.InfoWindow();

    this.http.get<[number, number][][]>('assets/chennai-boundary.json').subscribe({
      next: rings => this.gAddCityMask(rings),
      error: () => {},
    });

    this.mapReady = true;

    if (this.displayData.length) this.renderJunctionPins(this.pinSourceData);
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  private gAddCityMask(rings: [number, number][][]) {
    if (!this.gmap || !(window as any).google) return;

    // Outer ring = only the locked pan area (not the whole world — a
    // world-sized ring wraps unpredictably on Google's renderer and can
    // blank the whole map). Pan is restricted to this box anyway, so
    // masking beyond it is pointless.
    const outer = [
      { lat: 12.70, lng: 79.85 }, { lat: 12.70, lng: 80.45 },
      { lat: 13.40, lng: 80.45 }, { lat: 13.40, lng: 79.85 },
    ];

    // Signed area sign = winding direction. Google punches a hole only
    // when inner rings wind OPPOSITE to the outer ring, so enforce it
    // mathematically instead of guessing.
    const signedArea = (ring: { lat: number; lng: number }[]) =>
      ring.reduce((s, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return s + (q.lng - p.lng) * (q.lat + p.lat);
      }, 0);

    const outerSign = Math.sign(signedArea(outer));
    const holes = rings.map(ring => {
      let path = ring.map(([lat, lng]) => ({ lat, lng }));
      if (Math.sign(signedArea(path)) === outerSign) path = path.slice().reverse();
      return path;
    });

    this.cityMaskG = new google.maps.Polygon({
      map: this.gmap,
      paths: [outer, ...holes],
      fillColor: this.maskFill(),
      fillOpacity: 1,
      strokeWeight: 0,
      clickable: false,
    });
    new google.maps.Polyline({
      map: this.gmap,
      path: holes[0],
      strokeColor: '#1565c0',
      strokeWeight: 2,
      strokeOpacity: 0.7,
      clickable: false,
    });
  }

  private gSetBaseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    if (!this.gmap) return;
    this.baseLayer = layer;
    switch (layer) {
      case 'satellite': this.gmap.setOptions({ mapTypeId: 'hybrid', styles: [] }); break;
      case 'terrain': this.gmap.setOptions({ mapTypeId: 'terrain', styles: [] }); break;
      case 'dark': this.gmap.setOptions({ mapTypeId: 'roadmap', styles: LiveMonitorComponent.NIGHT_STYLE }); break;
      default: this.gmap.setOptions({ mapTypeId: 'roadmap', styles: [] });
    }
    this.cityMaskG?.setOptions({ fillColor: this.maskFill() });
  }

  private gPinIcon(d: any): any {
    const { svg, w, h } = this.pinSvg(d);
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(w, h),
      anchor: new google.maps.Point(w / 2, h),
      labelOrigin: new google.maps.Point(w / 2, -10),
    };
  }

  private gMarkerLabel(d: any): any {
    return {
      text: d.short_name || d.junction_name || '',
      className: 'junction-glabel',
      color: '#1565c0',
      fontSize: '11px',
      fontWeight: '700',
    };
  }

  private gRenderJunctionPins(data: any[]) {
    if (!this.gmap || !(window as any).google) return;

    const liveIds = new Set(data.map(d => d.junction_id));
    this.junctionMarkers.forEach((marker, id) => {
      if (!liveIds.has(id)) {
        marker.setMap(null);
        this.junctionMarkers.delete(id);
        this.junctionDataById.delete(id);
      }
    });

    data.forEach(d => {
      this.junctionDataById.set(d.junction_id, d);
      if (this.junctionMarkers.has(d.junction_id)) {
        const m = this.junctionMarkers.get(d.junction_id)!;
        m.setIcon(this.gPinIcon(d));
        m.setPosition({ lat: +d.lat, lng: +d.lng });
        m.setLabel(this.gMarkerLabel(d));
      } else {
        const marker = new google.maps.Marker({
          map: this.gmap,
          position: { lat: +d.lat, lng: +d.lng },
          icon: this.gPinIcon(d),
          label: this.gMarkerLabel(d),
          title: d.junction_name,
        });
        marker.addListener('click', () => this.selectJunction(this.junctionDataById.get(d.junction_id) || d));
        this.junctionMarkers.set(d.junction_id, marker);
      }
    });

    if (data.length > 0 && !this.didFitBounds) {
      const bounds = new google.maps.LatLngBounds();
      data.forEach(d => bounds.extend({ lat: +d.lat, lng: +d.lng }));
      this.gmap.fitBounds(bounds, 60);
      // A single junction makes fitBounds dive to maximum zoom — cap it so
      // the view still shows the surrounding roads.
      google.maps.event.addListenerOnce(this.gmap, 'idle', () => {
        if (this.gmap.getZoom() > 15) this.gmap.setZoom(15);
      });
      this.didFitBounds = true;
    }

    this.applyChipFilters();
  }

  private gOfficerIcon(o: any): any {
    const initials = (o.badge_number || 'PO').slice(-2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">
        <circle cx="15" cy="15" r="13" fill="#1976d2" stroke="#ffffff" stroke-width="2"/>
        <text x="15" y="19" font-size="10" font-family="Arial" font-weight="700" fill="#ffffff" text-anchor="middle">${initials}</text>
      </svg>`;
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(30, 30),
      anchor: new google.maps.Point(15, 15),
    };
  }

  private gUpdateOfficerMarker(o: any) {
    if (!this.gmap || !(window as any).google) return;
    const pos = { lat: +o.lat, lng: +o.lng };
    if (this.officerMarkers.has(o.officer_id)) {
      this.officerMarkers.get(o.officer_id)!.setPosition(pos);
    } else {
      const marker = new google.maps.Marker({
        map: this.gmap,
        position: pos,
        icon: this.gOfficerIcon(o),
        title: o.name,
      });
      marker.addListener('click', () => {
        this.infoWindow.setContent(
          `<div style="font-family:'Segoe UI',Arial,sans-serif"><b>${o.name}</b><br>Badge: ${o.badge_number}<br>Junction: ${o.junction_name || 'En route'}</div>`,
        );
        this.infoWindow.open({ map: this.gmap, anchor: marker });
      });
      this.officerMarkers.set(o.officer_id, marker);
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // LEAFLET ENGINE — 100% free (CARTO tiles + our own route ribbons)
  // ══════════════════════════════════════════════════════════════════════

  private initLeafletMap() {
    const chennai = L.latLngBounds([12.75, 79.90], [13.35, 80.40]);
    this.map = L.map(this.leafletEl!.nativeElement, {
      zoomControl: false,
      maxBounds: chennai,
      maxBoundsViscosity: 1.0, // hard wall — no dragging outside the city
    }).fitBounds(chennai);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Zoom-out limit = Chennai exactly filling the screen.
    this.map.setMinZoom(this.map.getBoundsZoom(chennai));

    // Ribbon panes (edge below fill), both under markers so pins stay on top.
    this.map.createPane('lmCasing').style.zIndex = '402';
    this.map.createPane('lmMain').style.zIndex = '403';
    this.map.on('zoomend', () => this.refreshLineWeights());

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

    this.http.get<[number, number][][]>('assets/chennai-boundary.json').subscribe({
      next: rings => this.lfAddCityMask(rings),
      error: () => {},
    });

    this.mapReady = true;

    if (this.displayData.length) this.renderJunctionPins(this.pinSourceData);
    if (this.hasRoutes) this.renderRouteLines(this.routeTrafficData);
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  private lfAddCityMask(rings: [number, number][][]) {
    if (!this.map) return;
    const world: [number, number][] = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    this.cityMaskL = L.polygon([world, ...rings], {
      fillColor: this.maskFill(),
      fillOpacity: 1,
      stroke: false,
      interactive: false,
    }).addTo(this.map);
    L.polyline(rings, {
      color: '#1565c0',
      weight: 2,
      opacity: 0.7,
      interactive: false,
    }).addTo(this.map);
  }

  private lfSetBaseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    if (!this.map) return;
    const prev = this.baseLayers[this.baseLayer];
    if (prev) this.map.removeLayer(prev);
    if (this.satLabels) this.map.removeLayer(this.satLabels);

    this.baseLayer = layer;
    this.baseLayers[layer]?.addTo(this.map);
    if (layer === 'satellite') this.satLabels?.addTo(this.map);

    this.cityMaskL?.setStyle({ fillColor: this.maskFill() });
  }

  private lfPinIcon(d: any): L.DivIcon {
    const { svg, w, h, isSelected } = this.pinSvg(d);
    return L.divIcon({
      html: svg,
      className: 'lm-pin-icon' + (isSelected ? ' lm-pin-selected' : ''),
      iconSize: [w, h],
      iconAnchor: [w / 2, h],
      popupAnchor: [0, -h + 6],
    });
  }

  private lfRenderJunctionPins(data: any[]) {
    if (!this.map) return;

    const liveIds = new Set(data.map(d => d.junction_id));
    this.junctionMarkers.forEach((marker, id) => {
      if (!liveIds.has(id)) {
        this.map!.removeLayer(marker);
        this.junctionMarkers.delete(id);
        this.junctionDataById.delete(id);
      }
    });

    data.forEach(d => {
      this.junctionDataById.set(d.junction_id, d);
      const icon = this.lfPinIcon(d);
      if (this.junctionMarkers.has(d.junction_id)) {
        const m = this.junctionMarkers.get(d.junction_id)!;
        m.setIcon(icon);
        m.setLatLng([d.lat, d.lng]);
        m.setPopupContent(this.junctionPopup(d));
      } else {
        const marker = L.marker([d.lat, d.lng], { icon }).addTo(this.map!);
        marker.bindTooltip(d.short_name || d.junction_name, {
          permanent: true, direction: 'top',
          offset: [0, -34],
          className: 'junction-web-label',
          opacity: 1,
        });
        marker.bindPopup(this.junctionPopup(d));
        marker.on('click', () => this.selectJunction(this.junctionDataById.get(d.junction_id) || d));
        this.junctionMarkers.set(d.junction_id, marker);
      }
    });

    if (data.length > 0 && !this.didFitBounds) {
      const bounds = L.latLngBounds(data.map(d => [d.lat, d.lng] as [number, number]));
      this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      this.didFitBounds = true;
    }

    this.applyChipFilters();
  }

  private lfUpdateOfficerMarker(o: any) {
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

  // ── Leaflet route ribbons (Google engine uses its TrafficLayer instead) ──

  private decodePolyline(encoded: string): [number, number][] {
    const pts: [number, number][] = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
      let b, shift = 0, result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }

  private shade(hex: string, f: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  private lineWeights(): { casing: number; main: number } {
    const z = this.map?.getZoom() ?? 13;
    const main =
      z >= 18 ? 14 :
      z >= 17 ? 11 :
      z >= 16 ? 9 :
      z >= 15 ? 7 :
      z >= 14 ? 5.5 :
      z >= 13 ? 4.5 : 3.5;
    return { casing: main + 3, main };
  }

  private renderRouteLines(rows: any[]) {
    if (this.useGoogle || !this.map) return; // Google engine: TrafficLayer does this
    const live = new Set<number>();
    const w = this.lineWeights();

    rows.forEach(r => {
      const id = r.route_id ?? r.id;
      if (id == null) return;
      live.add(id);

      let path: [number, number][] | null = null;
      if (r.polyline) path = this.decodePolyline(r.polyline);
      else if (r.origin_lat != null && r.dest_lat != null) {
        path = [[+r.origin_lat, +r.origin_lng], [+r.dest_lat, +r.dest_lng]];
      }
      if (!path || path.length < 2) return;

      const color = this.getCongestionColor(r.congestion_level);
      const casingStyle: L.PolylineOptions = {
        pane: 'lmCasing', color: this.shade(color, 0.72), weight: w.casing, opacity: 1,
        lineCap: 'round', lineJoin: 'round', interactive: false,
        dashArray: r.polyline ? undefined : '6 10',
      };
      const mainStyle: L.PolylineOptions = {
        pane: 'lmMain', color, weight: w.main, opacity: 1,
        lineCap: 'round', lineJoin: 'round',
        dashArray: r.polyline ? undefined : '6 10',
      };
      const tip = `${r.coming_from || r.junction_name} — ${r.delay_minutes}m delay (${r.congestion_level})`;

      const existing = this.routeLines.get(id);
      if (existing) {
        existing.casing.setLatLngs(path); existing.casing.setStyle(casingStyle);
        existing.main.setLatLngs(path); existing.main.setStyle(mainStyle);
        existing.main.setTooltipContent(tip);
      } else {
        const casing = L.polyline(path, casingStyle).addTo(this.map!);
        const main = L.polyline(path, mainStyle).addTo(this.map!);
        main.bindTooltip(tip, { sticky: true });
        (main as any)._junctionId = r.junction_id;
        main.on('click', () => this.selectJunction(this.junctionDataById.get(r.junction_id) || r));
        this.routeLines.set(id, { casing, main });
      }
    });

    this.routeLines.forEach((group, id) => {
      if (!live.has(id)) {
        this.map!.removeLayer(group.casing);
        this.map!.removeLayer(group.main);
        this.routeLines.delete(id);
      }
    });

    this.applyChipFilters();
  }

  private refreshLineWeights() {
    const w = this.lineWeights();
    this.routeLines.forEach(group => {
      group.casing.setStyle({ weight: w.casing });
      group.main.setStyle({ weight: w.main });
    });
  }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
