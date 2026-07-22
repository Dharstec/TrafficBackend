import { Component } from '@angular/core';

type CongestionPeriod = 'morning' | 'evening';

interface StationSignal {
  code: string;
  name: string;
}

interface Station {
  station: string;
  signals: StationSignal[];
}

interface CongestionReportRow {
  station: string;
  signalNo: string;
  signalName: string;
  period: CongestionPeriod;
  dateObj: Date;
  hour: number;
  minute: number;
  observedDelay: number;
  usualDelay: number;
}

// Greater Chennai Traffic Police station / signal pairs — same naming
// convention as the dashboard & congestions-history dummy datasets.
const STATIONS: Station[] = [
  {
    station: 'S2 Airport',
    signals: [
      { code: 'S-136', name: 'GST Rd X Meenambakkam Bazaar' },
      { code: 'S-129', name: 'GST Road X Old Airport Jn.' },
      { code: 'S-131', name: 'Air Port Entrance' },
      { code: 'S-131A', name: 'Air Port Entrance (International Airport)' },
    ],
  },
  {
    station: 'J2 Adayar',
    signals: [
      { code: 'S-61', name: 'L B Road X S P Road' },
      { code: 'S-64', name: 'Adyar Signal (LB Road)' },
    ],
  },
  {
    station: 'R9 Valasaravakkam',
    signals: [
      { code: 'S-51', name: 'Arasamaram Jn (Ramapuram)' },
      { code: 'S-53', name: 'Valasaravakkam Bus Stand' },
    ],
  },
  {
    station: 'J4 Kotturpuram',
    signals: [{ code: 'E-55', name: 'SV Patel Rd X Gandhi Mandapam Jn' }],
  },
  {
    station: 'W3 Vadapalani',
    signals: [
      { code: 'W-21', name: 'Vadapalani Junction' },
      { code: 'W-24', name: 'Forum Mall Signal' },
    ],
  },
  {
    station: 'C1 Anna Nagar',
    signals: [
      { code: 'C-11', name: 'Anna Nagar Roundtana' },
      { code: 'C-14', name: '2nd Avenue Signal' },
    ],
  },
  {
    station: 'S5 Sholinganallur',
    signals: [
      { code: 'S-81', name: 'Sholinganallur Jn (OMR)' },
      { code: 'S-84', name: 'Perungudi Signal' },
    ],
  },
  {
    station: 'N2 Perambur',
    signals: [{ code: 'N-31', name: 'Perambur High Road Jn' }],
  },
];

const DAYS_BACK = 60;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Deterministic dummy congestion log — stands in for what would otherwise be
// a `/traffic/congestion-report` API response, grouped by morning/evening peak.
function buildRows(): CongestionReportRow[] {
  const rows: CongestionReportRow[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let idx = 0;
  STATIONS.forEach((st, si) => {
    st.signals.forEach((sig, gi) => {
      for (let d = 0; d < DAYS_BACK; d++) {
        idx++;
        const dateObj = new Date(today.getTime() - d * 86400000);

        const usualMorning = 3 + ((si + gi) % 4);
        rows.push({
          station: st.station,
          signalNo: sig.code,
          signalName: sig.name,
          period: 'morning',
          dateObj,
          hour: 8 + ((idx + d) % 2),
          minute: (idx * 13 + d * 7) % 60,
          observedDelay: usualMorning + 4 + ((idx * 7 + d * 3) % 16),
          usualDelay: usualMorning,
        });

        const usualEvening = 3 + ((si + gi + 1) % 4);
        rows.push({
          station: st.station,
          signalNo: sig.code,
          signalName: sig.name,
          period: 'evening',
          dateObj,
          hour: 17 + ((idx + d) % 3),
          minute: (idx * 17 + d * 9) % 60,
          observedDelay: usualEvening + 3 + ((idx * 11 + d * 5) % 15),
          usualDelay: usualEvening,
        });
      }
    });
  });

  return rows;
}

const ALL_ROWS = buildRows();

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

function formatHeaderDate(d: Date): string {
  return `${DAY_NAMES[d.getDay()]}, ${pad2(d.getDate())} ${MONTH_LONG[d.getMonth()]}`;
}

function formatButtonDate(d: Date): string {
  return `${MONTH_SHORT[d.getMonth()]} ${pad2(d.getDate())}-${d.getFullYear()}`;
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${pad2(h)}:${pad2(minute)} ${period}`;
}

@Component({
  selector: 'app-congestions-report',
  templateUrl: './congestions-report.component.html',
  styleUrls: ['./congestions-report.component.scss'],
})
export class CongestionsReportComponent {
  morningLimit = 100;
  eveningLimit = 120;

  showDatePicker = false;
  draftFrom = '';
  draftTo = '';
  private appliedFrom = '';
  private appliedTo = '';

  get isFiltered(): boolean {
    return !!(this.appliedFrom && this.appliedTo);
  }

  // Default view (no filter applied) shows the full dummy dataset; once a
  // date range is applied, the tables narrow to that range only.
  get filteredRows(): CongestionReportRow[] {
    if (!this.isFiltered) return ALL_ROWS;
    const from = new Date(this.appliedFrom);
    const to = new Date(`${this.appliedTo}T23:59:59`);
    return ALL_ROWS.filter(r => r.dateObj >= from && r.dateObj <= to);
  }

  get morningRows(): CongestionReportRow[] {
    return this.topRowsFor('morning', this.morningLimit);
  }

  get eveningRows(): CongestionReportRow[] {
    return this.topRowsFor('evening', this.eveningLimit);
  }

  get headerRangeLabel(): string {
    if (!this.isFiltered) return 'All Dates';
    return `[${formatHeaderDate(new Date(this.appliedFrom))} - ${formatHeaderDate(new Date(this.appliedTo))}]`;
  }

  get dateButtonLabel(): string | null {
    if (!this.isFiltered) return null;
    return `${formatButtonDate(new Date(this.appliedFrom))} ~ ${formatButtonDate(new Date(this.appliedTo))}`;
  }

  toggleDatePicker() {
    if (!this.showDatePicker) {
      this.draftFrom = this.appliedFrom;
      this.draftTo = this.appliedTo;
    }
    this.showDatePicker = !this.showDatePicker;
  }

  applyDateRange() {
    if (!this.draftFrom || !this.draftTo) return;
    this.appliedFrom = this.draftFrom;
    this.appliedTo = this.draftTo;
    this.showDatePicker = false;
  }

  clearDateRange() {
    this.appliedFrom = '';
    this.appliedTo = '';
    this.draftFrom = '';
    this.draftTo = '';
    this.showDatePicker = false;
  }

  formatTime(r: CongestionReportRow): string {
    return formatTime(r.hour, r.minute);
  }

  formatDate(r: CongestionReportRow): string {
    return formatHeaderDate(r.dateObj);
  }

  delayBand(minutes: number): 'usual' | 'normal' | 'intermediate' | 'heavy' {
    if (minutes >= 10) return 'heavy';
    if (minutes >= 6) return 'intermediate';
    if (minutes >= 3) return 'normal';
    return 'usual';
  }

  private topRowsFor(period: CongestionPeriod, limit: number): CongestionReportRow[] {
    return this.filteredRows
      .filter(r => r.period === period)
      .sort((a, b) => b.observedDelay - a.observedDelay)
      .slice(0, limit);
  }
}
