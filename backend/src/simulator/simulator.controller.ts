import { Controller, Post, UseGuards } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('simulator')
export class SimulatorController {
  constructor(private service: SimulatorService) {}

  // Manual "Refresh Now" from the dashboard — runs the same Google API pass
  // the 5-minute cron does, without waiting for the next tick.
  @Post('refresh')
  async refresh() {
    await this.service.runOnce();
    return { refreshed: true, time: new Date() };
  }
}
