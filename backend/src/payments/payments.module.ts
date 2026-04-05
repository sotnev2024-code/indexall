import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { TariffConfig } from '../admin/tariff-config.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, TariffConfig]),
    AuthModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
