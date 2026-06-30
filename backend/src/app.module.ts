import 'dotenv/config';
import { Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { JunctionsModule } from './junctions/junctions.module';
import { TrafficModule } from './traffic/traffic.module';
import { OfficersModule } from './officers/officers.module';
import { CheckinsModule } from './checkins/checkins.module';
import { IncidentsModule } from './incidents/incidents.module';
import { TrafficGateway } from './gateway/traffic.gateway';
import { SimulatorService } from './simulator/simulator.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    JunctionsModule,
    TrafficModule,
    OfficersModule,
    CheckinsModule,
    IncidentsModule,
  ],
  providers: [TrafficGateway, SimulatorService],
})
export class AppModule implements OnModuleInit {
  constructor(private simulator: SimulatorService) {}

  async onModuleInit() {
    // Seed initial traffic data on startup
    setTimeout(() => this.simulator.runOnce(), 3000);
  }
}
