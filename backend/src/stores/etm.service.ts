import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import * as https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * ETM iPRO API — Node https (not fetch).
 * Если с VPS до ipro.etm.ru обрывается соединение (socket hang up), задайте ETM_HTTPS_PROXY.
 */
@Injectable()
export class EtmService {
  private readonly logger = new Logger(EtmService.name);

  private sessionKey: string | null = null;
  private sessionExpiry = 0;

  private readonly host = 'ipro.etm.ru';

  /** One connection at a time, no keep-alive — reduces «socket hang up» from picky servers */
  private readonly httpsAgent = new https.Agent({
    keepAlive: false,
    maxSockets: 1,
    maxFreeSockets: 0,
  });

  private proxyAgent: HttpsProxyAgent<string> | null = null;

  private getOutboundAgent(): https.Agent {
    const proxyUrl = process.env.ETM_HTTPS_PROXY?.trim();
    if (proxyUrl) {
      if (!this.proxyAgent) {
        this.proxyAgent = new HttpsProxyAgent(proxyUrl);
        this.logger.warn('ETM: outbound traffic uses ETM_HTTPS_PROXY');
      }
      return this.proxyAgent;
    }
    return this.httpsAgent;
  }

  private useDirectSocketOpts(): boolean {
    return !process.env.ETM_HTTPS_PROXY?.trim();
  }

  private get login() { return process.env.ETM_LOGIN; }
  private get pwd() { return process.env.ETM_PASSWORD; }

  isConfigured(): boolean {
    return !!(this.login && this.pwd);
  }

  private etmRequest(method: 'GET' | 'POST', pathWithLeadingSlash: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; INDEXALL-Backend/1.0)',
        Connection: 'close',
        Host: this.host,
      };
      if (method === 'POST') {
        headers['Content-Length'] = '0';
      }

      const direct = this.useDirectSocketOpts();
      const options: https.RequestOptions = {
        hostname: this.host,
        port: 443,
        path: pathWithLeadingSlash,
        method,
        agent: this.getOutboundAgent(),
        servername: this.host,
        ...(direct ? { family: 4 as const } : {}),
        // Только TLS 1.2 — у части API ЭТМ/прокси TLS 1.3 даёт обрыв (socket hang up)
        minVersion: 'TLSv1.2' as const,
        maxVersion: 'TLSv1.2' as const,
        timeout: 90_000,
        headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('aborted', () => reject(new Error('ETM response aborted')));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data || '{}'));
          } catch {
            reject(new Error(`Invalid JSON from ETM (HTTP ${res.statusCode})`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ETM request timeout'));
      });
      req.end();
    });
  }

  private async authenticate(): Promise<string> {
    if (!this.login || !this.pwd) {
      throw new HttpException(
        'ETM credentials not configured. Set ETM_LOGIN and ETM_PASSWORD in .env',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const path =
      `/api/v1/user/login?log=${encodeURIComponent(this.login)}&pwd=${encodeURIComponent(this.pwd)}`;

    let json: any;
    try {
      json = await this.etmRequest('POST', path);
    } catch (e: any) {
      let msg = e?.message || String(e);
      this.logger.error(`ETM login network error: ${msg}`);
      if (/hang up|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(msg) && !process.env.ETM_HTTPS_PROXY?.trim()) {
        msg +=
          ' Прямой доступ с сервера до ipro.etm.ru недоступен — задайте в .env ETM_HTTPS_PROXY (HTTP-прокси с методом CONNECT).';
      }
      throw new HttpException(`ETM login network error: ${msg}`, HttpStatus.BAD_GATEWAY);
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
    const path =
      `/api/v1/goods/${encodeURIComponent(article)}/price` +
      `?type=mnf&sessionid=${encodeURIComponent(session)}`;

    let json: any;
    try {
      json = await this.etmRequest('GET', path);
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
