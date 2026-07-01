import { Module } from '@nestjs/common';
import { TrafficService } from './traffic.service';
import { TrafficController } from './traffic.controller';

@Module({
  providers: [TrafficService],
  controllers: [TrafficController],
  exports: [TrafficService],
})
export class TrafficModule {}
