import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/** Модуль распознавания на обкатке: доступ только перечисленным аккаунтам.
 *  Когда откроем всем — убрать guard из recognition.controller.ts и
 *  условия по email в Header.tsx / app/recognition/page.tsx. */
export const RECOGNITION_ALLOWED_EMAILS = ['sotnev2024@gmail.com'];

@Injectable()
export class RecognitionAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    const email = String(user?.email || '').toLowerCase();
    if (!RECOGNITION_ALLOWED_EMAILS.includes(email)) {
      throw new ForbiddenException('Раздел недоступен');
    }
    return true;
  }
}
