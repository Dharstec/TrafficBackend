import { Component, OnInit, OnDestroy } from '@angular/core';
import { TrafficService } from '../../core/services/traffic.service';
import { OfficerService } from '../../core/services/officer.service';
import { JunctionService } from '../../core/services/junction.service';
import { SocketService } from '../../core/services/socket.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  trafficData: any[] = [];
  officers: any[] = [];
  junctions: any[] = [];
  incidents: any[] = [];
  private subs: Subscription[] = [];

  stats = { total: 0, heavy: 0, intermediate: 0, normal: 0, usual: 0, activeOfficers: 0 };

  constructor(
    private trafficSvc: TrafficService,
    private officerSvc: OfficerService,
    private junctionSvc: JunctionService,
    private socket: SocketService,
  ) {}

  ngOnInit() {
    this.load();
    this.subs.push(
      this.socket.trafficUpdates$.subscribe(() => this.load()),
    );
  }

  load() {
    this.trafficSvc.getLatest().subscribe(data => {
      this.trafficData = data;
      this.calcStats(data);
    });
    this.officerSvc.getLiveLocations().subscribe(d => {
      this.officers = d;
      this.stats.activeOfficers = d.length;
    });
    this.junctionSvc.getAll().subscribe(d => this.junctions = d);
    this.officerSvc.getIncidents('open').subscribe(d => this.incidents = d);
  }

  calcStats(data: any[]) {
    this.stats.total = data.length;
    this.stats.heavy = data.filter(d => d.congestion_level === 'heavy').length;
    this.stats.intermediate = data.filter(d => d.congestion_level === 'intermediate').length;
    this.stats.normal = data.filter(d => d.congestion_level === 'normal').length;
    this.stats.usual = data.filter(d => d.congestion_level === 'usual').length;
  }

  getColor(level: string) { return this.trafficSvc.getCongestionColor(level); }

  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }
}
