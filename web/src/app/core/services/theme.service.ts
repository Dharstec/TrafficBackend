import { Injectable } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private current: Theme;

  constructor() {
    // Dark mode toggle is hidden from the UI — force light always, so the
    // app never falls back to a device's system dark mode or an old saved
    // 'dark' choice with no way left to switch it back. Un-hide the toggle
    // in sidebar.component.html to restore the saved/system-based logic.
    this.current = 'light';
    localStorage.removeItem('traffic_theme');
    this.apply();
  }

  get theme() { return this.current; }
  get isDark() { return this.current === 'dark'; }

  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('traffic_theme', this.current);
    this.apply();
  }

  private apply() {
    document.documentElement.setAttribute('data-theme', this.current);
  }
}
