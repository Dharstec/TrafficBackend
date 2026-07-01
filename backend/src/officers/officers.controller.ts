import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { OfficersService } from './officers.service';
import { TrafficGateway } from '../gateway/traffic.gateway';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('officers')
export class OfficersController {
  constructor(
    private service: OfficersService,
    private gateway: TrafficGateway,
  ) {}

  @Get()
  findAll() { return this.service.findAll(); }

  @Get('live-locations')
  getLiveLocations() { return this.service.getActiveLiveLocations(); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(+id); }

  @Get(':id/location-history')
  getLocationHistory(@Param('id') id: string, @Query('hours') hours?: string) {
    return this.service.getLocationHistory(+id, hours ? +hours : 8);
  }

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @Roles('admin', 'supervisor')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(+id, body); }

  @Post('location')
  async updateLocation(
    @Request() req,
    @Body() body: { lat: number; lng: number; accuracy?: number },
  ) {
    await this.service.updateLocation(req.user.id, body.lat, body.lng, body.accuracy);

    // Broadcast live position to admin/supervisor web dashboards
    this.gateway.broadcastOfficerLocation({
      officer_id: req.user.id,
      name: req.user.name,
      badge_number: req.user.badge_number,
      role: req.user.role,
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy,
      time: new Date(),
    });

    return { ok: true };
  }
}
