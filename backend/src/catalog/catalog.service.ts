import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Manufacturer, PriceList, PriceListStatus, CatalogCategory, CatalogProduct, ProductAnalog, ProductAccessory, CatalogTile } from './entities/catalog.entities';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { BotDbService } from './bot-db.service';

export interface PriceListMapping {
  firstRow: number;
  g1: string; g2?: string; g3?: string; g4?: string; g5?: string; g6?: string;
  nameCol: string;
  artCol: string;
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
    private readonly botDb: BotDbService,
  ) {}

  async onModuleInit() {
    // Upsert default tiles
    for (const t of DEFAULT_TILES) {
      const existing = await this.tileRepo.findOne({ where: { slug: t.slug } });
      if (!existing) {
        await this.tileRepo.save({ ...t, is_active: true });
      } else {
        // Keep filters/name in sync when TZ changes
        await this.tileRepo.update(existing.id, {
          name: t.name,
          filters: t.filters as any[],
          sort_order: t.sort_order,
          is_active: true,
        });
      }
    }
    // Deactivate any tiles that are no longer in TZ (old slugs like uzo, klemmy, etc.)
    const activeSlugs = DEFAULT_TILES.map(t => t.slug);
    await this.tileRepo.update({ slug: Not(In(activeSlugs)) }, { is_active: false });
  }

  // ── Catalog Tiles ─────────────────────────────────────────
  async getTiles() {
    return this.tileRepo.find({ where: { is_active: true }, order: { sort_order: 'ASC', id: 'ASC' } });
  }

  async getAllTiles() {
    return this.tileRepo.find({ order: { sort_order: 'ASC', id: 'ASC' } });
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
    // Only return manufacturers that actually have categories (price list data loaded)
    return this.manufRepo
      .createQueryBuilder('m')
      .innerJoin('price_lists', 'pl', 'pl.manufacturer_id = m.id')
      .innerJoin('catalog_categories', 'cc', 'cc.price_list_id = pl.id')
      .select(['m.id', 'm.name', 'm.is_active'])
      .where('m.is_active = true')
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
    const displayName = this.parseDisplayName(file.originalname);

    let manuf = await this.manufRepo.findOne({ where: { name: displayName } });
    if (!manuf) manuf = await this.manufRepo.save({ name: displayName, is_active: true });

    const pl = await this.plRepo.save({
      manufacturer_id: manuf.id,
      file_name: file.originalname,
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

    const cats = await this.catRepo.find({ where: { price_list_id: id } });
    if (cats.length > 0) {
      const catIds = cats.map(c => c.id);
      await this.prodRepo.delete({ category_id: In(catIds) });
      await this.catRepo.delete({ price_list_id: id });
    }

    if (pl.file_path) {
      try { fs.unlinkSync(pl.file_path); } catch { /* file may not exist */ }
    }

    const manufId = pl.manufacturer_id;
    await this.plRepo.delete(id);

    // If the manufacturer has no remaining price lists, delete it too
    if (manufId) {
      const remaining = await this.plRepo.count({ where: { manufacturer_id: manufId } });
      if (remaining === 0) {
        await this.manufRepo.delete(manufId);
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
    await this.plRepo.update(id, { status: PriceListStatus.ARCHIVE, archived_at: new Date() });
    const old = await this.plRepo.findOne({ where: { id } });
    const pl = await this.plRepo.save({
      manufacturer_id: old.manufacturer_id,
      file_name: file.originalname,
      file_path: file.path,
      status: PriceListStatus.PROCESSING,
      mapping,
      uploaded_by: uploadedBy,
    });
    this.parseXlsxAsync(pl.id, file.path, mapping, old.manufacturer_id).catch(console.error);
    return pl;
  }

  // ── Catalog tree ──────────────────────────────────────────
  async getTree(manufacturerId?: number) {
    const activePls = await this.plRepo.find({ where: { status: PriceListStatus.ACTIVE } });
    const activePlIds = activePls.map(p => p.id);

    if (activePlIds.length === 0) return [];

    const qb = this.catRepo.createQueryBuilder('c')
      .where('c.price_list_id IN (:...plIds)', { plIds: activePlIds })
      .orderBy('c.sort_order', 'ASC')
      .addOrderBy('c.name', 'ASC');

    if (manufacturerId) {
      qb.andWhere('c.manufacturer_id = :manufacturerId', { manufacturerId });
    }

    const categories = await qb.getMany();
    return this.buildTree(categories, null);
  }

  async getProducts(categoryId: number, attrs?: Record<string, string>) {
    const qb = this.prodRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manufacturer', 'm')
      .where('p.category_id = :categoryId', { categoryId })
      .andWhere('p.is_active = true');
    if (attrs && Object.keys(attrs).length > 0) {
      Object.entries(attrs).forEach(([key, val]) => {
        qb.andWhere(`p.attributes->>'${key}' = :attr_${key}`, { [`attr_${key}`]: val });
      });
    }
    return qb.orderBy('p.name').getMany();
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

  async searchProducts(q: string, limit = 20) {
    if (!q || q.length < 2) return [];
    const s = `%${q.toLowerCase()}%`;
    return this.prodRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.manufacturer', 'm')
      .where('p.is_active = true')
      .andWhere('(LOWER(p.name) LIKE :s OR LOWER(p.article) LIKE :s)', { s })
      .orderBy(`CASE WHEN LOWER(p.article) = '${q.toLowerCase()}' THEN 0 WHEN LOWER(p.article) LIKE '${q.toLowerCase()}%' THEN 1 ELSE 2 END`)
      .limit(limit)
      .getMany();
  }

  // ── xlsx parser ───────────────────────────────────────────
  private async parseXlsxAsync(plId: number, filePath: string, mapping: PriceListMapping, manufacturerId: number) {
    try {
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      const firstRow = Number(mapping.firstRow) - 1;
      const groupCols = [mapping.g1, mapping.g2, mapping.g3, mapping.g4, mapping.g5, mapping.g6]
        .filter(Boolean)
        .map(c => XLSX.utils.decode_col(c.toUpperCase()));
      const nameCol = XLSX.utils.decode_col(mapping.nameCol.toUpperCase());
      const artCol = XLSX.utils.decode_col(mapping.artCol.toUpperCase());

      const catCache: Map<string, number> = new Map();

      let productCount = 0;

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

        await this.prodRepo.save({
          manufacturer_id: manufacturerId,
          category_id: parentId,
          name: productName,
          article: article || null,
          is_active: true,
        });
        productCount++;
      }

      await this.plRepo.update(plId, { status: PriceListStatus.ACTIVE });
      console.log(`✅ Parsed ${productCount} products for price list ${plId}`);
    } catch (err) {
      console.error(`❌ Failed to parse price list ${plId}:`, err.message);
      await this.plRepo.update(plId, { status: PriceListStatus.ACTIVE });
    }
  }

  private buildTree(categories: CatalogCategory[], parentId: number | null): any[] {
    return categories
      .filter(c => (c.parent_id ?? null) === parentId)
      .map(c => ({ ...c, children: this.buildTree(categories, c.id) }));
  }

  private parseDisplayName(filename: string): string {
    let name = filename.replace(/\.[^.]+$/, '');
    name = name.replace(/-\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/, '');
    name = name.replace(/-\d{4}-\d{2}-\d{2}$/, '');
    return name.replace(/_/g, ' ').trim();
  }
}
