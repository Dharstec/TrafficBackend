import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
  // Time of the newest traffic row in the DB — NOT the page-open time.
  // Stays empty until data arrives, so it never fakes freshness.
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
  layersExpanded = false; // Google-style: chips row hidden until thumb's expand tap
  baseLayer: 'map' | 'satellite' | 'terrain' | 'dark' = 'map';
  private map?: L.Map;
  private baseLayers: Partial<Record<'map' | 'satellite' | 'terrain' | 'dark', L.TileLayer>> = {};
  private satLabels?: L.TileLayer;
  private junctionMarkers = new Map<number, L.Marker>();
  private junctionDataById = new Map<number, any>();
  private junctionNumberById = new Map<number, number>();
  private nextJunctionNumber = 1;
  private officerMarkers = new Map<number, L.Marker>();
  // One road-ribbon per route: colored fill + slightly darker edge.
  private routeLines = new Map<number, { casing: L.Polyline; main: L.Polyline }>();

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
            // Route-level push: merge by route, pins re-aggregate below
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
      this.touchLastUpdate(data);
      if (!this.hasRoutes) this.renderJunctionPins(this.pinSourceData);
    });
    // Load route-level traffic (preferred when routes exist)
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

  // Header time = newest row's DB timestamp (when Google was last called),
  // never the browser clock.
  private touchLastUpdate(rows: any[]) {
    const ts = rows
      .map(r => new Date(r.time).getTime())
      .filter(t => !isNaN(t));
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

  // Map shell is [hidden] while other tabs are active — after re-showing,
  // Leaflet must re-measure the container or tiles/pins render misaligned.
  showMapTab() {
    this.activeTab = 'map';
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  acknowledgeAlert(i: number) { this.heavyAlerts[i].acknowledged = true; }

  // Manual Google API refresh — backend runs its full pass (one Directions
  // call per route), then we re-pull the tables. Quota status lives in the
  // backend logs, not in the UI.
  refreshNow() {
    if (this.refreshing) return;
    this.refreshing = true;
    this.trafficSvc.refreshNow().subscribe({
      next: () => {
        this.load(); // fresh rows carry the new DB timestamp
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

  // ── Panel grouping: one collapsible block per junction, default expanded ──
  collapsedJunctions = new Set<number>();

  toggleGroup(id: number) {
    if (this.collapsedJunctions.has(id)) this.collapsedJunctions.delete(id);
    else this.collapsedJunctions.add(id);
  }

  isCollapsed(id: number) { return this.collapsedJunctions.has(id); }

  // mergedTraffic is already sorted by delay desc, so each group's first row
  // is its worst road, and groups come out ordered worst-junction-first.
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

  // One pin per junction. With routes, a junction has several roads — the
  // pin takes the WORST road (highest delay) for its color/size, and keeps
  // all roads (sorted highest first) for the popup.
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
    // Traffic lines follow their junction's visibility
    this.routeLines.forEach(group => {
      const shouldShow = visibleIds.has((group.main as any)._junctionId);
      [group.casing, group.main].forEach(layer => {
        const onMap = this.map!.hasLayer(layer);
        if (shouldShow && !onMap) layer.addTo(this.map!);
        if (!shouldShow && onMap) this.map!.removeLayer(layer);
      });
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
    const m: any = { usual: '#4caf50', normal: '#ff9800', intermediate: '#f44336', heavy: '#795548' };
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
    // City-locked map: opens on Chennai and cannot be panned away to the
    // rest of the country/world. Once junction pins load, the lock tightens
    // to exactly the junctions' own area (see renderJunctionPins).
    const chennai = L.latLngBounds([12.75, 79.90], [13.35, 80.40]);
    this.map = L.map(this.leafletEl.nativeElement, {
      zoomControl: false,
      maxBounds: chennai,
      maxBoundsViscosity: 1.0, // hard wall — no dragging outside the city
    }).fitBounds(chennai);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Zoom-out limit = Chennai exactly filling the screen. One more zoom-out
    // step is impossible — the full-city view IS the widest view.
    this.map.setMinZoom(this.map.getBoundsZoom(chennai));

    // Ribbon panes (edge below fill), both under markers (zIndex 600) so
    // pins stay clickable on top. Widths re-match the road on every zoom.
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

    // "Cut out" Chennai: mask everything outside the district boundary and
    // draw the boundary outline — only the city itself shows map detail.
    this.http.get<[number, number][][]>('assets/chennai-boundary.json').subscribe({
      next: rings => this.addCityMask(rings),
      error: () => {}, // boundary file missing — map still works, just unmasked
    });

    this.mapReady = true;

    if (this.displayData.length) this.renderJunctionPins(this.pinSourceData);
    if (this.hasRoutes) this.renderRouteLines(this.routeTrafficData);
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  // ── Chennai cutout mask ────────────────────────────────────────────
  // One giant polygon covering the whole world, with the Chennai district
  // boundary as a hole — so tiles are visible only inside the city shape.
  private cityMask?: L.Polygon;
  private cityOutline?: L.Polyline;

  private maskFill(): string {
    return this.baseLayer === 'dark' ? '#14161c' : '#e9edf2';
  }

  private addCityMask(rings: [number, number][][]) {
    if (!this.map) return;
    const world: [number, number][] = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    this.cityMask = L.polygon([world, ...rings], {
      fillColor: this.maskFill(),
      fillOpacity: 1,
      stroke: false,
      interactive: false,
    }).addTo(this.map);
    this.cityOutline = L.polyline(rings, {
      color: '#1565c0',
      weight: 2,
      opacity: 0.7,
      interactive: false,
    }).addTo(this.map);
  }

  setBaseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    if (!this.map || layer === this.baseLayer) return;
    const prev = this.baseLayers[this.baseLayer];
    if (prev) this.map.removeLayer(prev);
    if (this.satLabels) this.map.removeLayer(this.satLabels);

    this.baseLayer = layer;
    this.baseLayers[layer]?.addTo(this.map);
    if (layer === 'satellite') this.satLabels?.addTo(this.map);

    // Mask surface matches the layer's mood (dark layer → dark surround)
    this.cityMask?.setStyle({ fillColor: this.maskFill() });
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

  // Chip picked from the expanded row: apply it and tuck the row away again.
  chooseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    this.setBaseLayer(layer);
    this.layersExpanded = false;
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

  // Pin size tier by congestion level — the worse the traffic, the bigger
  // the pin: usual small, normal medium (orange), intermediate big (red),
  // heavy biggest (brown).
  private pinSizeForLevel(level: string): { w: number; h: number } {
    switch (level) {
      case 'heavy': return { w: 42, h: 58 };
      case 'intermediate': return { w: 34, h: 46 };
      case 'normal': return { w: 28, h: 38 };
      default: return { w: 22, h: 30 }; // usual
    }
  }

  // Teardrop pin icon — color and size both driven by the row's JSON fields
  // (congestion_level for color, delay_minutes for size), numbered so pins
  // can be matched back to their row in the Traffic Delay Monitor panel.
  // Selected pins get a pulsing halo + pop-in "lit" state.
  private pinIcon(d: any): L.DivIcon {
    const color = this.getCongestionColor(d.congestion_level);
    const isSelected = this.selectedJunctionId === d.junction_id;
    const label = String(this.getJunctionNumber(d.junction_id)).padStart(2, '0');
    const { w: baseW, h: baseH } = this.pinSizeForLevel(d.congestion_level);
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

  private didFitBounds = false;

  renderJunctionPins(data: any[]) {
    if (!this.map) return;

    // Drop markers for junctions no longer in the data (e.g. deleted ones)
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
      const icon = this.pinIcon(d);
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

    // Fit the view once on first render; later refreshes keep the user's
    // view. Pan/zoom limits stay city-wide: zoom-out floor is the full
    // Chennai view set in initMap.
    if (data.length > 0 && !this.didFitBounds) {
      const bounds = L.latLngBounds(data.map(d => [d.lat, d.lng] as [number, number]));
      this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      this.didFitBounds = true;
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

    // Multi-road junction: list every incoming road, highest delay first —
    // the top (worst) one is what the pin's color/size represents.
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

  // ── Traffic lines along the real roads (Google-Maps traffic style) ──
  // Google's encoded polyline → list of lat/lng points. Standard algorithm,
  // no library needed.
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

  // Darker shade of a hex color — used for the ribbon's edge.
  private shade(hex: string, f: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f);
    const g = Math.round(((n >> 8) & 255) * f);
    const b = Math.round((n & 255) * f);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Road-matched ribbon widths — like Google, the traffic ribbon grows with
  // zoom so it always fills the drawn road instead of floating over it.
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

  // Draws each route exactly ON the road (no side offset): a colored
  // ribbon with a slightly darker edge, exactly Google Maps' live-traffic
  // look. Ribbon width follows zoom (see lineWeights). Real road shape
  // when the polyline is stored; dashed straight fallback until the first
  // Google refresh saves one.
  private renderRouteLines(rows: any[]) {
    if (!this.map) return;
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

    // Remove lines for routes that no longer exist
    this.routeLines.forEach((group, id) => {
      if (!live.has(id)) {
        this.map!.removeLayer(group.casing);
        this.map!.removeLayer(group.main);
        this.routeLines.delete(id);
      }
    });

    this.applyChipFilters();
  }

  // Keep ribbon width matched to the road as the user zooms.
  private refreshLineWeights() {
    const w = this.lineWeights();
    this.routeLines.forEach(group => {
      group.casing.setStyle({ weight: w.casing });
      group.main.setStyle({ weight: w.main });
    });
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
