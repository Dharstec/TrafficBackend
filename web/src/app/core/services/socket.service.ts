import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket;

  trafficUpdates$ = new Subject<any[]>();
  officerLocations$ = new Subject<any>();
  checkinUpdates$ = new Subject<any>();
  incidents$ = new Subject<any>();
  heavyAlerts$ = new Subject<any>();
  trafficCleared$ = new Subject<any>();

  connect(user: any) {
    if (this.socket?.connected) return;

    this.socket = io(environment.wsUrl, { transports: ['websocket'] });

    this.socket.on('connect', () => {
      this.socket.emit('register', { officerId: user.id, role: user.role });
    });

    this.socket.on('traffic:update', (data) => this.trafficUpdates$.next(data));
    this.socket.on('officer:location', (data) => this.officerLocations$.next(data));
    this.socket.on('checkin:update', (data) => this.checkinUpdates$.next(data));
    this.socket.on('incident:new', (data) => this.incidents$.next(data));
    this.socket.on('traffic:heavy', (data) => this.heavyAlerts$.next(data));
    this.socket.on('traffic:cleared', (data) => this.trafficCleared$.next(data));
  }

  disconnect() { this.socket?.disconnect(); }
}
