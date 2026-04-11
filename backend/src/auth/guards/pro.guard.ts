import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

const PRO_PLANS = new Set(['trial', 'base', 'pro', 'admin']);

@Injectable()
export class ProGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || !PRO_PLANS.has(user.plan)) {
      throw new ForbiddenException('PRO plan required');
    }
    return true;
  }
}
