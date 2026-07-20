import { Component } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { UiService } from '../../../core/services/ui.service';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
})
export class SidebarComponent {
  constructor(public auth: AuthService, public theme: ThemeService, public ui: UiService) {}

  // Mobile drawer is a CSS checkbox — tapping a nav link must close it,
  // otherwise the open drawer keeps covering the page just navigated to.
  closeDrawer() {
    const cb = document.getElementById('sidebar-toggle') as HTMLInputElement | null;
    if (cb) cb.checked = false;
  }
}
