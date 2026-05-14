import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Manufacturer, PriceList, PriceListStatus, CatalogCategory, CatalogProduct, ProductAnalog, ProductAccessory, CatalogTile, TileProduct, AccessoryTable, AccessoryItem } from './entities/catalog.entities';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { BotDbService } from './bot-db.service';

export interface PriceListMapping {
  firstRow: number;
  g1: string; g2?: string; g3?: string; g4?: string; g5?: string; g6?: string;
  nameCol: string;
  artCol: string;
  priceCol?: string;
  etmCodeCol?: string;
  imageUrlCol?: string;
  externalUrlCol?: string;
}

// Only 4 categories per TZ — opts are loaded dynamically from bot_database.db
const DEFAULT_TILES = [
  { slug: 'auto', name: 'Модульные автоматические выключатели', icon: '⚡', is_large: true, sort_order: 0,
    filters: [
      { label: 'Производитель' },
      { label: 'Ток, А' },
      { label: 'Число полюсов' },
      { label: 'Характеристика' },
      { label: 'Откл. способность' },
    ]},
  { slug: 'mold', name: 'Автоматические выключатели в литом корпусе', icon: '🔲', is_large: false, sort_order: 1,
    filters: [
      { label: 'Производитель' },
      { label: 'Ток, А' },
      { label: 'Число полюсов' },
      { label: 'Откл. способность' },
      { label: 'Тип расцепителя' },
    ]},
  { slug: 'difauto', name: 'Автоматические выключатели дифф. тока', icon: '⚡', is_large: false, sort_order: 2,
    filters: [
      { label: 'Производитель' },
      { label: 'Ток, А' },
      { label: 'Число полюсов' },
      { label: 'Характеристика' },
      { label: 'Ток утечки' },
      { label: 'Откл. способность' },
      { label: 'Тип AC/A' },
    ]},
  { slug: 'box_mod', name: 'Корпуса модульные (ЩРн, ЩРв)', icon: '📦', is_large: false, sort_order: 3,
    filters: [
      { label: 'Производитель' },
      { label: 'Материал корпуса' },
      { label: 'Степень защиты' },
      { label: 'Цвет' },
      { label: 'Высота, мм' },
      { label: 'Ширина, мм' },
      { label: 'Глубина, мм' },
    ]},
];

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(
    @InjectRepository(Manufacturer) private manufRepo: Repository<Manufacturer>,
    @InjectRepository(PriceList) private plRepo: Repository<PriceList>,
    @InjectRepository(CatalogCategory) private catRepo: Repository<CatalogCategory>,
    @InjectRepository(CatalogProduct) private prodRepo: Repository<CatalogProduct>,
    @InjectRepository(ProductAnalog) private analogRepo: Repository<ProductAnalog>,
    @InjectRepository(ProductAccessory) private accessoryRepo: Repository<ProductAccessory>,
    @InjectRepository(CatalogTile) private tileRepo: Repository<CatalogTile>,
    @InjectRepository(TileProduct) private tileProductRepo: Repository<TileProduct>,
    @InjectRepository(AccessoryTable) private accTableRepo: Repository<AccessoryTable>,
    @InjectRepository(AccessoryItem) private accItemRepo: Repository<AccessoryItem>,
    private readonly botDb: BotDbService,
  ) {}

  async onModuleInit() {
    // Seed default tiles only if they don't exist yet (don't overwrite admin-uploaded data)
    for (const t of DEFAULT_TILES) {
      const existing = await this.tileRepo.findOne({ where: { slug: t.slug } });
      if (!existing) {
        await this.tileRepo.save({ ...t, is_active: true });
      }
    }

    // One-time migration: is_large=true → width=2, height=1 (for tiles created before width/height existed)
    try {
      await this.tileRepo.query(`UPDATE catalog_tiles SET width=2, height=1 WHERE is_large = true AND (width IS NULL OR width = 1) AND (height IS NULL OR height = 1)`);
    } catch { /* columns may not exist yet on first run; synchronize will create them */ }

    // Create GIN index on tile_products.attributes for fast JSONB filtering
    try {
      await this.tileProductRepo.query(
        `CREATE INDEX IF NOT EXISTS idx_tile_products_attrs_gin ON tile_products USING GIN (attributes)`,
      );
    } catch { /* index may already exist or table not yet synced */ }

    // Enable pg_trgm extension + create trigram indexes for fuzzy search
    try {
      await this.prodRepo.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await this.prodRepo.query(`CREATE INDEX IF NOT EXISTS idx_catalog_products_name_trgm ON catalog_products USING GIN (name gin_trgm_ops)`);
      await this.prodRepo.query(`CREATE INDEX IF NOT EXISTS idx_catalog_products_article_trgm ON catalog_products USING GIN (article gin_trgm_ops)`);
      await this.tileProductRepo.query(`CREATE INDEX IF NOT EXISTS idx_tile_products_name_trgm ON tile_products USING GIN (name gin_trgm_ops)`);
      await this.tileProductRepo.query(`CREATE INDEX IF NOT EXISTS idx_tile_products_article_trgm ON tile_products USING GIN (article gin_trgm_ops)`);
    } catch (e: any) {
      console.warn('pg_trgm setup:', e?.message);
    }
  }

  // ── Catalog Tiles ─────────────────────────────────────────
  async getTiles() {
    return this.tileRepo.find({ where: { is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } });
  }

  async getAllTiles() {
    return this.tileRepo.find({ order: { sort_order: 'ASC', id: 'ASC' } });
  }

  async getTileById(id: number) {
    return this.tileRepo.findOne({ where: { id } });
  }

  async createTile(data: Partial<CatalogTile>) {
    return this.tileRepo.save(data);
  }

  async updateTile(id: number, data: Partial<CatalogTile>) {
    await this.tileRepo.update(id, data);
    return this.tileRepo.findOne({ where: { id } });
  }

  async deleteTile(id: number) {
    const tile = await this.tileRepo.findOne({ where: { id } });
    if (!tile) throw new NotFoundException('Плитка не найдена');
    if (tile.image_path) {
      try { fs.unlinkSync(tile.image_path); } catch {}
    }
    await this.tileRepo.delete(id);
    return { success: true };
  }

  async uploadTileImage(id: number, file: Express.Multer.File) {
    const tile = await this.tileRepo.findOne({ where: { id } });
    if (!tile) throw new NotFoundException('Плитка не найдена');
    if (tile.image_path) {
      try { fs.unlinkSync(tile.image_path); } catch {}
    }
    await this.tileRepo.update(id, { image_path: file.path });
    return this.tileRepo.findOne({ where: { id } });
  }

  // ── Manufacturers ─────────────────────────────────────────
  async getManufacturers() {
    // Return manufacturers that have active price lists with categories OR products
    return this.manufRepo
      .createQueryBuilder('m')
      .innerJoin('price_lists', 'pl', 'pl.manufacturer_id = m.id AND pl.status = :st', { st: PriceListStatus.ACTIVE })
      .where('m.is_active = true')
      .andWhere(`(
        EXISTS (SELECT 1 FROM catalog_categories cc WHERE cc.price_list_id = pl.id)
        OR EXISTS (SELECT 1 FROM catalog_products cp WHERE cp.manufacturer_id = m.id AND cp.is_active = true)
      )`)
      .select(['m.id', 'm.name', 'm.is_active'])
      .distinct(true)
      .orderBy('m.name', 'ASC')
      .getMany();
  }

  async createManufacturer(name: string) {
    return this.manufRepo.save({ name, is_active: true });
  }

  async updateManufacturer(id: number, data: Partial<Manufacturer>) {
    await this.manufRepo.update(id, data);
    return this.manufRepo.findOne({ where: { id } });
  }

  // ── Price lists ───────────────────────────────────────────
  async getPriceLists() {
    return this.plRepo.find({
      where: { status: Not(PriceListStatus.ARCHIVE) },
      relations: ['manufacturer'],
      order: { uploaded_at: 'DESC' },
    });
  }

  async uploadPriceList(file: Express.Multer.File, mapping: PriceListMapping, uploadedBy: number) {
    const fixedName = this.fixFilenameEncoding(file.originalname);
    const displayName = this.parseDisplayName(fixedName);

    let manuf = await this.manufRepo.findOne({ where: { name: displayName } });
    if (!manuf) manuf = await this.manufRepo.save({ name: displayName, is_active: true });

    const pl = await this.plRepo.save({
      manufacturer_id: manuf.id,
      file_name: fixedName,
      file_path: file.path,
      status: PriceListStatus.PROCESSING,
      mapping,
      uploaded_by: uploadedBy,
    });

    this.parseXlsxAsync(pl.id, file.path, mapping, manuf.id).catch(console.error);

    return pl;
  }

  async deletePriceList(id: number) {
    const pl = await this.plRepo.findOne({ where: { id } });
    if (!pl) throw new NotFoundException('Прайс-лист не найден');

    const manufId = pl.manufacturer_id;

    // Delete products in categories of this price list
    const cats = await this.catRepo.find({ where: { price_list_id: id } });
    if (cats.length > 0) {
      const catIds = cats.map(c => c.id);
      await this.prodRepo.delete({ category_id: In(catIds) });
      await this.catRepo.delete({ price_list_id: id });
    }

    // Delete uncategorized products belonging to this manufacturer
    // (tree-format imports create products with category_id=NULL)
    if (manufId) {
      await this.prodRepo
        .createQueryBuilder()
        .delete()
        .where('manufacturer_id = :manufId', { manufId })
        .andWhere('category_id IS NULL')
        .execute();
    }

    if (pl.file_path) {
      try { fs.unlinkSync(pl.file_path); } catch { /* file may not exist */ }
    }

    await this.plRepo.delete(id);

    // If the manufacturer has no remaining price lists, delete it too
    if (manufId) {
      const remaining = await this.plRepo.count({ where: { manufacturer_id: manufId } });
      if (remaining === 0) {
        const remainingProducts = await this.prodRepo.count({ where: { manufacturer_id: manufId } });
        if (remainingProducts === 0) {
          await this.manufRepo.delete(manufId);
        }
      }
    }

    return { success: true };
  }

  async setPriceListStatus(id: number, active: boolean) {
    const pl = await this.plRepo.findOne({ where: { id } });
    if (!pl) throw new NotFoundException('Прайс-лист не найден');
    const newStatus = active ? PriceListStatus.ACTIVE : PriceListStatus.INACTIVE;
    await this.plRepo.update(id, { status: newStatus });
    const cats = await this.catRepo.find({ where: { price_list_id: id } });
    if (cats.length > 0) {
      const catIds = cats.map(c => c.id);
      await this.prodRepo
        .createQueryBuilder()
        .update()
        .set({ is_active: active })
        .where('category_id IN (:...catIds)', { catIds })
        .execute();
    }
    return this.plRepo.findOne({ where: { id }, relations: ['manufacturer'] });
  }

  async replacePriceList(id: number, file: Express.Multer.File, mapping: PriceListMapping, uploadedBy: number) {
    const old = await this.plRepo.findOne({ where: { id } });
    if (!old) throw new NotFoundException('Прайс-лист не найден');
    const manufId = old.manufacturer_id;

    // Delete all products belonging to old price list categories + uncategorized products
    // of this manufacturer, otherwise re-uploading the same file creates duplicate rows.
    const oldCats = await this.catRepo.find({ where: { price_list_id: id } });
    if (oldCats.length > 0) {
      const catIds = oldCats.map(c => c.id);
      await this.prodRepo.delete({ category_id: In(catIds) });
      await this.catRepo.delete({ price_list_id: id });
    }
    // Tree-format price lists store products with category_id=null — clean those too
    await this.prodRepo.createQueryBuilder()
      .delete()
      .where('manufacturer_id = :manufId', { manufId })
      .andWhere('category_id IS NULL')
      .execute();

    // Archive old record and create new one pointing to same manufacturer
    await this.plRepo.update(id, { status: PriceListStatus.ARCHIVE, archived_at: new Date() });
    const pl = await this.plRepo.save({
      manufacturer_id: manufId,
      file_name: this.fixFilenameEncoding(file.originalname),
      file_path: file.path,
      status: PriceListStatus.PROCESSING,
      mapping,
      uploaded_by: uploadedBy,
    });
    this.parseXlsxAsync(pl.id, file.path, mapping, manufId).catch(console.error);
    return pl;
  }

  // ── Catalog tree ──────────────────────────────────────────
  async getTree(manufacturerId?: number) {
    const activePls = await this.plRepo.find({ where: { status: PriceListStatus.ACTIVE } });
    const activePlIds = activePls.map(p => p.id);

    if (activePlIds.length === 0) return [];

    // Only fetch categories that have at least one product (directly or via children)
    const qb = this.catRepo.createQueryBuilder('c')
      .where('c.price_list_id IN (:...plIds)', { plIds: activePlIds })
      .andWhere(`(
        EXISTS (SELECT 1 FROM catalog_products p WHERE p.category_id = c.id AND p.is_active = true)
        OR EXISTS (SELECT 1 FROM catalog_categories ch WHERE ch.parent_id = c.id)
      )`)
      .orderBy('c.sort_order', 'ASC')
      .addOrderBy('c.name', 'ASC');

    if (manufacturerId) {
      qb.andWhere('c.manufacturer_id = :manufacturerId', { manufacturerId });
    }

    const categories = await qb.getMany();
    const tree = this.buildTree(categories, null);

    // If manufacturer has products without categories, add a virtual root node
    if (manufacturerId && tree.length === 0) {
      const uncategorized = await this.prodRepo.count({
        where: { manufacturer_id: manufacturerId, category_id: null as any, is_active: true },
      });
      if (uncategorized > 0) {
        tree.push({ id: -manufacturerId, name: 'Все товары', children: [], _uncategorized: true });
      }
    }

    return tree;
  }

  async getProducts(categoryId: number, attrs?: Record<string, string>) {
    const qb = this.prodRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manufacturer', 'm')
      .andWhere('p.is_active = true');

    if (categoryId < 0) {
      // Virtual node: uncategorized products for manufacturer (id = -manufacturerId)
      qb.where('p.manufacturer_id = :mId', { mId: -categoryId })
        .andWhere('p.category_id IS NULL')
        .andWhere('p.is_active = true');
    } else {
      qb.where('p.category_id = :categoryId', { categoryId });
    }

    if (attrs && Object.keys(attrs).length > 0) {
      Object.entries(attrs).forEach(([key, val]) => {
        qb.andWhere(`p.attributes->>'${key}' = :attr_${key}`, { [`attr_${key}`]: val });
      });
    }
    return qb.orderBy('p.name').limit(2000).getMany();
  }

  async getAnalogs(productId: number) {
    return this.analogRepo.find({
      where: { product_id: productId },
      relations: ['analog', 'analog.manufacturer'],
    });
  }

  async getAccessories(productId: number) {
    return this.accessoryRepo.find({
      where: { product_id: productId },
      relations: ['accessory', 'accessory.manufacturer'],
    });
  }

  async getPriceListFile(id: number): Promise<{ filePath: string; fileName: string }> {
    const pl = await this.plRepo.findOne({ where: { id } });
    if (!pl || !pl.file_path) throw new NotFoundException('Файл прайс-листа не найден');
    return { filePath: pl.file_path, fileName: pl.file_name };
  }

  async getProductsByCategorySlug(slug: string, brands?: string[], extraFilters?: Record<string, string[]>): Promise<any[]> {
    // Primary source: bot SQLite DB (structured parametric data, fast in-memory)
    if (this.botDb.isAvailable) {
      const filters: Record<string, string[]> = { ...(extraFilters ?? {}) };
      if (brands?.length) filters['Производитель'] = brands;
      return this.botDb.getBySlug(slug, filters);
    }

    // Fallback: keyword-matching in PostgreSQL (used when BOT_DB_PATH is not configured)
    // Keywords match against category names in the uploaded price lists.
    // Include: at least ONE must match. Exclude: NONE must match.
    const SLUG_KEYWORDS: Record<string, { include: string[]; exclude?: string[] }> = {
      auto:          { include: ['автоматическ', ' ав ', 'выключател'], exclude: ['силов', 'диф', 'узо', 'уст.защит', 'защитн.откл'] },
      mold:          { include: ['силов', 'литом корпус', 'в литом', 'ва '], exclude: ['модул'] },
      uzo:           { include: ['узо', 'уст.защит', 'устройств защит', 'защитн.откл', 'rcd'] },
      klemmy:        { include: ['клемм', 'зажим', 'клеммник'] },
      difauto:       { include: ['диф', 'авдт', 'адд', ' ад-', 'difauto', 'дифавт'] },
      contactors:    { include: ['контактор', 'пускател', 'магнитн'] },
      soft_starters: { include: ['плавного пуска', 'плавн.пуск', 'упп '] },
      freq_drives:   { include: ['частотн', 'преобразоват', 'вариатор', 'инвертор'] },
      motor_protect: { include: ['реле тепловое', 'тепловое реле', 'защита двигател', 'двигател'] },
      meters:        { include: ['счётчик', 'счетчик', 'учёт электр', 'учет электр'] },
      relays:        { include: ['реле ', 'таймер', 'реле времени', 'реле контрол'] },
      box_mod:       { include: ['корпус', 'щит', 'щрн', 'щрв', 'бокс'], exclude: ['монтаж'] },
      box_panel:     { include: ['монтаж', 'с монтаж', 'панел'] },
      cable_trays:   { include: ['лоток', 'кабельный короб', 'кабел.короб', 'лестничн'] },
      sockets:       { include: ['розетка пром', 'пром.розетка', 'силовая розетка', 'вилка силов'] },
    };

    const keywords = SLUG_KEYWORDS[slug];
    if (!keywords) return [];

    const activePls = await this.plRepo.find({ where: { status: PriceListStatus.ACTIVE } });
    const activePlIds = activePls.map(p => p.id);
    if (activePlIds.length === 0) return [];

    const catQb = this.catRepo.createQueryBuilder('c')
      .where('c.price_list_id IN (:...plIds)', { plIds: activePlIds });

    const includeParams: Record<string, string> = {};
    const includeConditions = keywords.include.map((kw, i) => {
      includeParams[`inc${i}`] = `%${kw.toLowerCase()}%`;
      return `LOWER(c.name) LIKE :inc${i}`;
    });
    catQb.andWhere(`(${includeConditions.join(' OR ')})`, includeParams);

    if (keywords.exclude?.length) {
      keywords.exclude.forEach((kw, i) => {
        catQb.andWhere(`LOWER(c.name) NOT LIKE :exc${i}`, { [`exc${i}`]: `%${kw.toLowerCase()}%` });
      });
    }

    const matchedCats = await catQb.getMany();
    if (matchedCats.length === 0) return [];

    const allActiveCats = await this.catRepo.find({ where: { price_list_id: In(activePlIds) } });
    const allCatIds = new Set(matchedCats.map(c => c.id));
    const addDescendants = (parentIds: number[]) => {
      const children = allActiveCats.filter(c => c.parent_id !== null && parentIds.includes(c.parent_id));
      if (children.length === 0) return;
      children.forEach(c => allCatIds.add(c.id));
      addDescendants(children.map(c => c.id));
    };
    addDescendants([...allCatIds]);

    const prodQb = this.prodRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manufacturer', 'm')
      .where('p.category_id IN (:...catIds)', { catIds: [...allCatIds] })
      .andWhere('p.is_active = true');

    if (brands?.length) {
      prodQb.andWhere('m.name IN (:...brands)', { brands });
    }

    return prodQb.orderBy('p.name').limit(2000).getMany();
  }

  /**
   * Smart search across both catalog_products (price lists) and tile_products.
   *
   * Algorithm (3-tier):
   *  1. Exact article match (= or starts with) — highest priority
   *  2. Full-text search with Russian morphology (to_tsquery)
   *  3. Fuzzy search via pg_trgm (similarity) — catches typos
   *
   * Results from all tiers are merged, deduplicated by article, and ranked.
   */
  /** Admin-only: return raw row from the chosen product table. */
  async getProductRowForAdmin(source: 'tile' | 'catalog', id: number): Promise<any> {
    if (source === 'tile') {
      const row = await this.tileProductRepo.findOne({ where: { id } });
      return row || null;
    }
    const row = await this.prodRepo.findOne({ where: { id }, relations: ['manufacturer'] });
    return row || null;
  }

  async searchProducts(q: string, limit = 100) {
    if (!q || q.trim().length < 2) return [];
    const ql = q.trim().toLowerCase();

    // Cached brand list — used to recognise tokens like "Алюр", "Кабэкс",
    // "IEK" inside the search query so we can boost rows that match the
    // brand and avoid surfacing other manufacturers' products.
    const allBrands = await this.manufRepo.find({ select: ['name'] }).catch(() => []);
    const brandSet = new Set(allBrands.map(b => b.name.trim().toLowerCase()));

    // ── Tokenize query ──────────────────────────────────────────
    // Strip parens/brackets that are noise for matching, keep digits/letters/-.
    const tokens = ql
      .split(/[\s,;]+/)
      .map(t => t.replace(/[()\[\]<>]/g, ''))
      .filter(t => t.length >= 2);

    let brandToken: string | null = null;
    const otherTokens: string[] = [];
    for (const t of tokens) {
      if (!brandToken && brandSet.has(t)) brandToken = t;
      else otherTokens.push(t);
    }

    // ── Search both product tables ──────────────────────────────
    const fromPriceLists = await this.searchInTable(
      'catalog_products', 'p', ql, otherTokens, brandToken, limit,
      (qb) => qb.leftJoinAndSelect('p.manufacturer', 'm').andWhere('p.is_active = true'),
    );
    const fromTilesRaw = await this.searchInTable(
      'tile_products', 'tp', ql, otherTokens, brandToken, limit,
    );

    // Normalize tile products to the same shape
    const fromTiles = fromTilesRaw.map((tp: any) => ({
      id: tp.id,
      name: tp.name,
      article: tp.article,
      price: tp.price,
      unit: tp.unit,
      attributes: tp.attributes,
      etm_code: tp.etm_code || null,
      image_url: tp.image_url || null,
      external_url: tp.external_url || null,
      manufacturer: tp.brand ? { name: tp.brand } : null,
      _source: 'tile' as const,
    }));

    // Merge + deduplicate by article
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const p of fromPriceLists) {
      const key = (p.article || '').toLowerCase();
      if (key) seen.add(key);
      merged.push(p);
    }
    for (const tp of fromTiles) {
      const key = (tp.article || '').toLowerCase();
      if (key && seen.has(key)) continue;
      merged.push(tp);
    }
    return merged.slice(0, limit);
  }

  /** Escape characters that have meaning in PostgreSQL POSIX regex. */
  private escapeRegex(s: string): string {
    return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }

  /**
   * Rank-based search within a single table.
   *
   * Score components per row:
   *   • +1000 — article exactly equals the full query
   *   • +500  — article starts with the full query
   *   • +200  — article exactly equals one of the query tokens
   *   • +100  — brand-token matches m.name (or tp.brand)
   *   • +30   — every "other" token matched as a word in the name
   *             (uses `\m<token>` regex so "провод" doesn't match "шинопровод")
   *   • +5×   — trigram similarity to the whole query (tiebreaker)
   *
   * A row is returned only if it scored at least once on a non-trivial signal —
   * pure trigram noise (similarity 0.05) does NOT qualify. This kills the case
   * where typing "Провод ПуГВнг..." returned шинопроводы.
   */
  private async searchInTable(
    table: string,
    alias: string,
    qFull: string,
    nameTokens: string[],
    brandToken: string | null,
    limit: number,
    customize?: (qb: any) => void,
  ): Promise<any[]> {
    const repo = table === 'tile_products' ? this.tileProductRepo : this.prodRepo;
    const brandColumn = table === 'tile_products' ? `${alias}.brand` : `m.name`;

    const params: Record<string, any> = { qFull, qPrefix: `${qFull}%` };
    const tokenScoreParts: string[] = [];
    const tokenWhereParts: string[] = [`LOWER(${alias}.article) = :qFull`, `LOWER(${alias}.article) LIKE :qPrefix`];

    nameTokens.forEach((t, i) => {
      const tokenLower = t.toLowerCase();
      const re = `\\m${this.escapeRegex(tokenLower)}`;
      params[`tok${i}`] = re;
      params[`tokExact${i}`] = tokenLower;
      // Each token: word-boundary match in name OR exact article.
      tokenScoreParts.push(`(CASE WHEN LOWER(${alias}.name) ~* :tok${i} THEN 30 ELSE 0 END)`);
      tokenScoreParts.push(`(CASE WHEN LOWER(${alias}.article) = :tokExact${i} THEN 200 ELSE 0 END)`);
      tokenWhereParts.push(`LOWER(${alias}.name) ~* :tok${i}`);
      tokenWhereParts.push(`LOWER(${alias}.article) = :tokExact${i}`);
    });

    if (brandToken) {
      params.brandTok = brandToken;
      tokenScoreParts.push(`(CASE WHEN LOWER(${brandColumn}) = :brandTok THEN 100 ELSE 0 END)`);
    }

    // Always add exact-article and prefix scores
    tokenScoreParts.push(`(CASE WHEN LOWER(${alias}.article) = :qFull THEN 1000 ELSE 0 END)`);
    tokenScoreParts.push(`(CASE WHEN LOWER(${alias}.article) LIKE :qPrefix THEN 500 ELSE 0 END)`);

    // Trigram similarity tiebreaker (small weight). Wrap in a try since
    // pg_trgm is optional.
    let withTrigram = true;
    let scoreExpr = tokenScoreParts.join(' + ');
    try {
      // Probe: this throws if pg_trgm is missing.
      await repo.manager.query(`SELECT similarity('a','a')`);
      scoreExpr += ` + (similarity(${alias}.name, :qFull) * 5)`;
    } catch {
      withTrigram = false;
    }

    const whereClause = tokenWhereParts.length > 0
      ? tokenWhereParts.join(' OR ')
      : `LOWER(${alias}.article) = :qFull OR LOWER(${alias}.article) LIKE :qPrefix`;

    let qb = repo.createQueryBuilder(alias)
      .addSelect(scoreExpr, 'rank_score')
      .where(`(${whereClause})`, params)
      .orderBy('rank_score', 'DESC')
      .setParameters(params)
      .limit(limit);
    if (customize) customize(qb);

    let rows: any[] = [];
    try {
      const { entities, raw } = await qb.getRawAndEntities();
      // getRawAndEntities returns parallel arrays — attach the score and
      // re-sort defensively to ensure server ordering wins.
      const scored = entities.map((e: any, i: number) => {
        const score = Number(raw[i]?.rank_score ?? 0);
        return { entity: e, score };
      });
      scored.sort((a, b) => b.score - a.score);
      rows = scored.map(s => s.entity);
    } catch {
      // Regex syntax error — fall back to simple substring search so the user
      // at least gets *something* relevant.
      const fb = repo.createQueryBuilder(alias)
        .where(`LOWER(${alias}.name) LIKE :sub OR LOWER(${alias}.article) LIKE :sub`, { sub: `%${qFull}%` })
        .limit(limit);
      if (customize) customize(fb);
      rows = await fb.getMany();
    }

    // Add trigram fuzzy fallback ONLY if we got too few results AND
    // pg_trgm is available — for typo tolerance.
    if (rows.length < 5 && withTrigram) {
      try {
        const seen = new Set(rows.map(r => r.id));
        const fuzzy = repo.createQueryBuilder(alias)
          .where(`similarity(${alias}.name, :qFull) > 0.35 OR similarity(${alias}.article, :qFull) > 0.4`, { qFull })
          .orderBy(`GREATEST(similarity(${alias}.name, :qFull), similarity(${alias}.article, :qFull))`, 'DESC')
          .limit(limit - rows.length);
        if (customize) customize(fuzzy);
        const extras = (await fuzzy.getMany()).filter((r: any) => !seen.has(r.id));
        rows.push(...extras);
      } catch { /* pg_trgm missing — already handled above */ }
    }

    return rows;
  }

  // ── xlsx parser ───────────────────────────────────────────
  private async parseXlsxAsync(plId: number, filePath: string, mapping: PriceListMapping, manufacturerId: number) {
    try {
      const workbook = XLSX.readFile(filePath);
      // Diagnostic: workbooks often have multiple sheets (cover, instructions,
      // products, archive) and we always read the first one. Log all sheets so
      // we can tell if products are on a different one.
      console.log(
        `[priceList ${plId}] workbook sheets: ${JSON.stringify(workbook.SheetNames)} ` +
        `(parser uses the first one: "${workbook.SheetNames[0]}")`,
      );
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      const firstRow = Number(mapping.firstRow) - 1;
      const groupCols = [mapping.g1, mapping.g2, mapping.g3, mapping.g4, mapping.g5, mapping.g6]
        .filter(Boolean)
        .map(c => XLSX.utils.decode_col(c.toUpperCase()));
      const nameCol = XLSX.utils.decode_col(mapping.nameCol.toUpperCase());
      const artCol = XLSX.utils.decode_col(mapping.artCol.toUpperCase());
      const priceCol = mapping.priceCol ? XLSX.utils.decode_col(mapping.priceCol.toUpperCase()) : -1;
      const etmCol = mapping.etmCodeCol ? XLSX.utils.decode_col(mapping.etmCodeCol.toUpperCase()) : -1;
      const imgCol = mapping.imageUrlCol ? XLSX.utils.decode_col(mapping.imageUrlCol.toUpperCase()) : -1;
      const urlCol = mapping.externalUrlCol ? XLSX.utils.decode_col(mapping.externalUrlCol.toUpperCase()) : -1;

      // Diagnostic: column mapping the admin form actually sent to the parser.
      // If `price` / `image_url` / `external_url` ends up empty in the catalog
      // it almost always means the mapping field was left blank in the upload UI.
      console.log(
        `[priceList ${plId}] mapping: name=${mapping.nameCol} art=${mapping.artCol} ` +
        `price=${mapping.priceCol || '(none)'} etm=${mapping.etmCodeCol || '(none)'} ` +
        `image=${mapping.imageUrlCol || '(none)'} url=${mapping.externalUrlCol || '(none)'} ` +
        `firstRow=${mapping.firstRow}`,
      );

      // Auto-detect tree format: no group columns AND file has category rows
      // (rows where nameCol has text but artCol is empty)
      const isTreeFormat = groupCols.length === 0;

      // Diagnostic: dump the first 3 data rows so we can see what's actually
      // in the cells the parser reads (catches empty / shifted / merged columns,
      // HYPERLINK() formulas with hidden URLs, image-link cells with no .l.Target).
      for (let i = firstRow; i < Math.min(firstRow + 3, rows.length); i++) {
        const r = rows[i];
        const priceCell = priceCol >= 0 ? r[priceCol] : '(unmapped)';
        const urlCell = urlCol >= 0 ? r[urlCol] : '(unmapped)';
        const imgCell = imgCol >= 0 ? r[imgCol] : '(unmapped)';
        const urlObj = urlCol >= 0 ? sheet[XLSX.utils.encode_cell({ r: i, c: urlCol })] : null;
        const imgObj = imgCol >= 0 ? sheet[XLSX.utils.encode_cell({ r: i, c: imgCol })] : null;
        console.log(
          `[priceList ${plId}] row ${i}: art="${r[artCol] ?? ''}" price="${priceCell}" ` +
          `url-text="${urlCell}" url-link="${urlObj?.l?.Target || ''}" url-formula="${urlObj?.f || ''}" ` +
          `img-text="${imgCell}" img-link="${imgObj?.l?.Target || ''}" img-formula="${imgObj?.f || ''}"`,
        );
      }

      if (isTreeFormat) {
        await this.parseTreeFormat(plId, sheet, rows, firstRow, nameCol, artCol, priceCol, etmCol, imgCol, urlCol, manufacturerId);
      } else {
        await this.parseFlatFormat(plId, sheet, rows, firstRow, groupCols, nameCol, artCol, priceCol, etmCol, imgCol, urlCol, manufacturerId);
      }

      await this.plRepo.update(plId, { status: PriceListStatus.ACTIVE });
    } catch (err) {
      console.error(`Failed to parse price list ${plId}:`, err.message);
      await this.plRepo.update(plId, { status: PriceListStatus.ACTIVE });
    }
  }

  /** Flat format parser: group columns g1-g6 define category hierarchy per row */
  private async parseFlatFormat(
    plId: number, sheet: any, rows: any[][], firstRow: number,
    groupCols: number[], nameCol: number, artCol: number, priceCol: number,
    etmCol: number, imgCol: number, urlCol: number, manufacturerId: number,
  ) {
    const catCache: Map<string, number> = new Map();
    let productCount = 0;
    let withPrice = 0, withUrl = 0, withImage = 0;

    for (let i = firstRow; i < rows.length; i++) {
      const row = rows[i];
      const productName = String(row[nameCol] || '').trim();
      const article = String(row[artCol] || '').trim();
      if (!productName && !article) continue;

      const groupVals = groupCols.map(c => String(row[c] || '').trim());
      let parentId: number | null = null;
      let cacheKey = '';

      for (let g = 0; g < groupVals.length; g++) {
        const val = groupVals[g];
        if (!val) break;
        cacheKey += `|${val}`;
        if (!catCache.has(cacheKey)) {
          let cat = await this.catRepo.findOne({ where: { name: val, manufacturer_id: manufacturerId, parent_id: parentId ?? undefined } });
          if (!cat) {
            cat = await this.catRepo.save({ name: val, manufacturer_id: manufacturerId, parent_id: parentId, price_list_id: plId, sort_order: 0 });
          } else if (cat.price_list_id !== plId) {
            await this.catRepo.update(cat.id, { price_list_id: plId });
          }
          catCache.set(cacheKey, cat.id);
        }
        parentId = catCache.get(cacheKey);
      }

      const rawPrice = priceCol >= 0 ? String(row[priceCol] || '').replace(/\s/g, '').replace(',', '.') : '';
      const price = rawPrice ? parseFloat(rawPrice) : null;
      const etmCode = etmCol >= 0 ? String(row[etmCol] || '').trim() : '';
      const imageUrl = this.readCellUrl(sheet, i, imgCol);
      const externalUrl = this.readCellUrl(sheet, i, urlCol);
      if (price && !isNaN(price) && price > 0) withPrice++;
      if (externalUrl) withUrl++;
      if (imageUrl) withImage++;
      await this.prodRepo.save({
        manufacturer_id: manufacturerId,
        category_id: parentId,
        name: productName,
        article: article || null,
        etm_code: etmCode || null,
        image_url: imageUrl || null,
        external_url: externalUrl || null,
        is_active: true,
        ...(price && !isNaN(price) && price > 0 ? { price } : {}),
      });
      productCount++;
    }
    console.log(
      `Parsed ${productCount} products (flat format) for price list ${plId} ` +
      `[withPrice=${withPrice} withUrl=${withUrl} withImage=${withImage}]`,
    );
  }

  /** Tree format parser: category = row where mapped product columns (name, article, price)
   *  are ALL empty, but some other cell has text. Products = rows with name or article.
   *  All categories are flat (one level) — each category row becomes a direct child of root.
   *  Products after a category row belong to that category. */
  private async parseTreeFormat(
    plId: number, sheet: any, rows: any[][], firstRow: number,
    nameCol: number, artCol: number, priceCol: number, etmCol: number,
    imgCol: number, urlCol: number, manufacturerId: number,
  ) {
    let currentCatId: number | null = null;
    let productCount = 0;
    let catCount = 0;
    let withPrice = 0, withUrl = 0, withImage = 0;
    const catCache: Map<string, number> = new Map();

    for (let i = firstRow; i < rows.length; i++) {
      const row = rows[i];
      const productName = String(row[nameCol] || '').trim();
      const article = String(row[artCol] || '').trim();
      const etmCode = etmCol >= 0 ? String(row[etmCol] || '').trim() : '';
      const rawPrice = priceCol >= 0 ? String(row[priceCol] || '').replace(/\s/g, '').replace(',', '.').replace(/-/g, '.') : '';

      // If product name column OR article column has text → it's a product
      if (productName || article) {
        const price = rawPrice ? parseFloat(rawPrice) : null;
        const imageUrl = this.readCellUrl(sheet, i, imgCol);
        const externalUrl = this.readCellUrl(sheet, i, urlCol);
        if (price && !isNaN(price) && price > 0) withPrice++;
        if (externalUrl) withUrl++;
        if (imageUrl) withImage++;
        await this.prodRepo.save({
          manufacturer_id: manufacturerId,
          category_id: currentCatId,
          name: productName || article,
          article: article || null,
          etm_code: etmCode || null,
          image_url: imageUrl || null,
          external_url: externalUrl || null,
          is_active: true,
          ...(price && !isNaN(price) && price > 0 ? { price } : {}),
        });
        productCount++;
        continue;
      }

      // Product columns empty — check if any other cell has text → category
      const firstNonEmpty = row.find((cell: any) => String(cell || '').trim());
      if (!firstNonEmpty) continue;
      const categoryName = String(firstNonEmpty).trim();
      if (!categoryName) continue;

      // Flat category: all categories at root level, no nesting
      if (!catCache.has(categoryName)) {
        let cat = await this.catRepo.findOne({
          where: { name: categoryName, manufacturer_id: manufacturerId, parent_id: null as any },
        });
        if (!cat) {
          cat = await this.catRepo.save({
            name: categoryName, manufacturer_id: manufacturerId, parent_id: null,
            price_list_id: plId, sort_order: catCount,
          });
        } else if (cat.price_list_id !== plId) {
          await this.catRepo.update(cat.id, { price_list_id: plId });
        }
        catCache.set(categoryName, cat.id);
        catCount++;
      }
      currentCatId = catCache.get(categoryName)!;
    }
    console.log(
      `Parsed ${productCount} products, ${catCount} categories (tree format) for price list ${plId} ` +
      `[withPrice=${withPrice} withUrl=${withUrl} withImage=${withImage}]`,
    );
  }

  /** Normalize external URL from Excel. Prefix https:// when scheme missing.
   *  Returns null if value is clearly not a URL (no dot, no slash, just random text). */
  private normalizeUrl(raw: string): string | null {
    const s = String(raw || '').trim();
    if (!s) return null;
    // Already has scheme
    if (/^https?:\/\//i.test(s)) return s;
    // Looks like a URL (has dot + no spaces) → assume https
    if (/\./.test(s) && !/\s/.test(s)) return `https://${s}`;
    // Not a URL — discard to prevent things like "info" being treated as a path
    return null;
  }

  /** Read a URL from an Excel cell. Sources, in priority order:
   *   1. cell.v if it is itself an http(s) URL — the admin's visible intent.
   *   2. HYPERLINK formula:
   *      a. `HYPERLINK("base" & <CellRef>, "label")` — IEK pattern.
   *         Resolves <CellRef> against the sheet to build the full URL.
   *      b. `HYPERLINK("target", "label")` — static form. Prefers the label
   *         when it's a URL (some manufacturers put the working public URL
   *         in the label and a stale redirect in the target).
   *   3. cell.l.Target — Excel "Insert → Link" style hyperlinks for cells
   *      whose visible text is non-URL filler like "инфо"/"Подробнее".
   *   4. plain text that's still vaguely url-ish ("qr.iek.group/..."). */
  private readCellUrl(sheet: any, rowIdx: number, colIdx: number): string | null {
    if (colIdx < 0) return null;
    const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
    const cell = sheet[addr];
    if (!cell) return null;
    // 1. visible value, if it's already a URL
    const text = String(cell.v ?? '').trim();
    if (/^https?:\/\//i.test(text)) return this.normalizeUrl(text);
    // 2. HYPERLINK formula
    if (cell.f) {
      const fStr = String(cell.f);
      // 2a. Concatenation: HYPERLINK("base" & A8, "label")
      // Resolve the cell reference (e.g. A8) and append its value.
      const concat = fStr.match(/HYPERLINK\s*\(\s*"([^"]*)"\s*&\s*([A-Z]+)(\d+)/i);
      if (concat) {
        const base = concat[1];
        const refCol = XLSX.utils.decode_col(concat[2]);
        const refRow = parseInt(concat[3], 10) - 1; // Excel rows are 1-indexed
        const refCell = sheet[XLSX.utils.encode_cell({ r: refRow, c: refCol })];
        const refVal = String(refCell?.v ?? '').trim();
        if (refVal) return this.normalizeUrl(base + refVal);
      }
      // 2b. Static form: HYPERLINK("target", "label")
      const stat = fStr.match(/HYPERLINK\s*\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)")?\s*\)/i);
      if (stat) {
        const target = stat[1];
        const label = stat[2];
        if (label && /^https?:\/\//i.test(label)) return this.normalizeUrl(label);
        return this.normalizeUrl(target);
      }
    }
    // 3. cell-level hyperlink
    const target = cell.l?.Target;
    if (target) return this.normalizeUrl(String(target));
    // 4. plain text that may still look url-ish
    return this.normalizeUrl(text);
  }

  private buildTree(categories: CatalogCategory[], parentId: number | null): any[] {
    return categories
      .filter(c => (c.parent_id ?? null) === parentId)
      .map(c => ({ ...c, children: this.buildTree(categories, c.id) }));
  }

  async getPricesByArticles(articles: string[]): Promise<Record<string, { price: number; manufacturer: string } | null>> {
    if (!articles.length) return {};
    const result: Record<string, { price: number; manufacturer: string } | null> = {};
    const products = await this.prodRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manufacturer', 'mfr')
      .where('p.article IN (:...articles)', { articles })
      .andWhere('p.price IS NOT NULL')
      .andWhere('p.price > 0')
      .getMany();
    const map = new Map<string, { price: number; manufacturer: string }>();
    for (const p of products) {
      if (p.article && !map.has(p.article)) {
        map.set(p.article, { price: Number(p.price), manufacturer: p.manufacturer?.name || '' });
      }
    }
    for (const a of articles) {
      result[a] = map.get(a) ?? null;
    }
    return result;
  }

  /** Fix Cyrillic garbling: multer decodes multipart filenames as latin-1,
   *  but browsers send UTF-8 bytes — re-decode to get correct characters. */
  private fixFilenameEncoding(str: string): string {
    try {
      const fixed = Buffer.from(str, 'latin1').toString('utf8');
      // Only use the re-decoded version if it actually contains non-ASCII (Cyrillic etc.)
      // and doesn't have replacement characters (invalid sequence)
      return fixed.includes('\uFFFD') ? str : fixed;
    } catch {
      return str;
    }
  }

  private parseDisplayName(filename: string): string {
    const name0 = this.fixFilenameEncoding(filename);
    let name = name0.replace(/\.[^.]+$/, '');
    name = name.replace(/-\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/, '');
    name = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');
    return name.replace(/_/g, ' ').trim();
  }

  // ── Tile Data (Excel upload per tile) ─────────────────────

  /** Preview first N rows of uploaded Excel file */
  previewTileExcel(filePath: string, maxRows = 7): { headers: string[]; rows: any[][] } {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Build column headers: A, B, C, ...
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const colCount = range.e.c + 1;
    const headers = Array.from({ length: colCount }, (_, i) => XLSX.utils.encode_col(i));

    return { headers, rows: allRows.slice(0, maxRows) };
  }

  /** Upload and parse Excel data into tile_products for a tile */
  async uploadTileData(
    tileId: number,
    file: Express.Multer.File,
    mapping: {
      firstRow: number;
      nameCol: string;
      articleCol: string;
      priceCol?: string;
      unitCol?: string;
      brandCol?: string;
      etmCodeCol?: string;
      imageUrlCol?: string;
      externalUrlCol?: string;
      accessoriesStartCol?: string;
      filters: { col: string; label: string }[];
    },
  ) {
    const tile = await this.tileRepo.findOne({ where: { id: tileId } });
    if (!tile) throw new NotFoundException('Tile not found');

    // Remove old data file
    if (tile.data_file_path) {
      try { fs.unlinkSync(tile.data_file_path); } catch {}
    }

    // Delete old products for this tile
    await this.tileProductRepo.delete({ tile_id: tileId });

    // Parse Excel
    const workbook = XLSX.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const firstRow = Number(mapping.firstRow) - 1; // 1-based → 0-based
    const nameIdx = XLSX.utils.decode_col(mapping.nameCol.toUpperCase());
    const artIdx = mapping.articleCol ? XLSX.utils.decode_col(mapping.articleCol.toUpperCase()) : -1;
    const priceIdx = mapping.priceCol ? XLSX.utils.decode_col(mapping.priceCol.toUpperCase()) : -1;
    const unitIdx = mapping.unitCol ? XLSX.utils.decode_col(mapping.unitCol.toUpperCase()) : -1;
    const brandIdx = mapping.brandCol ? XLSX.utils.decode_col(mapping.brandCol.toUpperCase()) : -1;
    const etmCodeIdx = mapping.etmCodeCol ? XLSX.utils.decode_col(mapping.etmCodeCol.toUpperCase()) : -1;
    const imageUrlIdx = mapping.imageUrlCol ? XLSX.utils.decode_col(mapping.imageUrlCol.toUpperCase()) : -1;
    const externalUrlIdx = mapping.externalUrlCol ? XLSX.utils.decode_col(mapping.externalUrlCol.toUpperCase()) : -1;
    const accStartIdx = mapping.accessoriesStartCol ? XLSX.utils.decode_col(mapping.accessoriesStartCol.toUpperCase()) : -1;
    const filterCols = (mapping.filters || []).map(f => ({
      idx: XLSX.utils.decode_col(f.col.toUpperCase()),
      label: f.label,
    }));

    // Collect filter distinct values
    const filterDistinct: Record<string, Set<string>> = {};
    for (const f of filterCols) {
      filterDistinct[f.label] = new Set();
    }

    // Batch insert for performance
    const batch: Partial<TileProduct>[] = [];

    for (let i = firstRow; i < allRows.length; i++) {
      const row = allRows[i];
      const name = String(row[nameIdx] || '').trim();
      if (!name) continue;

      const article = artIdx >= 0 ? String(row[artIdx] || '').trim() : '';
      const etmCode = etmCodeIdx >= 0 ? String(row[etmCodeIdx] || '').trim() : '';
      // image/URL columns may contain hyperlinks — prefer the link target over display text
      const imageUrl = this.readCellUrl(sheet, i, imageUrlIdx);
      const externalUrl = this.readCellUrl(sheet, i, externalUrlIdx);
      const rawPrice = priceIdx >= 0 ? String(row[priceIdx] || '').replace(/\s/g, '').replace(',', '.') : '';
      const price = rawPrice ? parseFloat(rawPrice) : null;
      const unit = unitIdx >= 0 ? String(row[unitIdx] || '').trim() : '';
      const brand = brandIdx >= 0 ? String(row[brandIdx] || '').trim() : '';

      const attributes: Record<string, string> = {};
      for (const fc of filterCols) {
        const val = String(row[fc.idx] || '').trim();
        if (val) {
          attributes[fc.label] = val;
          filterDistinct[fc.label].add(val);
        }
      }

      // Parse accessories from columns starting at accessoriesStartCol
      const accessories: { type: string; name: string; article: string; url: string }[] = [];
      if (accStartIdx >= 0) {
        for (let c = accStartIdx; c < row.length; c++) {
          const cell = String(row[c] || '').trim();
          if (!cell) continue;
          // Format: "Type:Name:Article:URL" (colon-separated)
          const parts = cell.split(':');
          if (parts.length >= 2) {
            accessories.push({
              type: (parts[0] || '').trim(),
              name: (parts[1] || '').trim(),
              article: (parts[2] || '').trim(),
              url: parts.slice(3).join(':').trim(), // URL may contain colons
            });
          }
        }
      }

      batch.push({
        tile_id: tileId,
        name,
        article: article || null,
        etm_code: etmCode || null,
        image_url: imageUrl || null,
        external_url: externalUrl || null,
        price: price && !isNaN(price) && price > 0 ? price : null,
        unit: unit || null,
        brand: brand || null,
        attributes,
        accessories,
      });
    }

    // Insert in chunks of 500 for efficiency
    for (let i = 0; i < batch.length; i += 500) {
      await this.tileProductRepo.insert(batch.slice(i, i + 500));
    }

    // Build auto-computed filters with sorted distinct values
    const computedFilters: { label: string; opts: string[] }[] = [];

    // Add brand filter if brand column is mapped and has values
    if (brandIdx >= 0) {
      const brandValues = new Set<string>();
      for (const p of batch) { if (p.brand) brandValues.add(p.brand); }
      if (brandValues.size > 0) {
        computedFilters.push({
          label: 'Производитель',
          opts: [...brandValues].sort((a, b) => a.localeCompare(b, 'ru')),
        });
      }
    }

    // Add attribute-based filters
    for (const fc of filterCols) {
      const vals = filterDistinct[fc.label];
      if (vals.size === 0) continue;
      const sorted = [...vals].sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b, 'ru');
      });
      computedFilters.push({ label: fc.label, opts: sorted });
    }

    // Update tile with metadata
    const fixedName = this.fixFilenameEncoding(file.originalname);
    await this.tileRepo.update(tileId, {
      data_file_name: fixedName,
      data_file_path: file.path,
      column_mapping: mapping as any,
      products_count: batch.length,
      filters: computedFilters as any,
    });

    return { productsCount: batch.length, filters: computedFilters };
  }

  /** Get tile products with filtering (for user-facing catalog) */
  async getTileProducts(
    tileId: number,
    brands?: string[],
    extraFilters?: Record<string, string[]>,
    limit = 2000,
  ): Promise<any[]> {
    const qb = this.tileProductRepo.createQueryBuilder('tp')
      .where('tp.tile_id = :tileId', { tileId });

    if (brands?.length) {
      qb.andWhere('tp.brand IN (:...brands)', { brands });
    }

    if (extraFilters) {
      let paramIdx = 0;
      for (const [label, values] of Object.entries(extraFilters)) {
        if (!values?.length) continue;
        paramIdx++;
        qb.andWhere(`tp.attributes->>:lbl${paramIdx} IN (:...vls${paramIdx})`, {
          [`lbl${paramIdx}`]: label,
          [`vls${paramIdx}`]: values,
        });
      }
    }

    const rows = await qb.orderBy('tp.name').limit(limit).getMany();

    // Normalize to same shape as catalog_products (manufacturer object)
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      article: r.article,
      etm_code: r.etm_code,
      price: r.price,
      unit: r.unit,
      image_url: r.image_url,
      external_url: r.external_url,
      attributes: r.attributes,
      accessories: r.accessories?.length ? r.accessories : undefined,
      manufacturer: r.brand ? { name: r.brand } : null,
    }));
  }

  /** Get filter options for a tile (from pre-computed tile.filters or botDb fallback) */
  async getTileFilterOptions(slug: string): Promise<{ label: string; opts: string[] }[]> {
    const tile = await this.tileRepo.findOne({ where: { slug } });
    if (!tile) return [];

    // If tile has uploaded data, return pre-computed filters
    if (tile.products_count > 0 && tile.filters?.length) {
      return tile.filters;
    }

    // Fallback to bot DB for legacy tiles without uploaded data
    if (this.botDb.isAvailable) {
      return this.botDb.getFilterOptions(slug);
    }

    return tile.filters || [];
  }

  /** Get products for user-facing catalog by slug (tile_products or botDb fallback) */
  async getProductsBySlug(slug: string, brands?: string[], extraFilters?: Record<string, string[]>): Promise<any[]> {
    const tile = await this.tileRepo.findOne({ where: { slug } });
    if (!tile) return [];

    // If tile has uploaded data, use tile_products
    if (tile.products_count > 0) {
      return this.getTileProducts(tile.id, brands, extraFilters);
    }

    // Fallback to existing logic (botDb or keyword-matching)
    return this.getProductsByCategorySlug(slug, brands, extraFilters);
  }

  /** Delete tile data (products + file) */
  async deleteTileData(tileId: number) {
    const tile = await this.tileRepo.findOne({ where: { id: tileId } });
    if (!tile) throw new NotFoundException('Tile not found');

    await this.tileProductRepo.delete({ tile_id: tileId });

    if (tile.data_file_path) {
      try { fs.unlinkSync(tile.data_file_path); } catch {}
    }

    await this.tileRepo.update(tileId, {
      data_file_name: null,
      data_file_path: null,
      column_mapping: null,
      products_count: 0,
      filters: [] as any,
    });

    return { success: true };
  }

  // ── Accessory Tables ─────────────────────────────────────────

  async getAccessoryTables() {
    return this.accTableRepo.find({
      relations: ['tile', 'priceList', 'priceList.manufacturer'],
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Upload an accessory table linked to either a CatalogTile (from "База")
   * or a PriceList (from "Прайс-листы"). Pass exactly one of tileId / priceListId.
   */
  async uploadAccessoryTable(
    file: Express.Multer.File,
    opts: { tileId?: number; priceListId?: number },
    mapping: AccessoryTable['column_mapping'],
  ) {
    const { tileId, priceListId } = opts;

    if (tileId) {
      const tile = await this.tileRepo.findOne({ where: { id: tileId } });
      if (!tile) throw new NotFoundException('Tile not found');
    } else if (priceListId) {
      const pl = await this.plRepo.findOne({ where: { id: priceListId } });
      if (!pl) throw new NotFoundException('Price list not found');
    } else {
      throw new Error('Укажите tileId или priceListId');
    }

    const fixedName = this.fixFilenameEncoding(file.originalname);

    const table = await this.accTableRepo.save({
      tile_id: tileId ?? null,
      price_list_id: priceListId ?? null,
      file_name: fixedName,
      file_path: file.path,
      column_mapping: mapping,
      items_count: 0,
    });

    this.parseAccessoryXlsxAsync(table.id, file.path, mapping).catch(console.error);
    return table;
  }

  private async parseAccessoryXlsxAsync(
    tableId: number,
    filePath: string,
    mapping: AccessoryTable['column_mapping'],
  ) {
    try {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const colIdx = (col: string | undefined) =>
        col ? XLSX.utils.decode_col(col.toUpperCase()) : -1;

      const artIdx  = colIdx(mapping.articleCol);
      const nameIdx = colIdx(mapping.nameCol);
      const imgIdx  = colIdx(mapping.imageUrlCol);
      const siteIdx = colIdx(mapping.siteUrlCol);
      const descIdx = colIdx(mapping.descriptionCol);
      const paramCols = (mapping.params || []).map(p => ({
        idx: colIdx(p.col),
        label: p.label,
      }));

      const startRow = Math.max(0, (mapping.firstRow || 1) - 1);
      const items: Partial<AccessoryItem>[] = [];

      for (let i = startRow; i < allRows.length; i++) {
        const row = allRows[i];
        const article = String(row[artIdx] ?? '').trim();
        if (!article) continue;

        const attrs: Record<string, string> = {};
        for (const pc of paramCols) {
          const val = String(row[pc.idx] ?? '').trim();
          if (val && pc.label) attrs[pc.label] = val;
        }

        items.push({
          accessory_table_id: tableId,
          article,
          name: nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : undefined,
          image_url: imgIdx >= 0 ? String(row[imgIdx] ?? '').trim() || undefined : undefined,
          site_url: siteIdx >= 0 ? String(row[siteIdx] ?? '').trim() || undefined : undefined,
          description: descIdx >= 0 ? String(row[descIdx] ?? '').trim() || undefined : undefined,
          attributes: attrs,
        });
      }

      // Delete old items and re-insert
      await this.accItemRepo.delete({ accessory_table_id: tableId });
      for (let i = 0; i < items.length; i += 500) {
        await this.accItemRepo.save(items.slice(i, i + 500));
      }
      await this.accTableRepo.update(tableId, { items_count: items.length });
    } catch (e) {
      console.error('parseAccessoryXlsxAsync error:', e);
    }
  }

  async deleteAccessoryTable(id: number) {
    const table = await this.accTableRepo.findOne({ where: { id } });
    if (!table) throw new NotFoundException('Таблица аксессуаров не найдена');
    if (table.file_path) {
      try { fs.unlinkSync(table.file_path); } catch {}
    }
    await this.accItemRepo.delete({ accessory_table_id: id });
    await this.accTableRepo.delete(id);
    return { success: true };
  }

  /** Resolve all AccessoryTable IDs that apply to a given tile product.
   *  Checks tables linked directly to the tile, then falls back to tables
   *  linked to a PriceList whose manufacturer name matches the product brand. */
  private async resolveAccTableIdsForTileProduct(tileId: number, brand: string | null): Promise<number[]> {
    // 1. Directly tile-linked tables
    const tileTables = await this.accTableRepo.find({ where: { tile_id: tileId } });
    if (tileTables.length) return tileTables.map(t => t.id);

    // 2. Fallback: find by manufacturer name → price lists → accessory tables
    if (brand) {
      const manuf = await this.manufRepo
        .createQueryBuilder('m')
        .where('LOWER(m.name) = LOWER(:name)', { name: brand.trim() })
        .getOne();
      if (manuf) {
        const pls = await this.plRepo.find({ where: { manufacturer_id: manuf.id } });
        if (pls.length) {
          const plIds = pls.map(p => p.id);
          const plTables = await this.accTableRepo
            .createQueryBuilder('at')
            .where('at.price_list_id IN (:...plIds)', { plIds })
            .getMany();
          if (plTables.length) return plTables.map(t => t.id);
        }
      }
    }
    return [];
  }

  /** Get accessories for a tile product — returns grouped list enriched with DB details */
  async getTileProductAccessories(tileId: number, productId: number) {
    const product = await this.tileProductRepo.findOne({ where: { id: productId } });
    if (!product || !product.accessories?.length) return [];

    const tableIds = await this.resolveAccTableIdsForTileProduct(tileId, product.brand);

    // Collect unique articles from this product's accessories
    const articles = [...new Set(product.accessories.map(a => a.article).filter(Boolean))];

    // Look up details in DB
    const items = tableIds.length > 0 ? await this.accItemRepo
      .createQueryBuilder('ai')
      .where('ai.accessory_table_id IN (:...tableIds)', { tableIds })
      .andWhere('ai.article IN (:...articles)', { articles: articles.length ? articles : ['__none__'] })
      .getMany() : [];

    const itemMap = new Map(items.map(i => [i.article, i]));

    // Group by type
    const groups: Record<string, any[]> = {};
    for (const acc of product.accessories) {
      const key = acc.type || 'Прочее';
      if (!groups[key]) groups[key] = [];
      const detail = itemMap.get(acc.article);
      groups[key].push({
        ...acc,
        image_url: detail?.image_url || null,
        site_url: detail?.site_url || null,
        description: detail?.description || null,
        attributes: detail?.attributes || {},
        db_name: detail?.name || null,
      });
    }

    return Object.entries(groups).map(([type, items]) => ({ type, items }));
  }
}
