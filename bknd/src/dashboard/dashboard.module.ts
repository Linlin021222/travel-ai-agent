import { Module } from '@nestjs/common';
import { FlightDelayModule } from '../flight-delay/flight-delay.module.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [FlightDelayModule],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
