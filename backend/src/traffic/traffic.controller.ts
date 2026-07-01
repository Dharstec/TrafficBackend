import { Controller, Get, Post, Body, Query, Param, UseGuards, Request } from '@nestjs/common';
import { TrafficService } from './traffic.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('traffic')
export class TrafficController {
  constructor(private service: TrafficService) {}

  @Get('latest')
  getLatest() { return this.service.getLatest(); }

  @Get('routes/latest')
  getRoutesLatest() { return this.service.getLatestRouteTraffic(); }

  @Get('junction/:id')
  getByJunction(@Param('id') id: string, @Query('hours') hours?: string) {
    return this.service.getByJunction(+id, hours ? +hours : 24);
  }

  @Get('history')
  getHistory(
    @Query('junction_id') junctionId: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.service.getHistory(+junctionId, start, end);
  }

  @Get('snapshot')
  getSnapshot(@Query('date') date: string, @Query('time') time: string) {
    return this.service.getCongestionSnapshot(date, time);
  }

  @Get('report/weekly')
  getWeeklyReport(@Query('junction_id') junctionId?: string) {
    return this.service.getWeeklyReport(junctionId ? +junctionId : undefined);
  }

  @Post('clear')
  clearTraffic(@Request() req, @Body() body: { junction_id: number }) {
    return this.service.clearTraffic(req.user.id, body.junction_id);
  }
}
