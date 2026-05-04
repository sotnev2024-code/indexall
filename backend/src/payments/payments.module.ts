import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';
import { TariffConfig } from '../admin/tariff-config.entity';
import { TariffOperation } from '../admin/tariff-operation.entity';
import { AppSetting } from '../admin/app-setting.entity';
import { YookassaWebhookGuard } from './yookassa-webhook.guard';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, TariffConfig, TariffOperation, AppSetting]),
    AuthModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, YookassaWebhookGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}
