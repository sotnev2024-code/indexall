import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Allow-list of source IP ranges for YooKassa HTTP notifications.
 * Source: https://yookassa.ru/developers/using-api/webhooks#ip
 * Updated 2025-Q1.
 */
const YOOKASSA_RANGES_V4 = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.154.128/25',
  '77.75.156.11/32',
  '77.75.156.35/32',
];
// IPv6: 2a02:5180::/32 — prefix check is sufficient for /32.
const YOOKASSA_V6_PREFIX = '2a02:5180:';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function inV4Cidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(base)) return false;
  const maskBits = Number(bits);
  if (!Number.isFinite(maskBits) || maskBits < 0 || maskBits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** True iff `ip` belongs to any YooKassa-published range. */
export function isYookassaIp(ip: string): boolean {
  if (!ip) return false;
  // Express may report IPv4 mapped as ::ffff:1.2.3.4 — strip the prefix.
  const clean = ip.replace(/^::ffff:/, '');
  if (clean.startsWith(YOOKASSA_V6_PREFIX)) return true;
  return YOOKASSA_RANGES_V4.some(c => inV4Cidr(clean, c));
}

/** Local-machine addresses allowed only for `curl` smoke tests on the box. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

@Injectable()
export class YookassaWebhookGuard implements CanActivate {
  private readonly logger = new Logger(YookassaWebhookGuard.name);

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    // Express needs `app.set('trust proxy', 1)` for req.ip to honour
    // X-Forwarded-For; that's enabled in main.ts.
    const ip = (req.ip || '').replace(/^::ffff:/, '');

    // Escape hatch for early debugging — set YOOKASSA_WEBHOOK_TRUST_ALL=1
    // in the env to bypass the check. Don't leave this on in production.
    if (process.env.YOOKASSA_WEBHOOK_TRUST_ALL === '1') {
      this.logger.warn(`Webhook IP check bypassed (YOOKASSA_WEBHOOK_TRUST_ALL=1). ip=${ip}`);
      return true;
    }

    if (LOOPBACK.has(ip)) {
      this.logger.debug(`Webhook from loopback (${ip}) accepted`);
      return true;
    }

    if (isYookassaIp(ip)) return true;

    this.logger.warn(`Webhook rejected: ${ip} not in YooKassa allow-list`);
    return false;
  }
}
