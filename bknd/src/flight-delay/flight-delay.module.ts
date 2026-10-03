import { Module } from '@nestjs/common';
import { FlightDelayController } from './flight-delay.controller.js';
import { FlightDelayService } from './flight-delay.service.js';

@Module({
  controllers: [FlightDelayController],
  providers: [FlightDelayService],
  exports: [FlightDelayService],
})
export class FlightDelayModule {}
