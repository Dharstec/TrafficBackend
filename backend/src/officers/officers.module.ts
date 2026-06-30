import { Module } from '@nestjs/common';
import { OfficersService } from './officers.service';
import { OfficersController } from './officers.controller';

@Module({
  providers: [OfficersService],
  controllers: [OfficersController],
  exports: [OfficersService],
})
export class OfficersModule {}
