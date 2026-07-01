import { Module } from '@nestjs/common';
import { TrafficService } from './traffic.service';
import { TrafficController } from './traffic.controller';
import { TrafficGateway } from '../gateway/traffic.gateway';

@Module({
  providers: [TrafficService, TrafficGateway],
  controllers: [TrafficController],
  exports: [TrafficService],
})
export class TrafficModule {}
