import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class EtmService {
  private readonly logger = new Logger(EtmService.name);

  // In-memory session (survives for 8h; resets on server restart → re-auth automatic)
  private sessionKey: string | null = null;
  private sessionExpiry = 0;

  // ── Credentials ───────────────────────────────────────────────
  private get login() { return process.env.ETM_LOGIN; }
  private get pwd()   { return process.env.ETM_PASSWORD; }

  isConfigured(): boolean {
    return !!(this.login && this.pwd);
  }

  // ── Session management ────────────────────────────────────────
  private async authenticate(): Promise<string> {
    if (!this.login || !this.pwd) {
      throw new HttpException(
        'ETM credentials not configured. Set ETM_LOGIN and ETM_PASSWORD in .env',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const url =
      `https://ipro.etm.ru/api/v1/user/login` +
      `?log=${encodeURIComponent(this.login)}` +
      `&pwd=${encodeURIComponent(this.pwd)}`;

    let json: any;
    try {
      const res = await fetch(url, { method: 'POST' });
      json = await res.json();
    } catch (e) {
      throw new HttpException(`ETM login network error: ${e}`, HttpStatus.BAD_GATEWAY);
    }

    if (json?.status?.code !== 200) {
      throw new HttpException(
        `ETM login failed: ${json?.status?.message || 'unknown error'}`,
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.sessionKey = String(json.data.session);
    // Use 7.5h so we re-auth 30min before expiry
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

  // ── Helpers ───────────────────────────────────────────────────
  private sleep(ms: number) {
    return new Promise<void>(r => setTimeout(r, ms));
  }

  // ── Price fetch for a single article ─────────────────────────
  private async fetchPrice(article: string, session: string): Promise<number | null> {
    const url =
      `https://ipro.etm.ru/api/v1/goods/${encodeURIComponent(article)}/price` +
      `?type=mnf&sessionid=${session}`;

    let json: any;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      json = await res.json();
    } catch {
      return null;
    }

    if (json?.status?.code !== 200 || !json.data) return null;

    // Prefer price с НДС (pricewnds), fall back to price без НДС
    const p = json.data.pricewnds ?? json.data.price ?? 0;
    return Number(p) > 0 ? Number(p) : null;
  }

  // ── Public: get prices for a list of articles ─────────────────
  // Returns { article: price | null }
  // Rate-limited to 1 request / 1.1s as per ETM requirements
  async getPrices(
    articles: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Record<string, number | null>> {
    const unique = [...new Set(articles.filter(a => a && a.trim()))];
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

      // 1.1s delay between requests (rate limit 1 req/sec)
      if (i < unique.length - 1) {
        await this.sleep(1100);
      }
    }

    this.logger.log(
      `ETM prices fetched: ${unique.length} articles, ` +
      `${Object.values(results).filter(v => v !== null).length} found`,
    );

    return results;
  }
}
