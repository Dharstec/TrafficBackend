import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { CheckinsService } from './checkins.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('checkins')
export class CheckinsController {
  constructor(private service: CheckinsService) {}

  @Post('auto')
  autoCheckin(@Request() req, @Body() body: { lat: number; lng: number }) {
    return this.service.autoCheckin(req.user.id, body.lat, body.lng);
  }

  @Post('manual')
  manualCheckin(@Request() req, @Body() body: { junction_id: number; lat: number; lng: number }) {
    return this.service.manualCheckin(req.user.id, body.junction_id, body.lat, body.lng);
  }

  @Post('auto-checkout')
  autoCheckout(@Request() req, @Body() body: { lat: number; lng: number }) {
    return this.service.autoCheckout(req.user.id, body.lat, body.lng);
  }

  @Post('checkout')
  manualCheckout(@Request() req) {
    return this.service.manualCheckout(req.user.id);
  }

  @Post('devices')
  saveDevices(@Request() req, @Body() body: any) {
    return this.service.saveDeviceStatus(req.user.id, body.checkin_id, body);
  }

  @Get('active')
  getActive() { return this.service.getActiveCheckins(); }

  @Get('my/today')
  getMyToday(@Request() req) { return this.service.getTodayDuty(req.user.id); }

  @Get('today/all')
  getAllToday() { return this.service.getAllTodayDuty(); }

  @Get('my')
  getMy(@Request() req) { return this.service.getMyCheckins(req.user.id); }

  @Get('my/active')
  getMyActive(@Request() req) { return this.service.getActiveCheckin(req.user.id); }
}
