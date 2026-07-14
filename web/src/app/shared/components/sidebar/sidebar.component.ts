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
}
