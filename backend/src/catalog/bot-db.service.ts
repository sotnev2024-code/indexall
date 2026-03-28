import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface BotProduct {
  id: number;
  name: string;
  article: string;
  price: number | null;
  manufacturer: { name: string } | null;
  is_active: boolean;
  category_id: number;
}

// Slug → SQLite table name (only 4 TZ categories)
const SLUG_TABLE: Record<string, string> = {
  auto:    'products',
  mold:    'molded_breakers',
  difauto: 'avdt',
  box_mod: 'enclosures',
};

// For each table: filter label → SQLite column name
// opts are NOT stored here — they are computed dynamically from DISTINCT DB values
const FILTER_COLUMNS: Record<string, Record<string, string>> = {
  products: {
    'Производитель':      'proizvoditel',
    'Ток, А':             'nominalnyy_tok',
    'Число полюсов':      'kolichestvo_polyusov',
    'Характеристика':     'krivaya_otklyucheniya',
    'Откл. способность':  'otklyuchayushchaya_sposobnost',
  },
  molded_breakers: {
    'Производитель':      'proizvoditel',
    'Ток, А':             'nominalnyy_tok',
    'Число полюсов':      'kolichestvo_polyusov',
    'Откл. способность':  'otklyuchayushchaya_sposobnost_icu',
    'Тип расцепителя':    'rascepitel',
  },
  avdt: {
    'Производитель':      'proizvoditel',
    'Ток, А':             'nominalnyy_tok',
    'Число полюсов':      'kolichestvo_polyusov',
    'Характеристика':     'krivaya_otklyucheniya',
    'Ток утечки':         'tok_utechki',
    'Откл. способность':  'otklyuchayushchaya_sposobnost',
    'Тип AC/A':           'tip_rascepitelya',
  },
  enclosures: {
    'Производитель':      'proizvoditel',
    'Материал корпуса':   'material_korpusa',
    'Степень защиты':     'ispolnenie_ip',
    'Цвет':               'tsvet',
    'Высота, мм':         'vysota',
    'Ширина, мм':         'shirina',
    'Глубина, мм':        'glubina',
  },
};

@Injectable()
export class BotDbService implements OnModuleInit {
  private readonly logger = new Logger(BotDbService.name);

  // product rows per slug
  private productCache = new Map<string, any[]>();
  // dynamic filter options per slug: { label → sorted distinct values[] }
  private filterCache = new Map<string, Record<string, string[]>>();

  private dbPath: string | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  onModuleInit() {
    const envPath = process.env.BOT_DB_PATH;
    if (!envPath) {
      this.logger.log('BOT_DB_PATH not set — bot catalog disabled, using PostgreSQL fallback');
      return;
    }
    const resolved = path.resolve(envPath);
    if (!fs.existsSync(resolved)) {
      this.logger.warn(`BOT_DB_PATH points to missing file: ${resolved}`);
      return;
    }
    this.dbPath = resolved;
    this.loadCache();
    // Refresh every hour — bot updates DB at 03:00, picked up by 04:00
    this.refreshTimer = setInterval(() => this.loadCache(), 60 * 60 * 1000);
  }

  get isAvailable(): boolean {
    return this.dbPath !== null && this.productCache.size > 0;
  }

  /** Force refresh — callable via admin endpoint after bot update */
  refresh() {
    if (this.dbPath) this.loadCache();
  }

  /**
   * Returns dynamic filter options for a slug.
   * Options are recomputed from DISTINCT DB values on every cache refresh.
   */
  getFilterOptions(slug: string): { label: string; opts: string[] }[] {
    const table = SLUG_TABLE[slug];
    if (!table) return [];
    const colMap = FILTER_COLUMNS[table] ?? {};
    const filterData = this.filterCache.get(slug) ?? {};
    return Object.keys(colMap).map(label => ({
      label,
      opts: filterData[label] ?? [],
    }));
  }

  /**
   * Filter products from in-memory cache.
   * filters: Record<filterLabel, selectedValues[]>
   */
  getBySlug(slug: string, filters: Record<string, string[]> = {}): BotProduct[] {
    const table = SLUG_TABLE[slug];
    if (!table) return [];

    const rows: any[] = this.productCache.get(slug) ?? [];
    if (rows.length === 0) return [];

    const colMap = FILTER_COLUMNS[table] ?? {};

    const filtered = rows.filter(row => {
      for (const [label, values] of Object.entries(filters)) {
        if (!values.length) continue;
        const col = colMap[label];
        if (!col) continue;
        const cellVal = String(row[col] ?? '').trim();
        if (!values.some(v => cellVal.toLowerCase().includes(v.toLowerCase()))) {
          return false;
        }
      }
      return true;
    });

    return filtered.map((row, idx) => this.normalize(row, idx));
  }

  private loadCache() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(this.dbPath, { readonly: true, fileMustExist: true });

      let totalProducts = 0;

      for (const [slug, table] of Object.entries(SLUG_TABLE)) {
        try {
          const rows = db.prepare(`SELECT * FROM ${table}`).all();
          this.productCache.set(slug, rows);
          totalProducts += rows.length;

          // Build dynamic filter options from DISTINCT values
          const colMap = FILTER_COLUMNS[table] ?? {};
          const filterOptions: Record<string, string[]> = {};
          for (const [label, col] of Object.entries(colMap)) {
            const vals = [
              ...new Set<string>(
                rows
                  .map((r: any) => String(r[col] ?? '').trim())
                  .filter(Boolean),
              ),
            ].sort((a: string, b: string) => {
              // Sort numerically if both values look like numbers (e.g. "16", "100")
              const na = parseFloat(a.replace(',', '.'));
              const nb = parseFloat(b.replace(',', '.'));
              if (!isNaN(na) && !isNaN(nb)) return na - nb;
              return a.localeCompare(b, 'ru');
            });
            filterOptions[label] = vals;
          }
          this.filterCache.set(slug, filterOptions);

          this.logger.log(`Loaded ${rows.length} rows from ${table} (${slug})`);
        } catch (e) {
          this.logger.warn(`Table ${table} not found or empty: ${e.message}`);
          this.productCache.set(slug, []);
          this.filterCache.set(slug, {});
        }
      }

      db.close();
      this.logger.log(`Bot DB cache refreshed — ${totalProducts} products total`);
    } catch (e) {
      this.logger.error(`Failed to load bot DB cache: ${e.message}`);
    }
  }

  private normalize(row: any, idx: number): BotProduct {
    const name = String(row.naimenovanie ?? row.name ?? '').trim();
    const article = String(row.artikul ?? '').trim();
    const manufName = String(row.proizvoditel ?? '').trim();

    let price: number | null = null;
    const rawPrice = row.bazovaya_cena ?? row.price ?? null;
    if (rawPrice) {
      const cleaned = String(rawPrice).replace(/[^\d,.]/g, '').replace(',', '.');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed)) price = parsed;
    }

    return {
      id: row.id ?? idx + 1,
      name,
      article,
      price,
      manufacturer: manufName ? { name: manufName } : null,
      is_active: true,
      category_id: 0,
    };
  }
}
