import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('simulator')
export class SimulatorController {
  constructor(private service: SimulatorService) {}

  // Manual "Refresh Now" from the dashboard — the only way Google gets
  // called unless AUTO_REFRESH=true is set in .env.
  @Post('refresh')
  async refresh() {
    await this.service.runOnce();
    return { refreshed: true, usage: this.service.getUsage(), time: new Date() };
  }

  // Monthly free-tier usage — the dashboard shows this next to the button.
  @Get('usage')
  usage() {
    return this.service.getUsage();
  }
}
