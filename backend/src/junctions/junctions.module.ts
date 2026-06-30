import { Module } from '@nestjs/common';
import { JunctionsService } from './junctions.service';
import { JunctionsController } from './junctions.controller';

@Module({
  providers: [JunctionsService],
  controllers: [JunctionsController],
  exports: [JunctionsService],
})
export class JunctionsModule {}
