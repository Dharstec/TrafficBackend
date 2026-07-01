import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JunctionsService } from './junctions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('junctions')
export class JunctionsController {
  constructor(private service: JunctionsService) {}

  // All roles can read junctions
  @Get()
  findAll() { return this.service.findAll(); }

  @Get('nearby')
  findNearby(@Query('lat') lat: string, @Query('lng') lng: string, @Query('radius') radius?: string) {
    return this.service.findNearby(+lat, +lng, radius ? +radius : 200);
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.service.findOne(+id); }

  // Only supervisor and admin can create/edit/delete junctions
  @Post('set-test')
  @Roles('admin', 'supervisor')
  setTestJunction(@Body() body: { lat: number; lng: number }) {
    return this.service.setTestJunction(body.lat, body.lng);
  }

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @Roles('admin', 'supervisor')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(+id, body); }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) { return this.service.remove(+id); }
}
