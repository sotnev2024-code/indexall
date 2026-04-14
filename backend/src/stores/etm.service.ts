import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { EtmCredential } from './etm-credential.entity';
import { EtmCache } from './etm-cache.entity';
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

  // Global rate-limited request queue.
  // Official ETM API docs (24.01.2025): 1 request per second per endpoint. ETM reserves the right
  // to block the client IP on excess. Keep 1100ms to stay above the 1 req/sec threshold.
  private requestQueue: Promise<any> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly MIN_INTERVAL_MS = 1100;

  constructor(
    @InjectRepository(EtmCredential)
    private readonly credRepo: Repository<EtmCredential>,
    @InjectRepository(EtmCache)
    private readonly cacheRepo: Repository<EtmCache>,
  ) {
    const rawKey = (process.env.ETM_ENCRYPTION_KEY || 'default-secret-key-indexall-2024').padEnd(32, '!').slice(0, 32);
    try {
      this.ENCRYPTION_KEY = crypto.scryptSync(rawKey, 'salt', 32);
    } catch {
      this.ENCRYPTION_KEY = Buffer.from(rawKey.padEnd(32, '0').slice(0, 32));
    }
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

  private async getUserSession(userId: number, forceRefresh = false): Promise<string | null> {
    if (!forceRefresh) {
      // Check in-memory cache
      const cached = this.userSessions.get(userId);
      if (cached && Date.now() < cached.expiry) return cached.key;
    }

    // Load from DB
    const cred = await this.credRepo.findOne({ where: { user_id: userId } });
    if (!cred) return null;

    // Check DB session (skip if forcing refresh)
    if (!forceRefresh && cred.session_key && cred.session_expires_at && new Date() < cred.session_expires_at) {
      const expiry = cred.session_expires_at.getTime();
      this.userSessions.set(userId, { key: cred.session_key, expiry });
      return cred.session_key;
    }

    // Re-authenticate using saved password
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

  /**
   * Schedules an ETM request with global rate limiting (1 req / 1.1 sec).
   * All ETM HTTP requests must go through this so we never exceed the per-IP limit
   * even when multiple users hit the API concurrently.
   */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.requestQueue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.lastRequestAt + this.MIN_INTERVAL_MS - now);
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      return fn();
    });
    // Don't break the chain on errors
    this.requestQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Fetch single article price.
   * Returns price (number) or null. Throws SESSION_EXPIRED on auth failure.
   */
  private async fetchSinglePrice(article: string, session: string): Promise<number | null> {
    const url =
      `https://${this.host}/api/v1/goods/${encodeURIComponent(article)}/price` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;
    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch {
      return null;
    }
    const code = json?.status?.code;
    const msg = String(json?.status?.message || '').toLowerCase();
    if (code === 401 || code === 403 || msg.includes('session') || msg.includes('auth') || msg.includes('unauthor')) {
      throw new Error('SESSION_EXPIRED');
    }
    if (code === 404) {
      this.logger.warn(`ETM ${article}: not found (code=404)`);
      return null;
    }
    if (code !== 200 || !json.data) {
      this.logger.warn(`ETM price miss for ${article}: code=${code} msg=${json?.status?.message || ''}`);
      return null;
    }
    const row = Array.isArray(json.data.rows) ? json.data.rows[0] : json.data;
    const p = row?.pricewnds ?? row?.price ?? 0;
    if (!(Number(p) > 0)) {
      // Per ETM docs: all 0 prices = "цена по запросу" (individual quote required)
      this.logger.warn(`ETM ${article}: price=0 — товар с индивидуальной ценой`);
    }
    return Number(p) > 0 ? Number(p) : null;
  }

  /**
   * Batch fetch prices — up to 50 articles in one request.
   * Returns map: article → price | null.
   * Throws 'SESSION_EXPIRED' if session is invalid.
   * If batch response row count doesn't match input → fallback to per-article fetch.
   */
  private async fetchPricesBatch(articles: string[], session: string): Promise<Record<string, number | null>> {
    const result: Record<string, number | null> = {};
    if (articles.length === 0) return result;

    // Single article — use direct endpoint
    if (articles.length === 1) {
      result[articles[0]] = await this.fetchSinglePrice(articles[0], session);
      return result;
    }

    // Use ETM batch syntax: comma-separated articles, type=mnf
    const ids = articles.map(a => encodeURIComponent(a)).join('%2C');
    const url =
      `https://${this.host}/api/v1/goods/${ids}/price` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;

    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch (e: any) {
      this.logger.warn(`ETM batch price error: ${e?.message}`);
      // Fallback: fetch each article individually
      for (const a of articles) {
        try { result[a] = await this.fetchSinglePrice(a, session); }
        catch (ex: any) { if (ex?.message === 'SESSION_EXPIRED') throw ex; result[a] = null; }
      }
      return result;
    }

    const code = json?.status?.code;
    const msg = String(json?.status?.message || '').toLowerCase();
    if (code === 401 || code === 403 || msg.includes('session') || msg.includes('auth') || msg.includes('unauthor')) {
      throw new Error('SESSION_EXPIRED');
    }

    if (code !== 200 || !json.data) {
      for (const a of articles) result[a] = null;
      return result;
    }

    const rows = Array.isArray(json.data.rows) ? json.data.rows : (json.data ? [json.data] : []);

    // If row count matches input — assume order preserved (most likely case)
    if (rows.length === articles.length) {
      for (let i = 0; i < articles.length; i++) {
        const row = rows[i];
        const p = row ? (row.pricewnds ?? row.price ?? 0) : 0;
        result[articles[i]] = Number(p) > 0 ? Number(p) : null;
      }
      return result;
    }

    // Row count mismatch — ETM may have skipped not-found articles or returned in different order.
    // Fall back to single-fetch for each article so we get reliable per-article results.
    this.logger.warn(`ETM batch row count mismatch: requested ${articles.length}, got ${rows.length}. Falling back to single fetches.`);
    for (const a of articles) {
      try { result[a] = await this.fetchSinglePrice(a, session); }
      catch (ex: any) { if (ex?.message === 'SESSION_EXPIRED') throw ex; result[a] = null; }
    }
    return result;
  }

  /** Parse one /remains response row into a delivery term string. */
  private parseRemainsRow(data: any): string | null {
    if (!data) return null;
    let hasStock = false;
    if (Array.isArray(data.InfoStores)) {
      for (const s of data.InfoStores) {
        if (Number(s?.StoreQuantRem) > 0) { hasStock = true; break; }
      }
    }
    const dlv = data?.InforDeliveryTime || {};
    const fmt = (v: any): string => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      if (/дн|day/i.test(s)) return s.replace(/\s+/g, ' ').trim();
      return `${s} дн`;
    };
    if (hasStock && dlv.DeliveryTimeInPres) return fmt(dlv.DeliveryTimeInPres);
    if (dlv.DeliveryProductionTerm) return fmt(dlv.DeliveryProductionTerm);
    if (dlv.DeliveryTimeInPres) return fmt(dlv.DeliveryTimeInPres);
    return null;
  }

  /**
   * Batch fetch delivery terms for up to 50 articles in one request.
   * Returns map: article → term | null. Falls back to single fetches on error/mismatch.
   * Throws 'SESSION_EXPIRED' on auth failure.
   */
  private async fetchRemainsBatch(articles: string[], session: string): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    if (articles.length === 0) return result;
    if (articles.length === 1) {
      result[articles[0]] = await this.fetchRemains(articles[0], session);
      return result;
    }

    const ids = articles.map(a => encodeURIComponent(a)).join('%2C');
    const url =
      `https://${this.host}/api/v1/goods/${ids}/remains` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;

    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch (e: any) {
      this.logger.warn(`ETM remains batch error: ${e?.message}. Falling back to single fetches.`);
      for (const a of articles) {
        try { result[a] = await this.fetchRemains(a, session); }
        catch (ex: any) { if (ex?.message === 'SESSION_EXPIRED') throw ex; result[a] = null; }
      }
      return result;
    }

    const code = json?.status?.code;
    const msg = String(json?.status?.message || '').toLowerCase();
    if (code === 401 || code === 403 || msg.includes('session') || msg.includes('auth') || msg.includes('unauthor')) {
      throw new Error('SESSION_EXPIRED');
    }
    if (code !== 200 || !json.data) {
      for (const a of articles) result[a] = null;
      return result;
    }

    const rows = Array.isArray(json.data.rows) ? json.data.rows : (json.data ? [json.data] : []);
    if (rows.length === articles.length) {
      for (let i = 0; i < articles.length; i++) {
        result[articles[i]] = this.parseRemainsRow(rows[i]);
      }
      return result;
    }

    // Row count mismatch — fall back to single fetches
    this.logger.warn(`ETM remains batch row count mismatch: requested ${articles.length}, got ${rows.length}. Falling back.`);
    for (const a of articles) {
      try { result[a] = await this.fetchRemains(a, session); }
      catch (ex: any) { if (ex?.message === 'SESSION_EXPIRED') throw ex; result[a] = null; }
    }
    return result;
  }

  /**
   * Fetch delivery term for a single article from /remains.
   * Returns: { term: string | null }.
   * Throws 'SESSION_EXPIRED' if invalid session.
   */
  private async fetchRemains(article: string, session: string): Promise<string | null> {
    const url =
      `https://${this.host}/api/v1/goods/${encodeURIComponent(article)}/remains` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;

    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch (e: any) {
      this.logger.warn(`ETM remains error for ${article}: ${e?.message}`);
      return null;
    }

    const code = json?.status?.code;
    const msg = String(json?.status?.message || '').toLowerCase();
    if (code === 401 || code === 403 || msg.includes('session') || msg.includes('auth') || msg.includes('unauthor')) {
      throw new Error('SESSION_EXPIRED');
    }
    if (code !== 200 || !json.data) return null;
    return this.parseRemainsRow(json.data);
  }

  /**
   * Public: get price + delivery term for a list of articles for a specific user.
   * Uses cache (7 days) to avoid hitting ETM API repeatedly.
   * Falls back to "нет" for term if not found.
   */
  /**
   * Fetch fresh prices (no cache — each user has a personal quote in ETM).
   * Returns map: article → price (number) or null.
   */
  async getPricesForUser(articles: string[], userId: number): Promise<Record<string, number | null>> {
    const unique = [...new Set(articles.filter(a => a && a.trim()))];
    const result: Record<string, number | null> = {};
    if (unique.length === 0) return result;

    let session = await this.getUserSession(userId, false);
    if (!session) {
      for (const a of unique) result[a] = null;
      return result;
    }

    let sessionRefreshed = false;
    for (let i = 0; i < unique.length; i += 50) {
      const slice = unique.slice(i, i + 50);
      try {
        const prices = await this.fetchPricesBatch(slice, session);
        Object.assign(result, prices);
      } catch (e: any) {
        if (e?.message === 'SESSION_EXPIRED' && !sessionRefreshed) {
          const newSession = await this.getUserSession(userId, true);
          if (newSession) { session = newSession; sessionRefreshed = true; i -= 50; continue; }
        }
        for (const a of slice) result[a] = null;
      }
    }
    return result;
  }

  /**
   * Fetch fresh delivery term for a single article (no cache).
   * Returns term string or null.
   */
  async getTermForUser(article: string, userId: number): Promise<string | null> {
    if (!article?.trim()) return null;
    let session = await this.getUserSession(userId, false);
    if (!session) return null;

    try {
      return await this.fetchRemains(article, session);
    } catch (e: any) {
      if (e?.message === 'SESSION_EXPIRED') {
        const newSession = await this.getUserSession(userId, true);
        if (newSession) {
          try { return await this.fetchRemains(article, newSession); } catch { return null; }
        }
      }
      return null;
    }
  }

  /**
   * Legacy combined endpoint kept for backward compatibility (catalog add-to-sheet, etc.)
   * Fetches prices + terms without any caching. Prefer split endpoints for new UX.
   */
  async getPricesAndTermsForUser(
    articles: string[],
    userId: number,
    _options: { skipCache?: boolean } = {},
  ): Promise<Record<string, { price: number | null; term: string }>> {
    const unique = [...new Set(articles.filter(a => a && a.trim()))];
    const result: Record<string, { price: number | null; term: string }> = {};
    if (unique.length === 0) return result;

    const prices = await this.getPricesForUser(unique, userId);
    for (const a of unique) {
      if (prices[a] == null) {
        result[a] = { price: null, term: 'нет' };
        continue;
      }
      const term = await this.getTermForUser(a, userId);
      result[a] = { price: prices[a], term: term || 'нет' };
    }
    return result;
  }

  // ── Legacy single-fetch methods (kept for backward compat) ────
  private async fetchPrice(article: string, session: string): Promise<number | null> {
    const batch = await this.fetchPricesBatch([article], session);
    return batch[article];
  }

  async getPrices(
    articles: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<string, number | null>> {
    const unique = [...new Set(articles.filter((a) => a && a.trim()))];
    const results: Record<string, number | null> = {};
    if (unique.length === 0) return results;

    const session = await this.getSession();

    // Batch in groups of 50
    for (let i = 0; i < unique.length; i += 50) {
      const slice = unique.slice(i, i + 50);
      try {
        const batch = await this.fetchPricesBatch(slice, session);
        Object.assign(results, batch);
      } catch {
        for (const a of slice) results[a] = null;
      }
      onProgress?.(Math.min(i + 50, unique.length), unique.length);
    }

    this.logger.log(
      `ETM prices fetched: ${unique.length} articles, ` +
        `${Object.values(results).filter((v) => v !== null).length} found`,
    );
    return results;
  }
}
