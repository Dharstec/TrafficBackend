import { Module } from '@nestjs/common';
import { JunctionRoutesService } from './junction-routes.service';
import { JunctionRoutesController } from './junction-routes.controller';

@Module({
  providers: [JunctionRoutesService],
  controllers: [JunctionRoutesController],
  exports: [JunctionRoutesService],
})
export class JunctionRoutesModule {}
