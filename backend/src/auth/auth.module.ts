import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { EmailService } from './email.service';
import { OAuthService } from './oauth.service';
import { OAuthController } from './oauth.controller';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';
import { TariffConfig } from '../admin/tariff-config.entity';
import { TariffOperation } from '../admin/tariff-operation.entity';
import { AppSetting } from '../admin/app-setting.entity';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    ConfigModule,
    TypeOrmModule.forFeature([User, TariffConfig, TariffOperation, AppSetting]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN') || '30d',
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, EmailService, OAuthService],
  controllers: [AuthController, OAuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
