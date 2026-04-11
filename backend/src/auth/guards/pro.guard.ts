import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';

const PAID_PLANS = new Set(['trial', 'base', 'pro']);

@Injectable()
export class ProGuard implements CanActivate {
  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const reqUser = request.user;
    if (!reqUser?.userId) throw new ForbiddenException('Auth required');
    if (reqUser.plan === 'admin') return true;

    // Re-fetch from DB so we always check current expiry
    const user = await this.usersRepo.findOne({ where: { id: reqUser.userId } });
    if (!user) throw new ForbiddenException('User not found');
    if (user.plan === 'admin') return true;
    if (!PAID_PLANS.has(user.plan)) throw new ForbiddenException('Подписка не активна');
    if (!user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt).getTime() <= Date.now()) {
      throw new ForbiddenException('Подписка истекла');
    }
    return true;
  }
}
