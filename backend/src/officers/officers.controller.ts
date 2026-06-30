import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { OfficersService } from './officers.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('officers')
export class OfficersController {
  constructor(private service: OfficersService) {}

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
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(+id, body); }

  @Post('location')
  updateLocation(@Request() req, @Body() body: { lat: number; lng: number; accuracy?: number }) {
    return this.service.updateLocation(req.user.id, body.lat, body.lng, body.accuracy);
  }
}
