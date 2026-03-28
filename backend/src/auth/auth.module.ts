import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { EmailService } from './email.service';
import { UsersModule } from '../users/users.module';
import { User } from '../users/user.entity';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    ConfigModule,
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN') || '7d',
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, EmailService],
  controllers: [AuthController],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
