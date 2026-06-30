import { Module } from '@nestjs/common';
import { CheckinsService } from './checkins.service';
import { CheckinsController } from './checkins.controller';

@Module({
  providers: [CheckinsService],
  controllers: [CheckinsController],
  exports: [CheckinsService],
})
export class CheckinsModule {}
