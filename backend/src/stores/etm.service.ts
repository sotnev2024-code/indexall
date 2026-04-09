import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

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

  isConfigured(): boolean {
    return !!(this.login && this.pwd);
  }

  private async curlRequest(url: string, method: 'GET' | 'POST' = 'GET'): Promise<any> {
    const args = [
      '-s',
      '--show-error',
      '--http1.1',
      '--max-time', '30',
      '-H', 'Accept: application/json',
      '-H', `Host: ${this.host}`,
    ];

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
      json = await this.curlRequest(url, 'POST');
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

    const p = json.data.pricewnds ?? json.data.price ?? 0;
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
