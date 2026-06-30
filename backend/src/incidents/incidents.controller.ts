import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private service: IncidentsService) {}

  @Get()
  findAll(@Query('status') status?: string) { return this.service.findAll(status); }

  @Post()
  create(@Request() req, @Body() body: any) { return this.service.create(req.user.id, body); }

  @Put(':id/resolve')
  resolve(@Param('id') id: string, @Request() req) { return this.service.resolve(+id, req.user.id); }

  @Put(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateStatus(+id, body.status);
  }
}
