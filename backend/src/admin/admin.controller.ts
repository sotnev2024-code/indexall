import {
  Controller, Get, Post, Patch, Delete, Put,
  Param, Body, UseGuards, ParseIntPipe, ParseEnumPipe, OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { User, UserPlan, UserStatus } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import { Folder } from '../folders/folder.entity';
import {
  PriceList, PriceListStatus, Manufacturer,
  CatalogProduct, CatalogTile, CatalogCategory,
} from '../catalog/entities/catalog.entities';
import { TariffOperation } from './tariff-operation.entity';
import { TariffConfig } from './tariff-config.entity';

const DEFAULT_TARIFF_CONFIGS = [
  {
    plan_key: 'free',
    name: 'Бесплатный',
    price: 0,
    price_annual: null,
    description: 'Просмотр шаблонов и проектов, работа с листом спецификации, доступны каталоги производителей.',
    is_active: true,
  },
  {
    plan_key: 'pro',
    name: 'PRO',
    price: 7990,
    price_annual: 79900,
    description: 'Полный доступ ко всем функциям: спецификации, каталог, интеграции, шаблоны, аналоги, аксессуары.',
    is_active: true,
  },
  {
    plan_key: 'trial',
    name: 'Trial',
    price: 0,
    price_annual: null,
    description: '7 дней полного доступа ко всем функциям PRO. Бесплатно, только один раз.',
    is_active: true,
  },
];

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController implements OnModuleInit {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Project) private projectsRepo: Repository<Project>,
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(Template) private templatesRepo: Repository<Template>,
    @InjectRepository(Folder) private foldersRepo: Repository<Folder>,
    @InjectRepository(PriceList) private plRepo: Repository<PriceList>,
    @InjectRepository(Manufacturer) private manufRepo: Repository<Manufacturer>,
    @InjectRepository(CatalogProduct) private prodRepo: Repository<CatalogProduct>,
    @InjectRepository(CatalogTile) private tileRepo: Repository<CatalogTile>,
    @InjectRepository(CatalogCategory) private catRepo: Repository<CatalogCategory>,
    @InjectRepository(TariffOperation) private tariffRepo: Repository<TariffOperation>,
    @InjectRepository(TariffConfig) private tariffConfigRepo: Repository<TariffConfig>,
  ) {}

  async onModuleInit() {
    // Deactivate removed plans (e.g. 'base')
    const activeKeys = DEFAULT_TARIFF_CONFIGS.map(c => c.plan_key);
    const all = await this.tariffConfigRepo.find();
    for (const existing of all) {
      if (!activeKeys.includes(existing.plan_key) && existing.is_active) {
        await this.tariffConfigRepo.update(existing.id, { is_active: false });
      }
    }
    // Upsert defaults (only update fields that haven't been customised to non-default values)
    for (const cfg of DEFAULT_TARIFF_CONFIGS) {
      const exists = await this.tariffConfigRepo.findOne({ where: { plan_key: cfg.plan_key } });
      if (!exists) {
        await this.tariffConfigRepo.save(this.tariffConfigRepo.create(cfg));
      } else {
        // Always keep is_active and price_annual in sync with defaults; name/price/description admin-editable
        await this.tariffConfigRepo.update(exists.id, { is_active: cfg.is_active });
      }
    }
  }

  // ── Users ────────────────────────────────────────────────────

  @Get('users')
  async getUsers() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    const counts = await this.projectsRepo
      .createQueryBuilder('p')
      .select('p.userId', 'userId')
      .addSelect('COUNT(p.id)', 'projects')
      .groupBy('p.userId')
      .getRawMany();
    const sheetCounts = await this.sheetsRepo
      .createQueryBuilder('s')
      .innerJoin('s.project', 'p')
      .select('p.userId', 'userId')
      .addSelect('COUNT(s.id)', 'sheets')
      .groupBy('p.userId')
      .getRawMany();
    const projectMap = Object.fromEntries(counts.map(r => [r.userId, Number(r.projects)]));
    const sheetMap = Object.fromEntries(sheetCounts.map(r => [r.userId, Number(r.sheets)]));

    return users.map(({ password, ...safe }) => ({
      ...safe,
      projects_count: projectMap[safe.id] || 0,
      sheets_count: sheetMap[safe.id] || 0,
    }));
  }

  @Patch('users/:id/plan')
  async updatePlan(
    @Param('id', ParseIntPipe) id: number,
    @Body('plan', new ParseEnumPipe(UserPlan)) plan: UserPlan,
  ) {
    await this.usersRepo.update(id, { plan });
    const user = await this.usersRepo.findOne({ where: { id } });
    const { password, ...safe } = user;
    return safe;
  }

  @Patch('users/:id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    await this.usersRepo.update(id, { status: status as UserStatus });
    const user = await this.usersRepo.findOne({ where: { id } });
    const { password, ...safe } = user;
    return safe;
  }

  @Patch('users/:id/verified')
  async updateVerified(
    @Param('id', ParseIntPipe) id: number,
    @Body('emailVerified') emailVerified: boolean,
  ) {
    await this.usersRepo.update(id, { emailVerified });
    const user = await this.usersRepo.findOne({ where: { id } });
    const { password, ...safe } = user;
    return safe;
  }

  @Patch('users/:id/subscription')
  async updateSubscription(
    @Param('id', ParseIntPipe) id: number,
    @Body('subscriptionExpiresAt') subscriptionExpiresAt: string,
  ) {
    const val = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
    await this.usersRepo.update(id, { subscriptionExpiresAt: val });
    const user = await this.usersRepo.findOne({ where: { id } });
    const { password, ...safe } = user;
    return safe;
  }

  // ── Conversions ──────────────────────────────────────────────

  @Get('conversions')
  async getConversions() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });

    const projectCounts = await this.projectsRepo
      .createQueryBuilder('p')
      .select('p.userId', 'userId')
      .addSelect('COUNT(p.id)', 'cnt')
      .groupBy('p.userId')
      .getRawMany();
    const pMap = Object.fromEntries(projectCounts.map(r => [r.userId, Number(r.cnt)]));

    const sheetCounts = await this.sheetsRepo
      .createQueryBuilder('s')
      .innerJoin('s.project', 'p')
      .select('p.userId', 'userId')
      .addSelect('COUNT(s.id)', 'cnt')
      .groupBy('p.userId')
      .getRawMany();
    const sMap = Object.fromEntries(sheetCounts.map(r => [r.userId, Number(r.cnt)]));

    const templateCounts = await this.templatesRepo
      .createQueryBuilder('t')
      .select('t.userId', 'userId')
      .addSelect('COUNT(t.id)', 'cnt')
      .groupBy('t.userId')
      .getRawMany();
    const tMap = Object.fromEntries(templateCounts.map(r => [r.userId, Number(r.cnt)]));

    const tariffCounts = await this.tariffRepo
      .createQueryBuilder('to')
      .select('to.userId', 'userId')
      .addSelect('COUNT(to.id)', 'cnt')
      .groupBy('to.userId')
      .getRawMany();
    const trMap = Object.fromEntries(tariffCounts.map(r => [r.userId, Number(r.cnt)]));

    return users.map(({ password, ...u }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      step1: true,
      step2: u.emailVerified,
      step3: (pMap[u.id] || 0) > 0,
      trial: u.plan === 'trial',
      templates: tMap[u.id] || 0,
      projects: pMap[u.id] || 0,
      specs: sMap[u.id] || 0,
      etm: false,
      rusSv: false,
      tariffs: trMap[u.id] || 0,
      promo: false,
    }));
  }

  // ── Tariff operations ────────────────────────────────────────

  @Get('tariff-operations')
  async getTariffOperations() {
    const ops = await this.tariffRepo.find({
      relations: ['user'],
      order: { date: 'DESC' },
    });
    return ops.map(op => ({
      ...op,
      userName: op.user?.name || '—',
      userEmail: op.user?.email || '—',
    }));
  }

  @Post('tariff-operations')
  async createTariffOperation(@Body() body: {
    userId: number;
    operator: string;
    plan: string;
    amount: number;
    status: string;
    expiresAt?: string;
    comment?: string;
  }) {
    const op = this.tariffRepo.create({
      userId: body.userId,
      operator: body.operator,
      plan: body.plan,
      amount: body.amount,
      status: body.status,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      comment: body.comment || null,
    });
    const saved = await this.tariffRepo.save(op);
    const full = await this.tariffRepo.findOne({ where: { id: saved.id }, relations: ['user'] });
    return { ...full, userName: full.user?.name || '—', userEmail: full.user?.email || '—' };
  }

  @Delete('tariff-operations/:id')
  async deleteTariffOperation(@Param('id', ParseIntPipe) id: number) {
    await this.tariffRepo.delete(id);
    return { ok: true };
  }

  // ── Tariff configs (plan editor) ─────────────────────────────

  @Get('tariff-configs')
  getTariffConfigs() {
    return this.tariffConfigRepo.find({ order: { id: 'ASC' } });
  }

  @Put('tariff-configs/:id')
  async updateTariffConfig(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; price?: number; price_annual?: number | null; description?: string; is_active?: boolean },
  ) {
    await this.tariffConfigRepo.update(id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.price !== undefined && { price: body.price }),
      ...(body.price_annual !== undefined && { price_annual: body.price_annual }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.is_active !== undefined && { is_active: body.is_active }),
    });
    return this.tariffConfigRepo.findOne({ where: { id } });
  }

  // ── Templates (admin view) ───────────────────────────────────

  @Get('templates')
  async getTemplates() {
    const templates = await this.templatesRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    return templates.map(t => {
      let rows: any[] = [];
      try { const p = JSON.parse(t.meta); if (Array.isArray(p)) rows = p; } catch {}
      return {
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        userId: t.userId,
        userName: t.user?.name || null,
        userEmail: t.user?.email || null,
        files: t.files,
        views_count: t.views_count,
        used_count: t.used_count,
        scope: t.userId == null ? 'common' : 'user',
        is_active: t.is_active ?? true,
        rows,
      };
    });
  }

  @Get('templates-tree')
  async getTemplatesTree() {
    // Load all template-type folders + all templates with users
    const [folders, templates, users] = await Promise.all([
      this.foldersRepo.find({ where: { type: 'templates' }, order: { sort_order: 'ASC' } }),
      this.templatesRepo.find({ relations: ['user'], order: { createdAt: 'DESC' } }),
      this.usersRepo.find({ select: ['id', 'name', 'email'] }),
    ]);

    const userMap = new Map(users.map(u => [u.id, u]));

    // Build folder lookup by id
    const folderMap = new Map<number, any>();
    for (const f of folders) {
      folderMap.set(f.id, {
        id: f.id,
        name: f.name,
        parent_id: f.parent_id,
        owner_id: f.owner_id,
        children: [],
        items: [] as any[],
      });
    }

    // Wire children
    const rootFoldersByOwner = new Map<number, any[]>();
    for (const f of folders) {
      const node = folderMap.get(f.id)!;
      if (f.parent_id && folderMap.has(f.parent_id)) {
        folderMap.get(f.parent_id)!.children.push(node);
      } else {
        if (!rootFoldersByOwner.has(f.owner_id)) rootFoldersByOwner.set(f.owner_id, []);
        rootFoldersByOwner.get(f.owner_id)!.push(node);
      }
    }

    // Map templates to their folder or to "loose" by owner
    const looseByOwner = new Map<number | null, any[]>();
    for (const t of templates) {
      let rows: any[] = [];
      try { const p = JSON.parse(t.meta); if (Array.isArray(p)) rows = p; } catch {}
      const item = {
        id: t.id,
        name: t.name,
        userId: t.userId,
        userName: t.user?.name || null,
        userEmail: t.user?.email || null,
        folder_id: t.folder_id,
        createdAt: t.createdAt,
        scope: t.userId == null ? 'common' : 'user',
        is_active: t.is_active ?? true,
        rowCount: rows.filter(r => r.name || r.article).length,
        rows,
      };
      if (t.folder_id && folderMap.has(t.folder_id)) {
        folderMap.get(t.folder_id)!.items.push(item);
      } else {
        const ownerKey = t.userId ?? null;
        if (!looseByOwner.has(ownerKey)) looseByOwner.set(ownerKey, []);
        looseByOwner.get(ownerKey)!.push(item);
      }
    }

    // Build per-user tree
    const userIds = new Set<number>();
    folders.forEach(f => userIds.add(f.owner_id));
    templates.forEach(t => { if (t.userId) userIds.add(t.userId); });

    const result: any[] = [];
    for (const uid of userIds) {
      const u = userMap.get(uid);
      result.push({
        userId: uid,
        userName: u?.name || null,
        userEmail: u?.email || null,
        folders: rootFoldersByOwner.get(uid) || [],
        looseTemplates: looseByOwner.get(uid) || [],
      });
    }

    // Common templates (userId == null)
    const commonLoose = looseByOwner.get(null) || [];
    return {
      users: result.sort((a, b) => (a.userEmail || '').localeCompare(b.userEmail || '')),
      common: commonLoose,
    };
  }

  @Post('folders/:id/publish-as-common')
  async publishFolderAsCommon(@Param('id', ParseIntPipe) id: number) {
    // Recursively duplicate folder + all sub-folders + all templates as common (userId=null)
    const sourceFolder = await this.foldersRepo.findOne({ where: { id, type: 'templates' } });
    if (!sourceFolder) return { ok: false, error: 'Folder not found' };

    const cloneFolder = async (srcId: number, newParentId: number | null): Promise<number> => {
      const src = await this.foldersRepo.findOne({ where: { id: srcId } });
      if (!src) throw new Error('source missing');
      // Common folders are owned by the publisher (admin) but we mark by owner_id=0 convention?
      // Use parent's owner — but for "common" we want them visible to everyone.
      // Reuse same scheme: store with owner_id = 0 (special "common" owner)
      const created = await this.foldersRepo.save(this.foldersRepo.create({
        name: src.name,
        parent_id: newParentId,
        owner_id: 0,
        type: 'templates',
        sort_order: src.sort_order,
      }));

      // Clone templates inside
      const childTemplates = await this.templatesRepo.find({ where: { folder_id: srcId } });
      for (const t of childTemplates) {
        await this.templatesRepo.save(this.templatesRepo.create({
          name: t.name,
          meta: t.meta,
          userId: null as any,
          folder_id: created.id,
          files: 0,
          is_favorite: false,
          is_active: true,
          views_count: 0,
          used_count: 0,
        } as Partial<Template>));
      }

      // Recurse into sub-folders
      const subFolders = await this.foldersRepo.find({ where: { parent_id: srcId, type: 'templates' } });
      for (const sub of subFolders) {
        await cloneFolder(sub.id, created.id);
      }
      return created.id;
    };

    const newId = await cloneFolder(id, null);
    return { ok: true, id: newId };
  }

  @Post('templates/:id/publish')
  async publishTemplate(@Param('id', ParseIntPipe) id: number) {
    const original = await this.templatesRepo.findOne({ where: { id } });
    if (!original) throw new Error('Template not found');
    const copy = this.templatesRepo.create({
      name: original.name,
      meta: original.meta,
      userId: null as any,
      files: 0,
      is_favorite: false,
      is_active: true,
      views_count: 0,
      used_count: 0,
    } as Partial<Template>);
    const saved = await this.templatesRepo.save(copy) as unknown as Template;
    return { ok: true, id: saved.id };
  }

  @Patch('templates/:id/toggle-active')
  async toggleTemplateActive(@Param('id', ParseIntPipe) id: number) {
    const tpl = await this.templatesRepo.findOne({ where: { id } });
    if (!tpl) return { ok: false };
    tpl.is_active = !tpl.is_active;
    await this.templatesRepo.save(tpl);
    return { ok: true, is_active: tpl.is_active };
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id', ParseIntPipe) id: number) {
    await this.templatesRepo.delete(id);
    return { ok: true };
  }

  // ── Catalog stats ────────────────────────────────────────────

  @Get('pricelists')
  async getPricelists() {
    const pls = await this.plRepo.find({ relations: ['manufacturer'], order: { uploaded_at: 'DESC' } });

    const prodCounts = await this.prodRepo
      .createQueryBuilder('p')
      .select('p.manufacturer_id', 'mId')
      .addSelect('COUNT(p.id)', 'cnt')
      .where('p.is_active = true')
      .groupBy('p.manufacturer_id')
      .getRawMany();
    const prodMap = Object.fromEntries(prodCounts.map(r => [r.mId, Number(r.cnt)]));

    return pls.map(pl => ({
      ...pl,
      products_count: prodMap[pl.manufacturer_id] || 0,
    }));
  }

  @Get('tiles-stats')
  async getTilesStats() {
    const tiles = await this.tileRepo.find({ order: { sort_order: 'ASC' } });

    const topCatIds = await this.catRepo
      .createQueryBuilder('c')
      .select('c.id', 'id')
      .where('c.parent_id IS NULL')
      .getRawMany();

    const allProdCounts = await this.prodRepo
      .createQueryBuilder('p')
      .select('p.category_id', 'catId')
      .addSelect('COUNT(p.id)', 'cnt')
      .where('p.is_active = true')
      .groupBy('p.category_id')
      .getRawMany();
    const prodByCat = Object.fromEntries(allProdCounts.map(r => [r.catId, Number(r.cnt)]));

    return tiles;
  }

  @Patch('pricelists/:id/visit')
  async incrementPricelistVisit(@Param('id', ParseIntPipe) id: number) {
    await this.plRepo.increment({ id }, 'visit_count', 1);
    return { ok: true };
  }

  @Patch('tiles/:id/visit')
  async incrementTileVisit(@Param('id', ParseIntPipe) id: number) {
    await this.tileRepo.increment({ id }, 'visit_count', 1);
    return { ok: true };
  }

  // ── Stats ────────────────────────────────────────────────────

  @Get('stats')
  async getStats() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      users, projects, sheets, templates,
      priceListsActive, manufacturers, catalogProducts,
      newUsersToday, newUsersMonth, newProjectsToday, newProjectsMonth,
    ] = await Promise.all([
      this.usersRepo.count(),
      this.projectsRepo.count(),
      this.sheetsRepo.count(),
      this.templatesRepo.count(),
      this.plRepo.count({ where: { status: PriceListStatus.ACTIVE } }),
      this.manufRepo.count({ where: { is_active: true } }),
      this.prodRepo.count({ where: { is_active: true } }),
      this.usersRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: startOfDay }).getCount(),
      this.usersRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: startOfMonth }).getCount(),
      this.projectsRepo.createQueryBuilder('p').where('p.createdAt >= :d', { d: startOfDay }).getCount(),
      this.projectsRepo.createQueryBuilder('p').where('p.createdAt >= :d', { d: startOfMonth }).getCount(),
    ]);

    const topUsers = await this.projectsRepo
      .createQueryBuilder('p')
      .innerJoin('p.user', 'u')
      .select('u.email', 'email')
      .addSelect('COUNT(p.id)', 'count')
      .groupBy('u.email')
      .orderBy('count', 'DESC')
      .limit(5)
      .getRawMany();

    return {
      users, projects, sheets, templates, priceListsActive,
      manufacturers, catalogProducts,
      newUsersToday, newUsersMonth, newProjectsToday, newProjectsMonth,
      topUsers,
    };
  }
}
