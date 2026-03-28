import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from '../shared/types';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { User, UserPlan } from '../users/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Вход в систему' })
  async login(@Body() loginDto: LoginDto) {
    try {
      const user = await this.authService.validateUser(loginDto.email, loginDto.password);
      if (!user) {
        return { error: 'Неверный email или пароль' };
      }
      return this.authService.login(user);
    } catch (err: any) {
      // Email not verified — pass unverified flag to frontend
      if (err?.response?.unverified) {
        return { error: 'Email не подтверждён', unverified: true, email: err.response.email };
      }
      return { error: 'Неверный email или пароль' };
    }
  }

  @Post('register')
  @ApiOperation({ summary: 'Регистрация нового пользователя' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Get('confirm')
  @ApiOperation({ summary: 'Подтвердить email по токену из письма' })
  async confirmEmail(@Query('token') token: string) {
    if (!token) throw new BadRequestException('Токен не передан');
    return this.authService.confirmEmail(token);
  }

  @Post('confirm/resend')
  @ApiOperation({ summary: 'Повторная отправка письма с подтверждением' })
  async resendConfirmation(@Body('email') email: string) {
    if (!email) throw new BadRequestException('Email не передан');
    return this.authService.resendConfirmation(email);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Получить текущего пользователя' })
  async me(@Request() req) {
    const user = await this.usersService.findOne(req.user.userId);
    const { password, ...safe } = user;
    return safe;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Выход из системы' })
  async logout() {
    return { message: 'Успешный выход' };
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Обновить имя/email профиля' })
  async updateProfile(
    @Request() req,
    @Body() body: { name?: string; email?: string },
  ) {
    const updated = await this.usersService.updateProfile(req.user.userId, body);
    const { password, ...safe } = updated;
    return safe;
  }

  @Patch('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Изменить пароль' })
  async changePassword(
    @Request() req,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    if (!body.oldPassword || !body.newPassword) {
      throw new BadRequestException('Необходимо указать текущий и новый пароль');
    }
    await this.usersService.changePassword(req.user.userId, body.oldPassword, body.newPassword);
    return { message: 'Пароль успешно изменён' };
  }

  @Post('trial')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Активировать пробный 7-дневный тариф' })
  async activateTrial(@Request() req) {
    const user = await this.usersRepo.findOne({ where: { id: req.user.userId } });
    if (!user) throw new BadRequestException('Пользователь не найден');
    if (user.plan !== UserPlan.FREE) throw new BadRequestException('Пробный тариф доступен только для бесплатного плана');
    if (user.trialUsed) throw new BadRequestException('Пробный тариф уже был использован');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.usersRepo.update(user.id, {
      plan: UserPlan.TRIAL,
      trialUsed: true,
      subscriptionExpiresAt: expiresAt,
    });

    const updated = await this.usersRepo.findOne({ where: { id: user.id } });
    const { password, ...safe } = updated;
    return safe;
  }
}
