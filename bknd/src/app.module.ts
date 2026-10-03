import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiAgentModule } from './ai-agent/ai-agent.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { FlightDelayModule } from './flight-delay/flight-delay.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    FlightDelayModule,
    AiAgentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
