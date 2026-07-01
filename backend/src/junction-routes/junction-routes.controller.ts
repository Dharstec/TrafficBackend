import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JunctionRoutesService } from './junction-routes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('junction-routes')
export class JunctionRoutesController {
  constructor(private service: JunctionRoutesService) {}

  @Get()
  findAll() { return this.service.findAll(); }

  @Get('latest-traffic')
  getLatestTraffic() { return this.service.getLatestRouteTraffic(); }

  @Get('junction/:id')
  findByJunction(@Param('id') id: string) { return this.service.findByJunction(+id); }

  @Post()
  @Roles('admin', 'supervisor')
  create(@Body() body: any) { return this.service.create(body); }

  @Put(':id')
  @Roles('admin', 'supervisor')
  update(@Param('id') id: string, @Body() body: any) { return this.service.update(+id, body); }

  @Delete(':id')
  @Roles('admin', 'supervisor')
  remove(@Param('id') id: string) { return this.service.remove(+id); }
}
