import { Global, Module } from '@nestjs/common';
import { TrafficGateway } from './traffic.gateway';

@Global()
@Module({
  providers: [TrafficGateway],
  exports: [TrafficGateway],
})
export class GatewayModule {}
