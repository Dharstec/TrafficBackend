import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

// Desktop sidebar collapse — state lives on <body> as a class so both the
// fixed sidebar and .main-content margin react from plain CSS, and pages
// with maps can subscribe to re-measure after the width transition.
@Injectable({ providedIn: 'root' })
export class UiService {
  private collapsedSubject = new BehaviorSubject<boolean>(
    localStorage.getItem('traffic_sidebar') === 'collapsed'
  );
  sidebarCollapsed$ = this.collapsedSubject.asObservable();

  constructor() { this.apply(); }

  get sidebarCollapsed() { return this.collapsedSubject.value; }

  toggleSidebar() {
    const next = !this.sidebarCollapsed;
    localStorage.setItem('traffic_sidebar', next ? 'collapsed' : 'open');
    this.collapsedSubject.next(next);
    this.apply();
  }

  private apply() {
    document.body.classList.toggle('sidebar-collapsed', this.sidebarCollapsed);
  }
}
