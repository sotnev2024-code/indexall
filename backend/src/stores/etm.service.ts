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
  /** Prevents parallel login calls: if one authenticate() is in flight,
   *  all other callers await the same promise instead of firing new logins. */
  private loginInFlight: Promise<string> | null = null;
  /** Set to true after we've tried to restore the session from DB on startup */
  private sessionRestored = false;
  /** Special user_id used to persist the global (env-based) system session in etm_credentials */
  private static readonly SYSTEM_SESSION_USER_ID = 0;

  private readonly host = 'ipro.etm.ru';

  private get login() { return process.env.ETM_LOGIN; }
  private get pwd() { return process.env.ETM_PASSWORD; }

  private readonly cookieJar = '/tmp/etm_cookies.txt';

  private readonly ENCRYPTION_KEY: Buffer;
  private readonly userSessions = new Map<number, { key: string; expiry: number }>();
  /** Per-user login serialization: prevents parallel login calls for the same userId */
  private readonly userLoginInFlight = new Map<number, Promise<string | null>>();

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

  /**
   * Admin-only diagnostic: fetch ETM /price and /remains and return a
   * compact shape with the three values the UI cares about: личная цена
   * (pricewnds), ритейл цена (price_retail), дата (delivery term as the
   * platform would resolve it via parseRemainsRow). Bypasses cache and our
   * pickPrice fallbacks — straight passthrough so the admin can compare
   * with what gets stored in the spec.
   */
  async getAdminDebugInfo(article: string | null, etmCode: string | null) {
    const cleanArticle = (article || '').trim();
    const cleanEtm = (etmCode || '').trim();
    if (!cleanArticle && !cleanEtm) return { error: 'No article or etm_code on this product' };

    if (!this.login || !this.pwd) {
      return { error: 'ETM_LOGIN/ETM_PASSWORD not set in .env' };
    }

    let session: string;
    try {
      session = await this.getSession();
    } catch (e: any) {
      return { error: `ETM login failed: ${e?.message}` };
    }

    // Admin debug keeps the legacy "either/or" diagnostic flexibility:
    //  · article present → type=mnf (with optional mnf= disambiguator)
    //  · only etmCode    → type=etm with etmCode in path (debug-only path,
    //                      lets the admin see what ETM stores under that
    //                      identifier even when no article is known)
    let priceUrl: string, remainsUrl: string, codeType: 'mnf' | 'etm', codeUsed: string;
    if (cleanArticle) {
      codeType = 'mnf';
      codeUsed = cleanArticle;
      const mnfSuffix = cleanEtm ? `&mnf=${encodeURIComponent(cleanEtm)}` : '';
      priceUrl = `https://${this.host}/api/v1/goods/${encodeURIComponent(cleanArticle)}/price?type=mnf&sessionid=${encodeURIComponent(session)}${mnfSuffix}`;
      remainsUrl = `https://${this.host}/api/v1/goods/${encodeURIComponent(cleanArticle)}/remains?type=mnf&sessionid=${encodeURIComponent(session)}${mnfSuffix}`;
    } else {
      codeType = 'etm';
      codeUsed = cleanEtm;
      priceUrl = `https://${this.host}/api/v1/goods/${encodeURIComponent(cleanEtm)}/price?type=etm&sessionid=${encodeURIComponent(session)}`;
      remainsUrl = `https://${this.host}/api/v1/goods/${encodeURIComponent(cleanEtm)}/remains?type=etm&sessionid=${encodeURIComponent(session)}`;
    }

    const [priceRaw, remainsRaw] = await Promise.all([
      this.enqueue(() => this.curlRequest(priceUrl, 'GET')).catch((e: any) => ({ error: e?.message })),
      this.enqueue(() => this.curlRequest(remainsUrl, 'GET')).catch((e: any) => ({ error: e?.message })),
    ]);

    // Extract the three numbers the UI shows. Same priority order
    // (personal → retail) we use for the user-facing «Цена ЭТМ» field.
    const priceRow = Array.isArray(priceRaw?.data?.rows) ? priceRaw.data.rows[0] : priceRaw?.data;
    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const personal = num(priceRow?.pricewnds);
    const retail = num(priceRow?.price_retail);
    const date = this.parseRemainsRow(remainsRaw?.data) || null;

    const priceErr = priceRaw?.error || (priceRaw?.status?.code !== 200 ? priceRaw?.status?.message : null);
    const remainsErr = remainsRaw?.error || (remainsRaw?.status?.code !== 200 ? remainsRaw?.status?.message : null);

    return {
      request: {
        article: cleanArticle || null,
        etm_code: cleanEtm || null,
        codeUsed,
        codeType,
      },
      summary: {
        personal,
        retail,
        date,
        priceError: priceErr || null,
        remainsError: remainsErr || null,
      },
    };
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

    // Serialize per-user login to avoid parallel login calls hitting ETM rate limit
    const inFlight = this.userLoginInFlight.get(userId);
    if (inFlight && !forceRefresh) return inFlight;

    const loginPromise = this._doUserLogin(userId, forceRefresh).finally(() => {
      this.userLoginInFlight.delete(userId);
    });
    this.userLoginInFlight.set(userId, loginPromise);
    return loginPromise;
  }

  /**
   * Find any valid session for the given ETM login across all users (and the
   * system account). This allows multiple app users sharing the same ETM login
   * to reuse one session instead of each logging in separately — which would
   * quickly exhaust the 1-login-per-2-minutes ETM rate limit.
   */
  private async findSharedSessionByLogin(login: string): Promise<{ key: string; expiry: number } | null> {
    // Check system in-memory session first (fastest path)
    if (
      this.login === login &&
      this.sessionKey &&
      Date.now() < this.sessionExpiry
    ) {
      return { key: this.sessionKey, expiry: this.sessionExpiry };
    }

    // Search all credential records (including system record user_id=0) for a valid session
    const rows = await this.credRepo.find({ where: { login } });
    const now = new Date();
    for (const row of rows) {
      if (row.session_key && row.session_expires_at && row.session_expires_at > now) {
        return { key: row.session_key, expiry: row.session_expires_at.getTime() };
      }
    }

    return null;
  }

  private async _doUserLogin(userId: number, forceRefresh: boolean): Promise<string | null> {
    // Load from DB
    const cred = await this.credRepo.findOne({ where: { user_id: userId } });
    if (!cred) return null;

    // Check this user's own DB session (skip if forcing refresh)
    if (!forceRefresh && cred.session_key && cred.session_expires_at && new Date() < cred.session_expires_at) {
      const expiry = cred.session_expires_at.getTime();
      this.userSessions.set(userId, { key: cred.session_key, expiry });
      return cred.session_key;
    }

    // Before doing a fresh login, check if any other user (or system account)
    // already has a valid session for the same ETM login. Reuse it to avoid
    // hitting the 1-login-per-2-minutes rate limit when multiple app users
    // share the same ETM credentials.
    if (!forceRefresh) {
      const shared = await this.findSharedSessionByLogin(cred.login);
      if (shared) {
        // Propagate to this user's record and in-memory cache
        await this.credRepo.update({ user_id: userId }, {
          session_key: shared.key,
          session_expires_at: new Date(shared.expiry),
        });
        this.userSessions.set(userId, shared);
        this.logger.log(`ETM session shared (login ${cred.login}) for user ${userId}`);
        return shared.key;
      }
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
    this.logger.log(`ETM session refreshed for user ${userId} (login ${cred.login})`);
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
      const parsed = JSON.parse(stdout || '{}');
      // Log non-200 ETM responses so we can tell apart "session expired",
      // "article not in catalog", "rate-limited" without ssh-ing into the box.
      const code = parsed?.status?.code;
      if (code !== undefined && code !== 200) {
        const safeUrl = url.replace(/sessionid=[^&]+/i, 'sessionid=***');
        this.logger.warn(
          `ETM non-200: code=${code} msg="${parsed?.status?.message || ''}" url=${safeUrl}`,
        );
      }
      return parsed;
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
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.sessionKey = String(json.data.session);
    this.sessionExpiry = Date.now() + 7.5 * 60 * 60 * 1000;
    this.logger.log('ETM session refreshed');

    // Persist session to DB so server restarts can reuse it without a new login
    try {
      const expiresAt = new Date(this.sessionExpiry);
      await this.credRepo.save({
        user_id: EtmService.SYSTEM_SESSION_USER_ID,
        login: this.login || '',
        password_enc: '',
        session_key: this.sessionKey,
        session_expires_at: expiresAt,
      });
    } catch (e: any) {
      this.logger.warn(`Could not persist ETM system session to DB: ${e?.message}`);
    }

    return this.sessionKey;
  }

  private async getSession(): Promise<string> {
    // On first call after server restart, try to restore the system session from DB.
    // This avoids a login request when the server restarts but the ETM session is still valid.
    if (!this.sessionRestored) {
      this.sessionRestored = true;
      try {
        const sys = await this.credRepo.findOne({
          where: { user_id: EtmService.SYSTEM_SESSION_USER_ID },
        });
        if (sys?.session_key && sys.session_expires_at && new Date() < sys.session_expires_at) {
          this.sessionKey = sys.session_key;
          this.sessionExpiry = sys.session_expires_at.getTime();
          this.logger.log('ETM system session restored from DB (no login needed)');
        }
      } catch (e: any) {
        this.logger.warn(`Could not restore ETM system session from DB: ${e?.message}`);
      }
    }

    if (this.sessionKey && Date.now() < this.sessionExpiry) {
      return this.sessionKey;
    }

    // Before doing a fresh login, check if any user credential record with the
    // same ETM login already has a valid session (session sharing across accounts).
    if (this.login) {
      const shared = await this.findSharedSessionByLogin(this.login);
      if (shared) {
        this.sessionKey = shared.key;
        this.sessionExpiry = shared.expiry;
        this.logger.log(`ETM system session reused from shared login (${this.login})`);
        return this.sessionKey;
      }
    }

    // Serialize login: if a login is already in progress, wait for it instead
    // of firing another one. Multiple concurrent callers hitting an expired session
    // would otherwise each call authenticate() → ETM rate-limits ("Превышен лимит").
    if (this.loginInFlight) {
      return this.loginInFlight;
    }
    this.loginInFlight = this.authenticate().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
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
   * Fetch single price by article (mnf code), with optional manufacturer
   * disambiguator (`mnf` query param = ETM's directory code for the brand).
   * Per ETM API spec /goods/{id}/price?type=mnf&mnf=<etm_code> — the mnf
   * param resolves the case where two manufacturers share the same article.
   *
   * `useRetail`: when true, return price_retail (для всех) instead of
   * pricewnds (личная цена авторизованного клиента ЭТМ).
   */
  private async fetchSinglePrice(article: string, session: string, mnfCode?: string, useRetail = false): Promise<number | null> {
    let url =
      `https://${this.host}/api/v1/goods/${encodeURIComponent(article)}/price` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;
    if (mnfCode && mnfCode.trim()) url += `&mnf=${encodeURIComponent(mnfCode.trim())}`;
    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch {
      return null;
    }
    const respCode = json?.status?.code;
    const msg = String(json?.status?.message || '').toLowerCase();
    if (respCode === 401 || respCode === 403 || msg.includes('session') || msg.includes('auth') || msg.includes('unauthor')) {
      throw new Error('SESSION_EXPIRED');
    }
    if (respCode === 404) {
      this.logger.warn(`ETM mnf=${article}${mnfCode ? ` (mnf=${mnfCode})` : ''}: not found (404)`);
      return null;
    }
    if (respCode !== 200 || !json.data) {
      this.logger.warn(`ETM price miss for mnf=${article}: respCode=${respCode} msg=${json?.status?.message || ''}`);
      return null;
    }
    const row = Array.isArray(json.data.rows) ? json.data.rows[0] : json.data;
    const p = this.pickPrice(row, useRetail);
    if (!(p > 0)) {
      this.logger.warn(
        `ETM mnf=${article}${mnfCode ? ` (mnf=${mnfCode})` : ''} (${useRetail ? 'retail' : 'personal'}): price=0 | returned fields: ` +
        `price=${row?.price ?? '-'} pricewnds=${row?.pricewnds ?? '-'} ` +
        `price_tarif=${row?.price_tarif ?? '-'} price_retail=${row?.price_retail ?? '-'}`,
      );
    }
    return p > 0 ? p : null;
  }

  /** Pick the most reasonable price from an ETM /price response row.
   *  - useRetail=true (юзер без интеграции): берём price_retail (цена для всех).
   *  - useRetail=false (есть интеграция): pricewnds (личная цена с НДС),
   *    fallback на price/price_retail если pricewnds==0/missing. */
  private pickPrice(row: any, useRetail = false): number {
    if (!row) return 0;
    const fields = useRetail
      ? ['price_retail', 'pricewnds', 'price']
      : ['pricewnds', 'price', 'price_retail'];
    for (const f of fields) {
      const v = Number(row[f]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  }

  /**
   * Batch fetch prices for items {article, mnf?}. The ETM batch endpoint
   * doesn't support per-item mnf disambiguator, so items WITH a mnf code
   * fall through to fetchSinglePrice (1 ETM call each); items WITHOUT
   * a mnf code use the comma-joined batch URL (1 call per 50).
   *
   * Returns map: article → price | null. Throws 'SESSION_EXPIRED' on auth.
   */
  private async fetchPricesBatch(
    items: { article: string; mnf?: string }[],
    session: string,
    useRetail = false,
  ): Promise<Record<string, number | null>> {
    const result: Record<string, number | null> = {};
    if (items.length === 0) return result;

    const withMnf = items.filter(it => it.mnf && it.mnf.trim());
    const noMnf = items.filter(it => !it.mnf || !it.mnf.trim());

    // Items with manufacturer disambiguator: one fetch per article.
    for (const it of withMnf) {
      try {
        result[it.article] = await this.fetchSinglePrice(it.article, session, it.mnf, useRetail);
      } catch (ex: any) {
        if (ex?.message === 'SESSION_EXPIRED') throw ex;
        result[it.article] = null;
      }
    }

    if (noMnf.length === 0) return result;

    // Single-article shortcut for the no-mnf bucket.
    if (noMnf.length === 1) {
      result[noMnf[0].article] = await this.fetchSinglePrice(noMnf[0].article, session, undefined, useRetail);
      return result;
    }

    // Comma-joined batch for mnf-less articles.
    const articles = noMnf.map(it => it.article);
    const ids = articles.map(a => encodeURIComponent(a)).join('%2C');
    const url =
      `https://${this.host}/api/v1/goods/${ids}/price` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;

    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch (e: any) {
      this.logger.warn(`ETM batch price error: ${e?.message}`);
      for (const a of articles) {
        try { result[a] = await this.fetchSinglePrice(a, session, undefined, useRetail); }
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
        const p = this.pickPrice(rows[i], useRetail);
        result[articles[i]] = p > 0 ? p : null;
      }
      return result;
    }

    this.logger.warn(`ETM batch row count mismatch: requested ${articles.length}, got ${rows.length}. Falling back to single fetches.`);
    for (const a of articles) {
      try { result[a] = await this.fetchSinglePrice(a, session, undefined, useRetail); }
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
   * Batch fetch delivery terms for items {article, mnf?}. Same split logic
   * as fetchPricesBatch — items with a mnf disambiguator go through
   * fetchRemains individually; items without mnf use the comma-joined batch.
   */
  private async fetchRemainsBatch(
    items: { article: string; mnf?: string }[],
    session: string,
  ): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    if (items.length === 0) return result;

    const withMnf = items.filter(it => it.mnf && it.mnf.trim());
    const noMnf = items.filter(it => !it.mnf || !it.mnf.trim());

    for (const it of withMnf) {
      try {
        result[it.article] = await this.fetchRemains(it.article, session, it.mnf);
      } catch (ex: any) {
        if (ex?.message === 'SESSION_EXPIRED') throw ex;
        result[it.article] = null;
      }
    }

    if (noMnf.length === 0) return result;
    if (noMnf.length === 1) {
      result[noMnf[0].article] = await this.fetchRemains(noMnf[0].article, session);
      return result;
    }

    const articles = noMnf.map(it => it.article);
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

    this.logger.warn(`ETM remains batch row count mismatch: requested ${articles.length}, got ${rows.length}. Falling back.`);
    for (const a of articles) {
      try { result[a] = await this.fetchRemains(a, session); }
      catch (ex: any) { if (ex?.message === 'SESSION_EXPIRED') throw ex; result[a] = null; }
    }
    return result;
  }

  /**
   * Fetch delivery term for a single article from /remains.
   * `mnfCode` is the optional manufacturer disambiguator (ETM directory code).
   */
  private async fetchRemains(article: string, session: string, mnfCode?: string): Promise<string | null> {
    let url =
      `https://${this.host}/api/v1/goods/${encodeURIComponent(article)}/remains` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;
    if (mnfCode && mnfCode.trim()) url += `&mnf=${encodeURIComponent(mnfCode.trim())}`;

    let json: any;
    try {
      json = await this.enqueue(() => this.curlRequest(url, 'GET'));
    } catch (e: any) {
      this.logger.warn(`ETM remains error for mnf=${article}: ${e?.message}`);
      return null;
    }

    const respCode = json?.status?.code;
    const msg = String(json?.status?.message || '').toLowerCase();
    if (respCode === 401 || respCode === 403 || msg.includes('session') || msg.includes('auth') || msg.includes('unauthor')) {
      throw new Error('SESSION_EXPIRED');
    }
    if (respCode !== 200 || !json.data) return null;
    return this.parseRemainsRow(json.data);
  }

  /**
   * Public: get price + delivery term for a list of articles for a specific user.
   * Uses cache (7 days) to avoid hitting ETM API repeatedly.
   * Falls back to "нет" for term if not found.
   */
  /**
   * Fetch fresh prices for a list of items.
   * Each item can have either `article` (used with type=mnf) or `etmCode` (used with type=etm).
   * Returns map keyed by ARTICLE (the user-visible identifier), so callers can join back to rows.
   * If only etmCode is set, the ETM code itself is used as the key.
   */
  async getPricesForItems(
    items: { article?: string; etmCode?: string }[],
    userId: number,
  ): Promise<Record<string, number | null>> {
    const result: Record<string, number | null> = {};
    if (!items.length) return result;

    // Two flows:
    //  1. User configured ETM integration → use their session + return pricewnds
    //     (личная цена авторизованного клиента ЭТМ).
    //  2. No integration → fall back to the shared env-level account and return
    //     price_retail (цена для всех).
    let session = await this.getUserSession(userId, false);
    let useRetail = false;
    if (!session) {
      try {
        session = await this.getSession();
        useRetail = true;
      } catch (e: any) {
        this.logger.warn(`ETM: no per-user creds and shared session unavailable: ${e?.message}`);
        for (const it of items) {
          const key = (it.article || '').trim();
          if (key) result[key] = null;
        }
        return result;
      }
    }

    // Per ETM API spec: lookup is always by article (type=mnf). The stored
    // `etmCode` is the manufacturer's directory code in ETM's catalog and
    // belongs in the optional `mnf` query param as a disambiguator. Items
    // without an article cannot be priced via this endpoint at all — skip them.
    const byArticle = new Map<string, { article: string; mnf?: string }>();
    for (const it of items) {
      const article = (it.article || '').trim();
      if (!article) continue;
      if (byArticle.has(article)) continue;
      const mnf = (it.etmCode || '').trim() || undefined;
      byArticle.set(article, { article, mnf });
    }

    const allItems = Array.from(byArticle.values());
    let sessionRefreshed = false;
    for (let i = 0; i < allItems.length; i += 50) {
      const slice = allItems.slice(i, i + 50);
      try {
        const prices = await this.fetchPricesBatch(slice, session, useRetail);
        for (const g of slice) result[g.article] = prices[g.article] ?? null;
      } catch (e: any) {
        if (e?.message === 'SESSION_EXPIRED' && !sessionRefreshed) {
          const ns = useRetail ? await this.authenticate() : await this.getUserSession(userId, true);
          if (ns) { session = ns; sessionRefreshed = true; i -= 50; continue; }
        }
        for (const g of slice) result[g.article] = null;
      }
    }

    return result;
  }

  /**
   * Legacy: prices by article only (uses type=mnf for everything).
   * New code should use getPricesForItems for ETM-code support.
   */
  async getPricesForUser(articles: string[], userId: number): Promise<Record<string, number | null>> {
    return this.getPricesForItems(articles.map(a => ({ article: a })), userId);
  }

  /**
   * Fetch fresh delivery term for a single item. ETM lookup is keyed on
   * article (type=mnf); etmCode (manufacturer directory code) goes into
   * the optional mnf disambiguator. Items without an article are skipped.
   */
  async getTermForItem(item: { article?: string; etmCode?: string }, userId: number): Promise<string | null> {
    const article = (item.article || '').trim();
    if (!article) return null;
    const mnf = (item.etmCode || '').trim() || undefined;

    // Only fetch delivery term for users with their own ETM credentials.
    // The shared system account is used for prices only — fetching terms for
    // every article on the shared session doubles ETM load and hits rate limits.
    const session = await this.getUserSession(userId, false);
    if (!session) return null;

    try {
      return await this.fetchRemains(article, session, mnf);
    } catch (e: any) {
      if (e?.message === 'SESSION_EXPIRED') {
        const newSession = await this.getUserSession(userId, true);
        if (newSession) {
          try { return await this.fetchRemains(article, newSession, mnf); } catch { return null; }
        }
      }
      return null;
    }
  }

  /** Legacy: term by article only. New code should use getTermForItem. */
  async getTermForUser(article: string, userId: number): Promise<string | null> {
    return this.getTermForItem({ article }, userId);
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

    // Only request delivery terms when the user has their own ETM credentials.
    // On the shared system account, term requests double the API load and hit rate limits.
    const hasPersonalCreds = !!(await this.getUserSession(userId, false));

    for (const a of unique) {
      if (prices[a] == null) {
        result[a] = { price: null, term: 'нет' };
        continue;
      }
      const term = hasPersonalCreds ? await this.getTermForUser(a, userId) : null;
      result[a] = { price: prices[a], term: term || 'нет' };
    }
    return result;
  }

  // ── Legacy single-fetch methods (kept for backward compat) ────
  private async fetchPrice(article: string, session: string): Promise<number | null> {
    const batch = await this.fetchPricesBatch([{ article }], session);
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
        const batch = await this.fetchPricesBatch(slice.map(a => ({ article: a })), session);
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
