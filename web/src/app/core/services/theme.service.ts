import { Injectable } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private current: Theme;

  constructor() {
    const saved = localStorage.getItem('traffic_theme') as Theme | null;
    this.current = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
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
