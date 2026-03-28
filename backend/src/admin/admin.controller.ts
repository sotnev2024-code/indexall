import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, ParseIntPipe, ParseEnumPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { User, UserPlan, UserStatus } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import {
  PriceList, PriceListStatus, Manufacturer,
  CatalogProduct, CatalogTile, CatalogCategory,
} from '../catalog/entities/catalog.entities';
import { TariffOperation } from './tariff-operation.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Project) private projectsRepo: Repository<Project>,
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(Template) private templatesRepo: Repository<Template>,
    @InjectRepository(PriceList) private plRepo: Repository<PriceList>,
    @InjectRepository(Manufacturer) private manufRepo: Repository<Manufacturer>,
    @InjectRepository(CatalogProduct) private prodRepo: Repository<CatalogProduct>,
    @InjectRepository(CatalogTile) private tileRepo: Repository<CatalogTile>,
    @InjectRepository(CatalogCategory) private catRepo: Repository<CatalogCategory>,
    @InjectRepository(TariffOperation) private tariffRepo: Repository<TariffOperation>,
  ) {}

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

  // ── Templates (admin view) ───────────────────────────────────

  @Get('templates')
  async getTemplates() {
    const templates = await this.templatesRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    return templates.map(t => ({
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
    }));
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
