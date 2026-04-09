import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EtmCredential } from './etm-credential.entity';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

/**
 * ETM iPRO API — uses curl subprocess (Debian OpenSSL 1.1.x is lenient with ETM's TLS).
 * Alpine OpenSSL 3.x rejects ETM's non-compliant TLS close_notify.
 */
@Injectable()
export class EtmService {
  private readonly logger = new Logger(EtmService.name);

  private sessionKey: string | null = null;
  private sessionExpiry = 0;

  private readonly host = 'ipro.etm.ru';

  private get login() { return process.env.ETM_LOGIN; }
  private get pwd() { return process.env.ETM_PASSWORD; }

  private readonly cookieJar = '/tmp/etm_cookies.txt';

  private readonly ENCRYPTION_KEY: Buffer;
  private readonly userSessions = new Map<number, { key: string; expiry: number }>();

  constructor(
    @InjectRepository(EtmCredential)
    private readonly credRepo: Repository<EtmCredential>,
  ) {
    const rawKey = process.env.ETM_ENCRYPTION_KEY || 'default-secret-key-32-chars!!!!!';
    this.ENCRYPTION_KEY = crypto.scryptSync(rawKey, 'salt', 32);
  }

  encryptPassword(pwd: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.ENCRYPTION_KEY, iv);
    const enc = Buffer.concat([cipher.update(pwd, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + enc.toString('hex');
  }

  decryptPassword(enc: string): string {
    const [ivHex, dataHex] = enc.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.ENCRYPTION_KEY, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  isConfigured(): boolean {
    return !!(this.login && this.pwd);
  }

  async saveCredentials(userId: number, login: string, password: string): Promise<void> {
    const password_enc = this.encryptPassword(password);
    await this.credRepo.save({ user_id: userId, login, password_enc, session_key: null, session_expires_at: null });
    // Clear cached session for this user
    this.userSessions.delete(userId);
  }

  async getCredentials(userId: number): Promise<{ configured: boolean; login?: string }> {
    const cred = await this.credRepo.findOne({ where: { user_id: userId } });
    return { configured: !!cred, login: cred?.login };
  }

  async removeCredentials(userId: number): Promise<void> {
    await this.credRepo.delete({ user_id: userId });
    this.userSessions.delete(userId);
  }

  private async getUserSession(userId: number): Promise<string | null> {
    // Check in-memory cache
    const cached = this.userSessions.get(userId);
    if (cached && Date.now() < cached.expiry) return cached.key;

    // Load from DB
    const cred = await this.credRepo.findOne({ where: { user_id: userId } });
    if (!cred) return null;

    // Check DB session
    if (cred.session_key && cred.session_expires_at && new Date() < cred.session_expires_at) {
      const expiry = cred.session_expires_at.getTime();
      this.userSessions.set(userId, { key: cred.session_key, expiry });
      return cred.session_key;
    }

    // Re-authenticate
    const password = this.decryptPassword(cred.password_enc);
    const url = `https://${this.host}/api/v1/user/login?log=${encodeURIComponent(cred.login)}&pwd=${encodeURIComponent(password)}`;
    let json: any;
    try {
      json = await this.curlRequest(url, 'POST', true);
    } catch (e: any) {
      this.logger.error(`ETM user login error (user ${userId}): ${e?.message}`);
      return null;
    }
    if (json?.status?.code !== 200) {
      this.logger.warn(`ETM user login failed (user ${userId}): ${json?.status?.message}`);
      return null;
    }

    const sessionKey = String(json.data.session);
    const expiresAt = new Date(Date.now() + 7.5 * 60 * 60 * 1000);
    await this.credRepo.update({ user_id: userId }, { session_key: sessionKey, session_expires_at: expiresAt });
    this.userSessions.set(userId, { key: sessionKey, expiry: expiresAt.getTime() });
    this.logger.log(`ETM session refreshed for user ${userId}`);
    return sessionKey;
  }

  async getPricesForUser(articles: string[], userId?: number): Promise<Record<string, number | null>> {
    if (userId) {
      const userSession = await this.getUserSession(userId);
      if (userSession) {
        return this.getPricesWithSession(articles, userSession);
      }
      // Fall through to global session if user session unavailable
    }
    return this.getPrices(articles);
  }

  private async getPricesWithSession(articles: string[], session: string): Promise<Record<string, number | null>> {
    const unique = [...new Set(articles.filter((a) => a && a.trim()))];
    const results: Record<string, number | null> = {};
    if (unique.length === 0) return results;

    for (let i = 0; i < unique.length; i++) {
      const article = unique[i];
      try {
        results[article] = await this.fetchPrice(article, session);
      } catch {
        results[article] = null;
      }
      if (i < unique.length - 1) await this.sleep(1100);
    }
    return results;
  }

  private async curlRequest(url: string, method: 'GET' | 'POST' = 'GET', saveCookies = false): Promise<any> {
    const args = [
      '-s',
      '--show-error',
      '--http1.1',
      '--max-time', '30',
      '-H', 'Accept: application/json',
      '-H', `Host: ${this.host}`,
      '-b', this.cookieJar,
    ];

    if (saveCookies) {
      args.push('-c', this.cookieJar);
    }

    if (process.env.ETM_HTTPS_PROXY?.trim()) {
      args.push('-x', process.env.ETM_HTTPS_PROXY.trim());
    }

    if (method === 'POST') {
      args.push('--data', '');
    }

    args.push(url);

    let stdout = '';
    try {
      const result = await execFileAsync('curl', args, { timeout: 35_000 });
      stdout = result.stdout;
    } catch (e: any) {
      throw new Error(e?.stderr || e?.message);
    }

    try {
      return JSON.parse(stdout || '{}');
    } catch {
      throw new Error(`Invalid JSON from ETM: ${stdout?.slice(0, 200)}`);
    }
  }

  private async authenticate(): Promise<string> {
    if (!this.login || !this.pwd) {
      throw new HttpException(
        'ETM credentials not configured. Set ETM_LOGIN and ETM_PASSWORD in .env',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const url = `https://${this.host}/api/v1/user/login?log=${encodeURIComponent(this.login)}&pwd=${encodeURIComponent(this.pwd)}`;

    let json: any;
    try {
      json = await this.curlRequest(url, 'POST', true);
    } catch (e: any) {
      this.logger.error(`ETM login error: ${e?.message}`);
      throw new HttpException(`ETM login error: ${e?.message}`, HttpStatus.BAD_GATEWAY);
    }

    if (json?.status?.code !== 200) {
      throw new HttpException(
        `ETM login failed: ${json?.status?.message || 'unknown error'}`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.sessionKey = String(json.data.session);
    this.sessionExpiry = Date.now() + 7.5 * 60 * 60 * 1000;
    this.logger.log('ETM session refreshed');
    return this.sessionKey;
  }

  private async getSession(): Promise<string> {
    if (this.sessionKey && Date.now() < this.sessionExpiry) {
      return this.sessionKey;
    }
    return this.authenticate();
  }

  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  private async fetchPrice(article: string, session: string): Promise<number | null> {
    const url =
      `https://${this.host}/api/v1/goods/${encodeURIComponent(article)}/price` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;

    let json: any;
    try {
      json = await this.curlRequest(url, 'GET');
    } catch {
      return null;
    }

    if (json?.status?.code !== 200 || !json.data) return null;

    // API returns data.rows[] array
    const row = Array.isArray(json.data.rows) ? json.data.rows[0] : json.data;
    const p = row?.pricewnds ?? row?.price ?? 0;
    return Number(p) > 0 ? Number(p) : null;
  }

  async getPrices(
    articles: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<string, number | null>> {
    const unique = [...new Set(articles.filter((a) => a && a.trim()))];
    const results: Record<string, number | null> = {};

    if (unique.length === 0) return results;

    const session = await this.getSession();

    for (let i = 0; i < unique.length; i++) {
      const article = unique[i];
      try {
        results[article] = await this.fetchPrice(article, session);
      } catch {
        results[article] = null;
      }

      onProgress?.(i + 1, unique.length);

      if (i < unique.length - 1) {
        await this.sleep(1100);
      }
    }

    this.logger.log(
      `ETM prices fetched: ${unique.length} articles, ` +
        `${Object.values(results).filter((v) => v !== null).length} found`,
    );

    return results;
  }
}
