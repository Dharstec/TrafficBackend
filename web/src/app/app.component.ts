import { Component } from '@angular/core';
import { AuthService } from './core/services/auth.service';
import { ThemeService } from './core/services/theme.service';
import { SocketService } from './core/services/socket.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  // Injected (not just referenced in template) so it initializes and applies
  // the saved/system theme immediately, even on routes without the sidebar.
  constructor(public auth: AuthService, private theme: ThemeService, socket: SocketService) {
    // Reconnect the live WebSocket on page refresh — login only fires once,
    // so a reload with a saved token would otherwise leave the socket dead.
    if (auth.isLoggedIn && auth.currentUser) socket.connect(auth.currentUser);
  }
}
