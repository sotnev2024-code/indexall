import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto, AuthPayload, JwtToken } from '../shared/types';
import { User } from '../users/user.entity';
import { EmailService } from './email.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    @InjectRepository(User) private usersRepo: Repository<User>,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return null;

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) return null;

    if (!user.emailVerified) {
      throw new UnauthorizedException({ unverified: true, email: user.email });
    }

    await this.usersService.updateLastSeen(user.id);
    const { password: _, ...result } = user;
    return result;
  }

  async login(user: any): Promise<JwtToken> {
    const payload: AuthPayload = {
      userId: user.id,
      email: user.email,
      plan: user.plan,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn: 7 * 24 * 60 * 60,
    };
  }

  /** Register: create user, send confirmation email, do NOT return JWT yet */
  async register(registerDto: RegisterDto): Promise<any> {
    const existing = await this.usersService.findByEmail(registerDto.email).catch(() => null);
    if (existing) {
      throw new BadRequestException('Пользователь с таким email уже существует');
    }

    const user = await this.usersService.create(registerDto);

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);

    await this.usersRepo.update(user.id, {
      emailVerificationToken: token,
      emailVerificationExpires: expires,
      emailVerified: false,
    });

    // Send confirmation email — required for account activation
    try {
      await this.emailService.sendConfirmation(registerDto.email, token);
    } catch (emailErr) {
      this.logger.error(`SMTP error during registration for ${registerDto.email}: ${emailErr.message}`);
    }

    // Do NOT verify immediately — user must click the email link
    return { message: 'Письмо с подтверждением отправлено на ' + registerDto.email };
  }

  /** Confirm email by token → return JWT */
  async confirmEmail(token: string): Promise<JwtToken> {
    const user = await this.usersRepo.findOne({ where: { emailVerificationToken: token } });

    if (!user) {
      throw new BadRequestException('Недействительная ссылка подтверждения');
    }
    if (user.emailVerificationExpires && new Date() > user.emailVerificationExpires) {
      throw new BadRequestException('Ссылка подтверждения истекла. Запросите новое письмо');
    }

    await this.usersRepo.update(user.id, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });

    const updated = await this.usersRepo.findOne({ where: { id: user.id } });
    const { password, ...safe } = updated;
    return this.login(safe);
  }

  /** Resend confirmation email */
  async resendConfirmation(email: string): Promise<{ message: string }> {
    const user = await this.usersRepo.findOne({ where: { email } });

    if (!user) {
      // Don't reveal whether email exists
      return { message: 'Если email зарегистрирован, письмо будет отправлено' };
    }
    if (user.emailVerified) {
      throw new BadRequestException('Email уже подтверждён');
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);

    await this.usersRepo.update(user.id, {
      emailVerificationToken: token,
      emailVerificationExpires: expires,
    });

    try {
      await this.emailService.sendConfirmation(email, token);
    } catch (emailErr) {
      this.logger.error(`SMTP error during resend for ${email}: ${emailErr.message}`);
      throw new BadRequestException('Не удалось отправить письмо. Проверьте конфигурацию SMTP');
    }

    return { message: 'Письмо с подтверждением отправлено повторно' };
  }
}
