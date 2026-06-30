import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: '*' } })
export class TrafficGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedClients = new Map<string, { socketId: string; officerId?: number; role?: string }>();

  handleConnection(client: Socket) {
    this.connectedClients.set(client.id, { socketId: client.id });
  }

  handleDisconnect(client: Socket) {
    this.connectedClients.delete(client.id);
  }

  @SubscribeMessage('register')
  handleRegister(client: Socket, data: { officerId: number; role: string }) {
    this.connectedClients.set(client.id, { socketId: client.id, ...data });
    client.join(`role:${data.role}`);
    client.join(`officer:${data.officerId}`);
  }

  // Called by simulator — broadcasts to all web clients
  broadcastTrafficUpdate(data: any) {
    this.server.emit('traffic:update', data);
  }

  // Called when officer location updates
  broadcastOfficerLocation(data: any) {
    this.server.to('role:admin').emit('officer:location', data);
    this.server.to('role:supervisor').emit('officer:location', data);
  }

  // Called on check-in/out
  broadcastCheckinUpdate(data: any) {
    this.server.emit('checkin:update', data);
  }

  // Called on new incident
  broadcastIncident(data: any) {
    this.server.to('role:admin').emit('incident:new', data);
    this.server.to('role:supervisor').emit('incident:new', data);
  }

  getConnectedCount() {
    return this.connectedClients.size;
  }
}
