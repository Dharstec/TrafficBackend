import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import type { EChartsOption } from 'echarts';
import { ThemeService } from '../../core/services/theme.service';

// ── Types ────────────────────────────────────────────────────────────────
// Every shape below matches what the real backend endpoints will eventually
// return, so swapping DASHBOARD_MOCK.* for an HttpClient call in loadXxx()
// is the only change needed later — the template binds to these fields only.

type CongestionBand = 'usual' | 'normal' | 'intermediate' | 'heavy';
type RangeKey = 'today' | '7d' | '30d';

interface JunctionSnapshot {
  name: string;
  level: CongestionBand;
  delayMinutes: number;
}

interface RoadCongestion {
  road: string;
  junction: string;
  zone: string;
  value: number;
}

interface ZoneCongestion {
  locality: string;
  zone: string;
  value: number;
}

interface CriticalAlert {
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
  junction: string;
  time: string;
}

interface AttentionJunction {
  junction: string;
  congestionPct: number;
  delayMinutes: number;
  stateDuration: string;
  officersOnDuty: number;
  officersAssigned: number;
  action: number;
}

interface PeakArea {
  area: string;
  congestionPct: number;
  deltaVsTypical: number;
  window: string;
}

interface FailingSignal {
  junction: string;
  signalLabel: string;
  failures30d: number;
  lastFailure: string;
  avgDowntimeMinutes: number;
  status: 'operational' | 'under_repair';
}

interface DutyException {
  officer: string;
  badge: string;
  junction: string;
  shiftStart: string;
  status: 'late' | 'not_checked_in';
  checkedInAt: string;
  variance: string;
  varianceMinutes: number;
  action: string;
}

// ── Dummy data ───────────────────────────────────────────────────────────
// Stands in for the real API responses (traffic snapshots, incident feed,
// signal health). Kept as one block so it's obvious what a backend
// integration needs to supply, and in the exact shape the template consumes.
const DASHBOARD_MOCK = {
  junctionSnapshots: [
    { name: 'Kathipara Junction (Guindy)', level: 'heavy', delayMinutes: 13.2 },
    { name: 'Koyambedu Junction', level: 'intermediate', delayMinutes: 7.5 },
    { name: 'Anna Nagar Roundtana', level: 'normal', delayMinutes: 4.0 },
    { name: 'T Nagar (Panagal Park) Junction', level: 'usual', delayMinutes: 1.8 },
    { name: 'Sholinganallur Junction (OMR)', level: 'heavy', delayMinutes: 14.6 },
    { name: 'Vadapalani Junction', level: 'normal', delayMinutes: 3.6 },
  ] as JunctionSnapshot[],

  criticalAlerts: [
    {
      severity: 'critical', junction: 'Sholinganallur Junction (OMR)', time: '2 min ago',
      title: 'Heavy congestion sustained 45+ minutes',
      detail: 'OMR inbound towards Sholinganallur — delay steady at 14.6 min across 3 refresh cycles.',
    },
    {
      severity: 'critical', junction: 'Koyambedu Junction', time: '6 min ago',
      title: 'Signal malfunction — officer dispatched',
      detail: 'East-approach signal stuck on red since 09:38 AM.',
    },
    {
      severity: 'warning', junction: 'Kathipara Junction (Guindy)', time: '12 min ago',
      title: 'Congestion rising quickly',
      detail: 'Delay climbed from 9.8 to 13.2 min in the last 15 minutes.',
    },
    {
      severity: 'warning', junction: 'Anna Nagar Roundtana', time: '24 min ago',
      title: 'Officer coverage below assignment',
      detail: 'Only 1 of 2 assigned officers checked in for this shift.',
    },
  ] as CriticalAlert[],

  attentionJunctions: [
    {
      junction: 'Sholinganallur Junction (OMR)', congestionPct: 91, delayMinutes: 14.6,
      stateDuration: '50 min in heavy', officersOnDuty: 2, officersAssigned: 2,
      action: 5,
    },
    {
      junction: 'Kathipara Junction (Guindy)', congestionPct: 87, delayMinutes: 13.2,
      stateDuration: '36 min in heavy', officersOnDuty: 2, officersAssigned: 3,
      action: 6,
    },
    {
      junction: 'Koyambedu Junction', congestionPct: 78, delayMinutes: 7.5,
      stateDuration: 'Signal fault ongoing', officersOnDuty: 1, officersAssigned: 2,
      action: 4,
    },
  ] as AttentionJunction[],

  peakAreas: [
    { area: 'OMR – Sholinganallur Stretch', congestionPct: 91, deltaVsTypical: 30, window: '5:30 PM – 7:30 PM' },
    { area: 'Kathipara – Guindy Flyover', congestionPct: 87, deltaVsTypical: 21, window: '8:00 AM – 10:00 AM' },
    { area: 'Koyambedu Market Junction', congestionPct: 80, deltaVsTypical: 17, window: '8:30 AM – 9:30 AM' },
    { area: 'Anna Salai (Mount Road) Corridor', congestionPct: 75, deltaVsTypical: 14, window: '6:00 PM – 8:00 PM' },
  ] as PeakArea[],

  failingSignals: [
    {
      junction: 'Koyambedu Junction', signalLabel: 'East Approach', failures30d: 7,
      lastFailure: 'Today, 09:38 AM', avgDowntimeMinutes: 18, status: 'under_repair',
    },
    {
      junction: 'Kathipara Junction (Guindy)', signalLabel: 'Signal 2', failures30d: 5,
      lastFailure: 'Yesterday, 6:15 PM', avgDowntimeMinutes: 12, status: 'operational',
    },
    {
      junction: 'Anna Nagar Roundtana', signalLabel: 'Main Signal', failures30d: 4,
      lastFailure: '3 days ago', avgDowntimeMinutes: 25, status: 'operational',
    },
    {
      junction: 'T Nagar (Panagal Park) Junction', signalLabel: 'North Signal', failures30d: 3,
      lastFailure: '5 days ago', avgDowntimeMinutes: 9, status: 'operational',
    },
  ] as FailingSignal[],

  dutyExceptions: [
    {
      officer: 'Suresh Kumar', badge: 'FO004', junction: 'T Nagar (Panagal Park) Junction', shiftStart: '08:30 AM',
      status: 'not_checked_in', checkedInAt: '—', variance: '45 min overdue', varianceMinutes: 45, action: 'Contact officer',
    },
    {
      officer: 'Divya M', badge: 'SUP001', junction: 'Sholinganallur Junction (OMR)', shiftStart: '07:30 AM',
      status: 'not_checked_in', checkedInAt: '—', variance: '30 min overdue', varianceMinutes: 30, action: 'Escalate to control room',
    },
    {
      officer: 'Manikandan V', badge: 'FO003', junction: 'Anna Nagar Roundtana', shiftStart: '09:00 AM',
      status: 'late', checkedInAt: '09:22 AM', variance: '+22 min late', varianceMinutes: 22, action: 'Logged — monitor',
    },
    {
      officer: 'Priya S', badge: 'FO002', junction: 'Koyambedu Junction', shiftStart: '08:00 AM',
      status: 'late', checkedInAt: '08:11 AM', variance: '+11 min late', varianceMinutes: 11, action: 'Logged — monitor',
    },
  ] as DutyException[],
};

// Top Congested Roads / Zone-wise Congestion support a time-range filter —
// each range is its own dummy snapshot, standing in for what would otherwise
// be a re-fetch keyed by the same range value. All data is scoped to Chennai
// city; "zone" here means the Greater Chennai traffic zone the road/locality
// falls under, not a Tamil Nadu district.
const TOP_ROADS_BY_RANGE: Record<RangeKey, RoadCongestion[]> = {
  today: [
    { road: 'Anna Salai (Mount Road)', junction: 'Kathipara Junction (Guindy)', zone: 'South Chennai', value: 91 },
    { road: 'OMR (Rajiv Gandhi Salai)', junction: 'Sholinganallur Junction (OMR)', zone: 'OMR / IT Corridor', value: 88 },
    { road: 'GST Road', junction: 'St. Thomas Mount Junction', zone: 'South Chennai', value: 82 },
    { road: 'Poonamallee High Road', junction: 'Koyambedu Junction', zone: 'West Chennai', value: 76 },
    { road: 'Inner Ring Road', junction: 'Vadapalani Junction', zone: 'West Chennai', value: 69 },
    { road: 'Anna Nagar 2nd Avenue', junction: 'Anna Nagar Roundtana', zone: 'Central Chennai', value: 64 },
    { road: 'Velachery Main Road', junction: 'Velachery Junction', zone: 'South Chennai', value: 60 },
    { road: 'Perambur High Road', junction: 'Perambur Junction', zone: 'North Chennai', value: 52 },
    { road: 'EVR Periyar Salai', junction: 'Egmore Junction', zone: 'Central Chennai', value: 47 },
  ],
  '7d': [
    { road: 'Anna Salai (Mount Road)', junction: 'Kathipara Junction (Guindy)', zone: 'South Chennai', value: 85 },
    { road: 'OMR (Rajiv Gandhi Salai)', junction: 'Sholinganallur Junction (OMR)', zone: 'OMR / IT Corridor', value: 83 },
    { road: 'GST Road', junction: 'St. Thomas Mount Junction', zone: 'South Chennai', value: 77 },
    { road: 'Poonamallee High Road', junction: 'Koyambedu Junction', zone: 'West Chennai', value: 71 },
    { road: 'Inner Ring Road', junction: 'Vadapalani Junction', zone: 'West Chennai', value: 65 },
    { road: 'Anna Nagar 2nd Avenue', junction: 'Anna Nagar Roundtana', zone: 'Central Chennai', value: 60 },
    { road: 'Velachery Main Road', junction: 'Velachery Junction', zone: 'South Chennai', value: 57 },
    { road: 'Perambur High Road', junction: 'Perambur Junction', zone: 'North Chennai', value: 49 },
    { road: 'EVR Periyar Salai', junction: 'Egmore Junction', zone: 'Central Chennai', value: 44 },
  ],
  '30d': [
    { road: 'Anna Salai (Mount Road)', junction: 'Kathipara Junction (Guindy)', zone: 'South Chennai', value: 79 },
    { road: 'OMR (Rajiv Gandhi Salai)', junction: 'Sholinganallur Junction (OMR)', zone: 'OMR / IT Corridor', value: 77 },
    { road: 'GST Road', junction: 'St. Thomas Mount Junction', zone: 'South Chennai', value: 72 },
    { road: 'Poonamallee High Road', junction: 'Koyambedu Junction', zone: 'West Chennai', value: 66 },
    { road: 'Inner Ring Road', junction: 'Vadapalani Junction', zone: 'West Chennai', value: 60 },
    { road: 'Anna Nagar 2nd Avenue', junction: 'Anna Nagar Roundtana', zone: 'Central Chennai', value: 55 },
    { road: 'Velachery Main Road', junction: 'Velachery Junction', zone: 'South Chennai', value: 52 },
    { road: 'Perambur High Road', junction: 'Perambur Junction', zone: 'North Chennai', value: 45 },
    { road: 'EVR Periyar Salai', junction: 'Egmore Junction', zone: 'Central Chennai', value: 40 },
  ],
};

const ZONE_BY_RANGE: Record<RangeKey, ZoneCongestion[]> = {
  today: [
    { locality: 'Kathipara Jn (Guindy)', zone: 'South Chennai', value: 89 },
    { locality: 'T Nagar (Panagal Park)', zone: 'South Chennai', value: 82 },
    { locality: 'Koyambedu', zone: 'West Chennai', value: 78 },
    { locality: 'Anna Nagar Roundtana', zone: 'Central Chennai', value: 71 },
    { locality: 'Sholinganallur (OMR)', zone: 'OMR / IT Corridor', value: 68 },
    { locality: 'Vadapalani', zone: 'West Chennai', value: 61 },
    { locality: 'Egmore', zone: 'Central Chennai', value: 58 },
    { locality: 'Velachery', zone: 'South Chennai', value: 55 },
    { locality: 'Perambur', zone: 'North Chennai', value: 48 },
    { locality: 'Tondiarpet', zone: 'North Chennai', value: 42 },
  ],
  '7d': [
    { locality: 'Kathipara Jn (Guindy)', zone: 'South Chennai', value: 84 },
    { locality: 'T Nagar (Panagal Park)', zone: 'South Chennai', value: 78 },
    { locality: 'Koyambedu', zone: 'West Chennai', value: 74 },
    { locality: 'Anna Nagar Roundtana', zone: 'Central Chennai', value: 67 },
    { locality: 'Sholinganallur (OMR)', zone: 'OMR / IT Corridor', value: 64 },
    { locality: 'Vadapalani', zone: 'West Chennai', value: 58 },
    { locality: 'Egmore', zone: 'Central Chennai', value: 55 },
    { locality: 'Velachery', zone: 'South Chennai', value: 52 },
    { locality: 'Perambur', zone: 'North Chennai', value: 45 },
    { locality: 'Tondiarpet', zone: 'North Chennai', value: 39 },
  ],
  '30d': [
    { locality: 'Kathipara Jn (Guindy)', zone: 'South Chennai', value: 80 },
    { locality: 'T Nagar (Panagal Park)', zone: 'South Chennai', value: 73 },
    { locality: 'Koyambedu', zone: 'West Chennai', value: 70 },
    { locality: 'Anna Nagar Roundtana', zone: 'Central Chennai', value: 63 },
    { locality: 'Sholinganallur (OMR)', zone: 'OMR / IT Corridor', value: 60 },
    { locality: 'Vadapalani', zone: 'West Chennai', value: 55 },
    { locality: 'Egmore', zone: 'Central Chennai', value: 52 },
    { locality: 'Velachery', zone: 'South Chennai', value: 49 },
    { locality: 'Perambur', zone: 'North Chennai', value: 42 },
    { locality: 'Tondiarpet', zone: 'North Chennai', value: 36 },
  ],
};

// Greater Chennai traffic zones used for the zone filter — replaces the old
// Tamil Nadu district list now that all dashboard data is Chennai-only.
const CHENNAI_ZONES = ['North Chennai', 'Central Chennai', 'South Chennai', 'West Chennai', 'OMR / IT Corridor'];

// Percentage bands mirror the delay-minute bands already used across the
// app (usual/normal/intermediate/heavy) and reuse the exact same hex values
// as traffic.service.ts:getCongestionColor() so a road/zone bar reads as
// the same "status color" as every badge and map pin elsewhere.
const BAND_COLOR: Record<CongestionBand, string> = {
  usual: '#4caf50',
  normal: '#ff9800',
  intermediate: '#f44336',
  heavy: '#795548',
};

function bandFor(pct: number): CongestionBand {
  if (pct >= 80) return 'heavy';
  if (pct >= 60) return 'intermediate';
  if (pct >= 40) return 'normal';
  return 'usual';
}

function bandColor(pct: number): string {
  return BAND_COLOR[bandFor(pct)];
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private subs: Subscription[] = [];
  private tickInterval?: ReturnType<typeof setInterval>;

  stats = { heavy: 0, intermediate: 0, normal: 0, usual: 0 };

  // Drives the "Updated Xm ago" label in the topbar — a Monitoring Head's
  // first question is always "how fresh is this?". Ticks independently of
  // data refresh so it stays honest even if a future API call is slow/stuck.
  lastRefreshed = new Date();

  // Open-problem counts for the priority strip — the one-line "is anything
  // on fire right now" read a Monitoring Head should get before scanning
  // any individual table.
  criticalAlertCount = 0;
  attentionJunctionCount = 0;
  dutyExceptionCount = 0;
  signalsUnderRepairCount = 0;

  rangeOptions: { value: RangeKey; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
  ];
  zoneOptions: string[] = ['All Zones', ...CHENNAI_ZONES];

  topRoadsRange: RangeKey = 'today';
  topRoadsZone = 'All Zones';
  zoneRange: RangeKey = 'today';
  zoneCongestionZone = 'All Zones';

  topCongestedRoads: RoadCongestion[] = [];
  zoneCongestion: ZoneCongestion[] = [];

  criticalAlerts: CriticalAlert[] = [];
  attentionJunctions: AttentionJunction[] = [];
  peakAreas: PeakArea[] = [];
  failingSignals: FailingSignal[] = [];
  dutyExceptions: DutyException[] = [];

  topRoadsOption: EChartsOption = {};
  zoneCongestionOption: EChartsOption = {};

  constructor(private themeSvc: ThemeService) {}

  ngOnInit() {
    this.load();
    this.buildChartOptions();
    // Chart canvases can't react to CSS variable changes themselves —
    // rebuild with freshly-read tokens whenever the operator flips theme.
    this.subs.push(this.themeSvc.theme$.subscribe(() => this.buildChartOptions()));
    // Recomputes the "Updated Xm ago" label; cheap enough to just re-render.
    this.tickInterval = setInterval(() => {}, 15000);
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  get lastUpdatedLabel(): string {
    const mins = Math.floor((Date.now() - this.lastRefreshed.getTime()) / 60000);
    if (mins < 1) return 'Updated just now';
    return `Updated ${mins} min${mins > 1 ? 's' : ''} ago`;
  }

  // In production this swaps for the relevant service calls (traffic,
  // incidents, signal-health) — the template shape stays the same. Each
  // list is sorted worst-first so the most urgent row is always on top,
  // regardless of the order the source data arrives in.
  private load() {
    const d = DASHBOARD_MOCK;
    this.lastRefreshed = new Date();

    this.calcStats(d.junctionSnapshots);
    this.refreshTopRoads();
    this.refreshZoneCongestion();

    this.criticalAlerts = [...d.criticalAlerts].sort((a, b) =>
      (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));

    this.attentionJunctions = [...d.attentionJunctions].sort((a, b) => b.congestionPct - a.congestionPct);

    this.peakAreas = d.peakAreas;

    this.failingSignals = [...d.failingSignals].sort((a, b) => {
      const statusRank = (s: FailingSignal['status']) => (s === 'under_repair' ? 0 : 1);
      return statusRank(a.status) - statusRank(b.status) || b.failures30d - a.failures30d;
    });

    this.dutyExceptions = [...d.dutyExceptions].sort((a, b) => {
      const statusRank = (s: DutyException['status']) => (s === 'not_checked_in' ? 0 : 1);
      return statusRank(a.status) - statusRank(b.status) || b.varianceMinutes - a.varianceMinutes;
    });

    this.criticalAlertCount = this.criticalAlerts.filter(a => a.severity === 'critical').length;
    this.attentionJunctionCount = this.attentionJunctions.length;
    this.dutyExceptionCount = this.dutyExceptions.length;
    this.signalsUnderRepairCount = this.failingSignals.filter(f => f.status === 'under_repair').length;
  }

  private calcStats(snapshots: JunctionSnapshot[]) {
    this.stats.heavy = snapshots.filter(s => s.level === 'heavy').length;
    this.stats.intermediate = snapshots.filter(s => s.level === 'intermediate').length;
    this.stats.normal = snapshots.filter(s => s.level === 'normal').length;
    this.stats.usual = snapshots.filter(s => s.level === 'usual').length;
  }

  bandColor(pct: number) { return bandColor(pct); }
  bandFor(pct: number) { return bandFor(pct); }

  onTopRoadsZoneChange(zone: string) {
    this.topRoadsZone = zone;
    this.refreshTopRoads();
  }

  onTopRoadsRangeChange(range: RangeKey) {
    this.topRoadsRange = range;
    this.refreshTopRoads();
  }

  onZoneCongestionZoneChange(zone: string) {
    this.zoneCongestionZone = zone;
    this.refreshZoneCongestion();
  }

  onZoneRangeChange(range: RangeKey) {
    this.zoneRange = range;
    this.refreshZoneCongestion();
  }

  private refreshTopRoads() {
    const all = TOP_ROADS_BY_RANGE[this.topRoadsRange];
    const filtered = this.topRoadsZone === 'All Zones'
      ? all
      : all.filter(r => r.zone === this.topRoadsZone);
    // "Top 5, ranked by congestion %" — cap the chart regardless of how many
    // roads exist in the selected zone.
    this.topCongestedRoads = [...filtered].sort((a, b) => b.value - a.value).slice(0, 5);
    this.topRoadsOption = this.buildTopRoadsOption(this.topCongestedRoads, this.readTokens());
  }

  private refreshZoneCongestion() {
    const all = ZONE_BY_RANGE[this.zoneRange];
    this.zoneCongestion = this.zoneCongestionZone === 'All Zones'
      ? all
      : all.filter(z => z.zone === this.zoneCongestionZone);
    this.zoneCongestionOption = this.buildZoneOption(this.zoneCongestion, this.readTokens());
  }

  // ── Chart option builders ──────────────────────────────────────────────
  // Each takes plain data + the current theme's ink/grid tokens, so the
  // dummy arrays above can be replaced by API data without touching these.
  private buildChartOptions() {
    const t = this.readTokens();
    this.topRoadsOption = this.buildTopRoadsOption(this.topCongestedRoads, t);
    this.zoneCongestionOption = this.buildZoneOption(this.zoneCongestion, t);
  }

  private readTokens() {
    const root = getComputedStyle(document.documentElement);
    const pick = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
    return {
      ink: pick('--color-text', '#12131a'),
      inkMuted: pick('--color-text-muted', '#6b7280'),
      grid: pick('--color-border', 'rgba(15,23,42,0.08)'),
      surface: pick('--color-surface-solid', '#ffffff'),
    };
  }

  private buildTopRoadsOption(data: RoadCongestion[], t: ReturnType<DashboardComponent['readTokens']>): EChartsOption {
    const sorted = [...data].sort((a, b) => a.value - b.value);
    return {
      grid: { left: 12, right: 46, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `<b>${p.name}</b><br/>${p.data.junction}<br/>${p.value}% congestion`,
        backgroundColor: t.surface, borderColor: t.grid, textStyle: { color: t.ink },
      },
      xAxis: {
        type: 'value', min: 0, max: 100, show: false,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category', data: sorted.map(d => d.road),
        axisLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.ink, fontSize: 12, fontWeight: 600 },
        axisTick: { show: false },
      },
      series: [{
        type: 'bar',
        data: sorted.map(d => ({ value: d.value, junction: d.junction, itemStyle: { color: bandColor(d.value), borderRadius: [0, 4, 4, 0] } })),
        barWidth: 18,
        label: { show: true, position: 'right', formatter: '{c}%', color: t.ink, fontSize: 12, fontWeight: 700 },
      }],
    };
  }

  private buildZoneOption(data: ZoneCongestion[], t: ReturnType<DashboardComponent['readTokens']>): EChartsOption {
    return {
      grid: { left: 40, right: 16, top: 28, bottom: 56 },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => `<b>${p.name}</b><br/>${p.value}% congestion`,
        backgroundColor: t.surface, borderColor: t.grid, textStyle: { color: t.ink },
      },
      xAxis: {
        type: 'category', data: data.map(d => d.locality),
        axisLine: { lineStyle: { color: t.grid } },
        axisLabel: { color: t.inkMuted, fontSize: 10.5, interval: 0, rotate: 24 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value', min: 0, max: 100,
        axisLabel: { color: t.inkMuted, fontSize: 11, formatter: '{value}%' },
        splitLine: { lineStyle: { color: t.grid } },
      },
      series: [{
        type: 'bar',
        data: data.map(d => ({ value: d.value, itemStyle: { color: bandColor(d.value), borderRadius: [4, 4, 0, 0] } })),
        barWidth: '48%',
        label: { show: true, position: 'top', formatter: '{c}%', color: t.ink, fontSize: 11, fontWeight: 700 },
      }],
    };
  }
}
