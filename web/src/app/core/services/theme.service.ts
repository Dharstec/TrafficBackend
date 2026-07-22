import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private current: Theme;
  // Charts (ECharts) render onto a <canvas> and can't react to CSS custom
  // property changes on their own — anything that needs to recolor on a
  // theme toggle subscribes here instead of re-reading the DOM on a timer.
  private themeSubject: BehaviorSubject<Theme>;
  theme$;

  constructor() {
    const saved = localStorage.getItem('traffic_theme') as Theme | null;
    this.current = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    this.themeSubject = new BehaviorSubject<Theme>(this.current);
    this.theme$ = this.themeSubject.asObservable();
    this.apply();
  }

  get theme() { return this.current; }
  get isDark() { return this.current === 'dark'; }

  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('traffic_theme', this.current);
    this.apply();
    this.themeSubject.next(this.current);
  }

  private apply() {
    document.documentElement.setAttribute('data-theme', this.current);
  }
}
