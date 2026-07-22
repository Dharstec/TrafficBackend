import { Component, OnInit } from '@angular/core';

interface JunctionRoute {
  code: string;
  name: string;
  fromCode: string;
  fromName: string;
}

interface CongestionRecord {
  junctionCode: string;
  junctionName: string;
  fromCode: string;
  fromName: string;
  delayMinutes: number;
  dateObj: Date;
  date: string;
  time: string;
}

// Chennai junction/incoming-road pairs used to seed the dummy history log —
// same naming convention as the dashboard's Chennai mock data.
const JUNCTION_ROUTES: JunctionRoute[] = [
  { code: 'E-1', name: 'EVR Salai X Ritherton Road Jn', fromCode: 'E-2', fromName: 'Doveton Point' },
  { code: 'E-3', name: 'Kathipara Junction (Guindy)', fromCode: 'E-4', fromName: 'Guindy Industrial Estate' },
  { code: 'W-1', name: 'Koyambedu Junction', fromCode: 'W-2', fromName: 'CMBT Bus Stand' },
  { code: 'S-1', name: 'T Nagar (Panagal Park) Jn', fromCode: 'S-2', fromName: 'Pondy Bazaar' },
  { code: 'S-3', name: 'Sholinganallur Junction (OMR)', fromCode: 'S-4', fromName: 'Perungudi Signal' },
  { code: 'C-1', name: 'Anna Nagar Roundtana', fromCode: 'C-2', fromName: '2nd Avenue Signal' },
  { code: 'W-3', name: 'Vadapalani Junction', fromCode: 'W-4', fromName: 'Forum Mall Signal' },
  { code: 'N-1', name: 'Perambur High Road Jn', fromCode: 'N-2', fromName: 'Jamalia Signal' },
];

const RECORDS_PER_ROUTE = 30;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Deterministic dummy congestion log — stands in for what would otherwise be
// a paginated `/traffic/congestion-history` API response.
function buildRecords(): CongestionRecord[] {
  const records: CongestionRecord[] = [];
  const base = new Date(2023, 0, 5);

  JUNCTION_ROUTES.forEach((route, r) => {
    for (let i = 0; i < RECORDS_PER_ROUTE; i++) {
      const idx = r * RECORDS_PER_ROUTE + i;
      const d = new Date(base.getTime() + (idx * 3 + r) * 86400000);
      const delay = 2 + ((idx * 7 + r * 3) % 13);
      const hour = 7 + ((idx * 5 + r) % 13);
      const minute = (idx * 11 + r * 4) % 60;

      records.push({
        junctionCode: route.code,
        junctionName: route.name,
        fromCode: route.fromCode,
        fromName: route.fromName,
        delayMinutes: delay,
        dateObj: d,
        date: `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`,
        time: `${hour}:${pad2(minute)}`,
      });
    }
  });

  return records.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());
}

const ALL_RECORDS = buildRecords();

@Component({
  selector: 'app-congestions-history',
  templateUrl: './congestions-history.component.html',
  styleUrls: ['./congestions-history.component.scss'],
})
export class CongestionsHistoryComponent implements OnInit {
  pageSize = 10;
  currentPage = 1;

  // Filter form state — bound to the inputs, only applied to the results on
  // "Search" so typing doesn't refilter the table on every keystroke.
  filters = { junction: '', dateFrom: '', dateTo: '', minDelay: null as number | null, maxDelay: null as number | null };
  private appliedFilters = { ...this.filters };

  records: CongestionRecord[] = [];

  ngOnInit() {
    this.applyFilters();
  }

  get filteredRecords(): CongestionRecord[] {
    const f = this.appliedFilters;
    return ALL_RECORDS.filter(r => {
      if (f.junction) {
        const q = f.junction.trim().toLowerCase();
        const haystack = `${r.junctionCode} ${r.junctionName} ${r.fromCode} ${r.fromName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (f.dateFrom && r.dateObj < new Date(f.dateFrom)) return false;
      if (f.dateTo && r.dateObj > new Date(`${f.dateTo}T23:59:59`)) return false;
      if (f.minDelay != null && r.delayMinutes < f.minDelay) return false;
      if (f.maxDelay != null && r.delayMinutes > f.maxDelay) return false;
      return true;
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredRecords.length / this.pageSize));
  }

  get pagedRecords(): CongestionRecord[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRecords.slice(start, start + this.pageSize);
  }

  // Compact page-number strip with ellipsis — always shows first/last page
  // plus a window around the current page, matching the reference screenshot.
  get pageNumbers(): (number | '...')[] {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = new Set<number>([1, 2, total - 1, total, current - 1, current, current + 1]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);

    const result: (number | '...')[] = [];
    let prev = 0;
    for (const p of sorted) {
      if (prev && p - prev > 1) result.push('...');
      result.push(p);
      prev = p;
    }
    return result;
  }

  search() {
    this.appliedFilters = { ...this.filters };
    this.currentPage = 1;
  }

  reset() {
    this.filters = { junction: '', dateFrom: '', dateTo: '', minDelay: null, maxDelay: null };
    this.applyFilters();
  }

  private applyFilters() {
    this.appliedFilters = { ...this.filters };
    this.currentPage = 1;
  }

  goToPage(page: number | '...') {
    if (page === '...') return;
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  // Exports every row matching the applied filters (not just the visible
  // page) so a Monitoring Head can pull a full report for a date/delay range.
  downloadCsv() {
    const rows = this.filteredRecords;
    if (!rows.length) return;

    const header = ['Junction Code', 'Junction', 'Coming From Code', 'Coming From', 'Delay (mins)', 'Date', 'Time'];
    const csvEscape = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(','),
      ...rows.map(r => [r.junctionCode, r.junctionName, r.fromCode, r.fromName, r.delayMinutes, r.date, r.time]
        .map(csvEscape).join(',')),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `congestions-history-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
