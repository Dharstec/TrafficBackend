import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TrafficService } from '../../core/services/traffic.service';
import { OfficerService } from '../../core/services/officer.service';
import { JunctionService } from '../../core/services/junction.service';
import { SocketService } from '../../core/services/socket.service';
import { JunctionRouteService } from '../../core/services/junction-route.service';
import { environment } from '../../environments/environment';
import { Subscription } from 'rxjs';

// Google Maps JS API is loaded at runtime (see loadGoogleScript) — no typings
// package needed, everything goes through this ambient handle.
declare const google: any;

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

  // ── Google Map (real Google engine + live TrafficLayer) ──────────────
  @ViewChild('leafletEl') leafletEl?: ElementRef<HTMLDivElement>;
  mapReady = false;
  mapKeyMissing = false;
  selectedJunctionId: number | null = null;
  panelCollapsed = false;
  layersExpanded = false; // Google-style: chips row hidden until thumb's expand tap
  baseLayer: 'map' | 'satellite' | 'terrain' | 'dark' = 'map';
  private map: any;
  private trafficLayer: any;
  private infoWindow: any;
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
        if (routeChanged) this.renderJunctionPins(this.pinSourceData);
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
    );
  }

  ngAfterViewInit() {
    // Defer to the next microtask so the map container has committed to the
    // DOM, and setting mapReady doesn't trigger NG0100 in dev mode.
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
      if (data.length > 0) this.renderJunctionPins(this.pinSourceData);
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
  // nudge Google Maps to re-measure its container.
  showMapTab() {
    this.activeTab = 'map';
    setTimeout(() => {
      if (this.map && (window as any).google) google.maps.event.trigger(this.map, 'resize');
    }, 50);
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
      const onMap = marker.getMap() != null;
      if (shouldShow && !onMap) marker.setMap(this.map);
      if (!shouldShow && onMap) marker.setMap(null);
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

  // ── Map: REAL Google Maps engine with the live TrafficLayer ───────────
  // Every road in the city gets Google's own live traffic colors — the
  // exact same view as maps.google.com. Uses the Maps JavaScript API
  // (10,000 free map loads/month; a control-room dashboard stays far
  // under that).
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

  // Google's night-mode styling for the Dark layer.
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

  async initMap() {
    if (!this.leafletEl) return;
    const key = environment.googleMapsKey;
    if (!key) {
      this.mapKeyMissing = true;
      return;
    }
    try {
      await this.loadGoogleScript(key);
    } catch {
      this.mapKeyMissing = true;
      return;
    }

    // City-locked: opens on Chennai, cannot pan/zoom away from the city.
    this.map = new google.maps.Map(this.leafletEl.nativeElement, {
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
    this.trafficLayer.setMap(this.map);

    this.infoWindow = new google.maps.InfoWindow();

    // "Cut out" Chennai: mask everything outside the district boundary and
    // draw the boundary outline — only the city itself shows map detail.
    this.http.get<[number, number][][]>('assets/chennai-boundary.json').subscribe({
      next: rings => this.addCityMask(rings),
      error: () => {}, // boundary file missing — map still works, just unmasked
    });

    this.mapReady = true;

    if (this.displayData.length) this.renderJunctionPins(this.pinSourceData);
    if (this.liveOfficers.length) this.renderOfficerMarkers(this.liveOfficers);
  }

  // ── Chennai cutout mask ────────────────────────────────────────────
  // One giant polygon covering the whole world, with the Chennai district
  // boundary as a hole (even-odd fill) — map detail only inside the city.
  private cityMask: any;
  private cityOutline: any;

  private maskFill(): string {
    return this.baseLayer === 'dark' ? '#14161c' : '#e9edf2';
  }

  private addCityMask(rings: [number, number][][]) {
    if (!this.map || !(window as any).google) return;
    const world = [
      { lat: -89, lng: -179 }, { lat: -89, lng: 179 },
      { lat: 89, lng: 179 }, { lat: 89, lng: -179 },
    ];
    const ringPaths = rings.map(ring => ring.map(([lat, lng]) => ({ lat, lng })));
    this.cityMask = new google.maps.Polygon({
      map: this.map,
      paths: [world, ...ringPaths],
      fillColor: this.maskFill(),
      fillOpacity: 1,
      strokeWeight: 0,
      clickable: false,
    });
    this.cityOutline = new google.maps.Polyline({
      map: this.map,
      path: ringPaths[0],
      strokeColor: '#1565c0',
      strokeWeight: 2,
      strokeOpacity: 0.7,
      clickable: false,
    });
  }

  setBaseLayer(layer: 'map' | 'satellite' | 'terrain' | 'dark') {
    if (!this.map || layer === this.baseLayer) return;
    this.baseLayer = layer;
    switch (layer) {
      case 'satellite':
        this.map.setOptions({ mapTypeId: 'hybrid', styles: [] });
        break;
      case 'terrain':
        this.map.setOptions({ mapTypeId: 'terrain', styles: [] });
        break;
      case 'dark':
        this.map.setOptions({ mapTypeId: 'roadmap', styles: LiveMonitorComponent.NIGHT_STYLE });
        break;
      default:
        this.map.setOptions({ mapTypeId: 'roadmap', styles: [] });
    }
    // Mask surface matches the layer's mood (dark layer → dark surround)
    this.cityMask?.setOptions({ fillColor: this.maskFill() });
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
    if (!this.map || this.junctionMarkers.size === 0 || !(window as any).google) return;
    const bounds = new google.maps.LatLngBounds();
    let any = false;
    this.junctionMarkers.forEach(m => {
      if (m.getMap() != null) { bounds.extend(m.getPosition()); any = true; }
    });
    if (any) this.map.fitBounds(bounds, 60);
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

  // Teardrop pin icon (SVG data URI) — color and size driven by the row's
  // congestion level, numbered so pins match their row in the panel.
  // Selected pins get a static glow ring + grow slightly.
  private pinIcon(d: any): any {
    const color = this.getCongestionColor(d.congestion_level);
    const isSelected = this.selectedJunctionId === d.junction_id;
    const label = String(this.getJunctionNumber(d.junction_id)).padStart(2, '0');
    const { w: baseW, h: baseH } = this.pinSizeForLevel(d.congestion_level);
    const selMult = isSelected ? 1.2 : 1;
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
    return {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(w, h),
      anchor: new google.maps.Point(w / 2, h),
      labelOrigin: new google.maps.Point(w / 2, -10),
    };
  }

  private markerLabel(d: any): any {
    return {
      text: d.short_name || d.junction_name || '',
      className: 'junction-glabel',
      color: '#1565c0',
      fontSize: '11px',
      fontWeight: '700',
    };
  }

  private didFitBounds = false;

  renderJunctionPins(data: any[]) {
    if (!this.map || !(window as any).google) return;

    // Drop markers for junctions no longer in the data (e.g. deleted ones)
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
        m.setIcon(this.pinIcon(d));
        m.setPosition({ lat: +d.lat, lng: +d.lng });
        m.setLabel(this.markerLabel(d));
      } else {
        const marker = new google.maps.Marker({
          map: this.map,
          position: { lat: +d.lat, lng: +d.lng },
          icon: this.pinIcon(d),
          label: this.markerLabel(d),
          title: d.junction_name,
        });
        marker.addListener('click', () => this.selectJunction(this.junctionDataById.get(d.junction_id) || d));
        this.junctionMarkers.set(d.junction_id, marker);
      }
    });

    // Fit the view once on first render; later refreshes keep the user's
    // view. Pan/zoom limits stay city-wide (restriction in initMap).
    if (data.length > 0 && !this.didFitBounds) {
      const bounds = new google.maps.LatLngBounds();
      data.forEach(d => bounds.extend({ lat: +d.lat, lng: +d.lng }));
      this.map.fitBounds(bounds, 60);
      this.didFitBounds = true;
    }

    this.applyChipFilters();
  }

  updateJunctionPin(u: any) {
    const marker = this.junctionMarkers.get(u.junction_id);
    if (marker) {
      this.junctionDataById.set(u.junction_id, u);
      marker.setIcon(this.pinIcon(u));
    }
  }

  // Clicking a row in the Traffic Delay Monitor panel (or a pin itself) pans/
  // zooms the map to that junction and lights up its pin.
  selectJunction(d: any) {
    const id = d.junction_id;
    const prevId = this.selectedJunctionId;
    this.selectedJunctionId = id;

    if (prevId != null && prevId !== id) this.refreshPinIcon(prevId);
    this.refreshPinIcon(id);

    const marker = this.junctionMarkers.get(id);
    if (marker && this.map) {
      this.map.panTo(marker.getPosition());
      if (this.map.getZoom() < 16) this.map.setZoom(16);
      const data = this.junctionDataById.get(id) || d;
      this.infoWindow.setContent(this.junctionPopup(data));
      this.infoWindow.open({ map: this.map, anchor: marker });
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

  renderOfficerMarkers(officers: any[]) {
    officers.forEach(o => this.updateOfficerMarker(o));
  }

  private officerIcon(o: any): any {
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

  updateOfficerMarker(o: any) {
    if (!this.map || !(window as any).google) return;
    const pos = { lat: +o.lat, lng: +o.lng };
    if (this.officerMarkers.has(o.officer_id)) {
      this.officerMarkers.get(o.officer_id)!.setPosition(pos);
    } else {
      const marker = new google.maps.Marker({
        map: this.map,
        position: pos,
        icon: this.officerIcon(o),
        title: o.name,
      });
      marker.addListener('click', () => {
        this.infoWindow.setContent(
          `<div style="font-family:'Segoe UI',Arial,sans-serif"><b>${o.name}</b><br>Badge: ${o.badge_number}<br>Junction: ${o.junction_name || 'En route'}</div>`,
        );
        this.infoWindow.open({ map: this.map, anchor: marker });
      });
      this.officerMarkers.set(o.officer_id, marker);
    }
  }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
