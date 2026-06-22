import {
  Controller, Get, Post, Patch, Delete, Put,
  Param, Body, Query, UseGuards, ParseIntPipe, ParseEnumPipe, OnModuleInit,
  BadRequestException, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

const tariffImageStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (_, file, cb) => cb(null, `tariff-${Date.now()}${extname(file.originalname)}`),
});

const onboardingMediaStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (_, file, cb) => cb(null, `onboarding-${Date.now()}${extname(file.originalname)}`),
});

/** Cyrillic → Latin transliteration for auto-generating plan_keys when the
 *  admin doesn't supply one. Matches the public ГОСТ-7.79 system A subset. */
const CYR_TO_LAT: Record<string, string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};
function slugifyForPlanKey(name: string): string {
  return name
    .toLowerCase()
    .split('')
    .map(c => CYR_TO_LAT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'tariff';
}
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { User, UserPlan, UserStatus } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import { Folder } from '../folders/folder.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import {
  PriceList, PriceListStatus, Manufacturer,
  CatalogProduct, CatalogTile, CatalogCategory,
} from '../catalog/entities/catalog.entities';
import { TariffOperation } from './tariff-operation.entity';
import { TariffConfig } from './tariff-config.entity';
import { AppSetting } from './app-setting.entity';
import { UserActivityLog } from './user-activity-log.entity';

/** Seed tariffs created on first start. After that the table is admin-managed
 *  (CRUD via admin API). The init logic only ADDS missing seeds — it never
 *  resets prices or durations the admin has customised. */
const DEFAULT_TARIFF_CONFIGS = [
  {
    plan_key: 'pro',
    name: 'Базовый (1 месяц)',
    price: 4990,
    duration_value: 30,
    duration_unit: 'day',
    description: 'Полный доступ ко всем функциям на 30 дней.',
    sort_order: 10,
    is_active: true,
  },
  {
    plan_key: 'pro_year',
    name: 'Базовый (1 год)',
    price: 49900,
    duration_value: 365,
    duration_unit: 'day',
    description: 'Полный доступ ко всем функциям на 1 год. Экономия по сравнению с месячной подпиской.',
    sort_order: 20,
    is_active: true,
  },
  {
    plan_key: 'trial',
    name: 'Пробный',
    price: 0,
    duration_value: 7,
    duration_unit: 'day',
    description: '7 дней полного доступа ко всем функциям. Бесплатно, только один раз.',
    sort_order: 1,
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
    @InjectRepository(AppSetting) private settingsRepo: Repository<AppSetting>,
    @InjectRepository(UserActivityLog) private activityRepo: Repository<UserActivityLog>,
    @InjectRepository(EquipmentRow) private equipmentRowsRepo: Repository<EquipmentRow>,
  ) {}

  async onModuleInit() {
    // Seed only — never overwrite admin-customised data. Specifically:
    //   · create missing default plan_keys.
    //   · backfill duration_value/duration_unit for legacy 'pro' rows that
    //     pre-date these columns (would default to 30d, but old data may
    //     have nulls).
    //   · if the legacy 'pro' row carries a non-zero price_annual but
    //     'pro_year' doesn't exist yet → create 'pro_year' from that price.
    for (const cfg of DEFAULT_TARIFF_CONFIGS) {
      const exists = await this.tariffConfigRepo.findOne({ where: { plan_key: cfg.plan_key } });
      if (!exists) {
        await this.tariffConfigRepo.save(this.tariffConfigRepo.create(cfg));
      }
    }

    // One-time migration: lift price_annual into a separate 'pro_year' tariff.
    const legacyPro = await this.tariffConfigRepo.findOne({ where: { plan_key: 'pro' } });
    const proYear = await this.tariffConfigRepo.findOne({ where: { plan_key: 'pro_year' } });
    if (legacyPro && legacyPro.price_annual && (!proYear || Number(proYear.price) === 49900)) {
      // proYear was just seeded with the default 49900 — replace with the
      // admin's previously configured annual price.
      if (proYear) {
        await this.tariffConfigRepo.update(proYear.id, { price: legacyPro.price_annual });
      }
      // Clear the legacy column so we don't re-run this on every restart.
      await this.tariffConfigRepo.update(legacyPro.id, { price_annual: null });
    }
  }

  // ── Users ────────────────────────────────────────────────────

  @Get('users')
  async getUsers() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
    // Projects on the user's "All projects" page are now stored in two tables:
    // legacy `projects` and the new `folders` with type='projects'. Counting
    // only `projects` was understating real numbers (Максим увидел 3 вместо 7).
    const counts: { userId: number; projects: string }[] = await this.projectsRepo.manager.query(`
      SELECT uid AS "userId", COUNT(DISTINCT pid)::int AS projects
      FROM (
        SELECT id AS pid, "userId" AS uid FROM projects
        UNION
        SELECT id AS pid, owner_id AS uid FROM folders WHERE type = 'projects'
      ) x
      GROUP BY uid
    `);
    // A sheet can belong to a user via 3 paths: direct owner_id, through a
    // project (legacy), or through a folder (new model). Old query only
    // covered the project path, so админ-статистика занижала листы у тех,
    // кто работал в папках. Union them and count distinct sheet ids.
    const sheetCounts: { userId: number; sheets: string }[] = await this.sheetsRepo.manager.query(`
      SELECT uid AS "userId", COUNT(DISTINCT sid)::int AS sheets
      FROM (
        SELECT id AS sid, owner_id AS uid FROM sheets WHERE owner_id IS NOT NULL
        UNION
        SELECT s.id AS sid, p."userId" AS uid FROM sheets s JOIN projects p ON p.id = s."projectId" WHERE s."projectId" IS NOT NULL
        UNION
        SELECT s.id AS sid, f.owner_id AS uid FROM sheets s JOIN folders f ON f.id = s.folder_id WHERE s.folder_id IS NOT NULL
      ) x
      GROUP BY uid
    `);
    const projectMap = Object.fromEntries(counts.map(r => [r.userId, Number(r.projects)]));
    const sheetMap = Object.fromEntries(sheetCounts.map(r => [r.userId, Number(r.sheets)]));

    return users.map(({ password, ...safe }) => ({
      ...safe,
      projects_count: projectMap[safe.id] || 0,
      sheets_count: sheetMap[safe.id] || 0,
    }));
  }

  @Get('users/:id/projects')
  async getUserProjects(@Param('id', ParseIntPipe) id: number) {
    const [folders, sheets] = await Promise.all([
      this.foldersRepo.find({
        where: { owner_id: id },
        order: { sort_order: 'ASC', createdAt: 'ASC' },
      }),
      this.sheetsRepo.find({
        where: { owner_id: id },
        order: { sort_order: 'ASC', createdAt: 'ASC' },
        select: ['id', 'name', 'createdAt', 'updatedAt', 'owner_id', 'folder_id'],
      }),
    ]);
    return { folders, sheets };
  }

  @Get('sheets/:id/rows')
  async getSheetRows(@Param('id', ParseIntPipe) id: number) {
    const sheet = await this.sheetsRepo.findOne({ where: { id } });
    if (!sheet) throw new BadRequestException('Лист не найден');
    const rows = await this.equipmentRowsRepo.find({
      where: { sheetId: id },
      order: { sort_order: 'ASC' },
    });
    return { sheet, rows };
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

  /** Admin: set a new password for any user (for lost-password recovery by support) */
  @Patch('users/:id/password')
  async updatePassword(
    @Param('id', ParseIntPipe) id: number,
    @Body('newPassword') newPassword: string,
  ) {
    if (!newPassword || newPassword.length < 6) {
      throw new Error('Пароль должен быть не короче 6 символов');
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(newPassword, 10);
    await this.usersRepo.update(id, { password: hash });
    return { success: true };
  }

  // ── Delete user (with all data) ──────────────────────────────

  @Delete('users/:id')
  async deleteUser(@Param('id', ParseIntPipe) id: number) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new BadRequestException('Пользователь не найден');
    if (user.plan === 'admin') throw new BadRequestException('Нельзя удалить администратора');
    // CASCADE rules on DB handle sheets, equipment_rows, folders, tariff_operations, etc.
    await this.usersRepo.delete(id);
    return { deleted: true, id };
  }

  // ── Conversions ──────────────────────────────────────────────

  @Get('conversions')
  async getConversions() {
    const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });

    // Same reasoning as in getUsers — count projects from BOTH `projects`
    // and project-typed folders, otherwise users on the new folder model
    // appear to have 0 projects.
    const projectCounts: { userId: number; cnt: string }[] = await this.projectsRepo.manager.query(`
      SELECT uid AS "userId", COUNT(DISTINCT pid)::int AS cnt
      FROM (
        SELECT id AS pid, "userId" AS uid FROM projects
        UNION
        SELECT id AS pid, owner_id AS uid FROM folders WHERE type = 'projects'
      ) x
      GROUP BY uid
    `);
    const pMap = Object.fromEntries(projectCounts.map(r => [r.userId, Number(r.cnt)]));

    // Same triple-source counting as in getUsers — listов в папках раньше
    // не было видно, потому что считали только через projects-join.
    const sheetCounts: { userId: number; cnt: string }[] = await this.sheetsRepo.manager.query(`
      SELECT uid AS "userId", COUNT(DISTINCT sid)::int AS cnt
      FROM (
        SELECT id AS sid, owner_id AS uid FROM sheets WHERE owner_id IS NOT NULL
        UNION
        SELECT s.id AS sid, p."userId" AS uid FROM sheets s JOIN projects p ON p.id = s."projectId" WHERE s."projectId" IS NOT NULL
        UNION
        SELECT s.id AS sid, f.owner_id AS uid FROM sheets s JOIN folders f ON f.id = s.folder_id WHERE s.folder_id IS NOT NULL
      ) x
      GROUP BY uid
    `);
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

    // Users who have configured ETM iPRO integration (saved login/password
    // via Профиль → ЭТМ). Raw SQL because EtmCredential isn't bound to this
    // module's TypeORM scope.
    const etmCredRows: { user_id: number }[] = await this.usersRepo.manager.query(
      `SELECT DISTINCT user_id FROM etm_credentials WHERE user_id IS NOT NULL`,
    ).catch(() => []);
    const etmSet = new Set<number>(etmCredRows.map(r => Number(r.user_id)));

    // Users who actually paid (succeeded YooKassa payment recorded as a
    // tariff_operation with operator='YooKassa'). Distinguishes paying
    // customers from trial-only / admin-granted plans.
    const paidRows: { userId: number }[] = await this.tariffRepo.manager.query(
      `SELECT DISTINCT "userId" FROM tariff_operations WHERE operator ILIKE 'yookassa%' OR operator ILIKE 'юкасса%'`,
    ).catch(() => []);
    const paidSet = new Set<number>(paidRows.map(r => Number(r.userId)));

    return users.map(({ password, ...u }) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      // Шаг 1 — регистрация: всё, что в этой выборке, по определению зареган.
      step1: !!u.createdAt,
      // Шаг 2 — подтверждение email.
      step2: u.emailVerified,
      // Шаг 3 — создал хоть один проект (legacy projects + folders type=projects).
      step3: (pMap[u.id] || 0) > 0,
      // Trial: «когда-либо активировал триал». Использует флаг users.trialUsed,
      // который ставится в /auth/trial и не сбрасывается при истечении срока.
      // Раньше колонка проверяла только текущий plan='trial' и врала после
      // окончания пробного.
      trial: !!u.trialUsed,
      templates: tMap[u.id] || 0,
      projects: pMap[u.id] || 0,
      specs: sMap[u.id] || 0,
      // ЭТМ — есть ли сохранённая интеграция iPRO в etm_credentials.
      etm: etmSet.has(u.id),
      // Рус.св. — отдельная интеграция магазина Русский Свет в проект пока
      // не заведена; колонка возвращает false для всех до её появления.
      rusSv: false,
      tariffs: trMap[u.id] || 0,
      // Акция/промо — реальное событие «оплатил тариф через ЮKassa».
      // Раньше просто стояло `false` для всех. Промокодов как сущности
      // у нас нет, поэтому используем сам факт состоявшейся покупки.
      promo: paidSet.has(u.id),
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

  // ── App settings (key/value flags) ───────────────────────────

  /** Returns all admin-controlled flags. Each value is a string — bool flags
   *  use 'true'/'false', everything else is plain text. The frontend admin
   *  toggle reads this to render its initial state. */
  @Get('settings')
  async getSettings() {
    const rows = await this.settingsRepo.find();
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  }

  @Put('settings/:key')
  async setSetting(
    @Param('key') key: string,
    @Body() body: { value: string },
  ) {
    if (!key || !/^[a-z0-9_-]+$/i.test(key)) {
      throw new BadRequestException('Недопустимый ключ настройки');
    }
    const value = String(body?.value ?? '');
    const existing = await this.settingsRepo.findOne({ where: { key } });
    if (existing) {
      await this.settingsRepo.update({ key }, { value });
    } else {
      await this.settingsRepo.save(this.settingsRepo.create({ key, value }));
    }
    return { key, value };
  }

  /** Upload an onboarding slide image or video. Returns the stored filename
   *  and mimetype; the admin UI builds the public /uploads/<file> URL and
   *  stores it inside the `onboarding_slides` JSON setting. */
  @Post('onboarding-media')
  @UseInterceptors(FileInterceptor('file', {
    storage: onboardingMediaStorage,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!/^(image|video)\//.test(file.mimetype)) {
        return cb(new BadRequestException('Допустимы только изображения или видео'), false);
      }
      cb(null, true);
    },
  }))
  async uploadOnboardingMedia(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return { path: file.path, filename: file.filename, mimetype: file.mimetype };
  }

  // ── Tariff configs (plan editor) ─────────────────────────────

  @Get('tariff-configs')
  getTariffConfigs() {
    return this.tariffConfigRepo.find({ order: { sort_order: 'ASC', id: 'ASC' } });
  }

  /** Batch save reorder + parent reassignment from the tile manager.
   *  Frontend sends the full visible ordering (top-level + sub-blocks);
   *  we update sort_order/parent_id in one round-trip.
   *  Declared BEFORE `/:id` routes so the literal `reorder` path wins. */
  @Put('tariff-configs/reorder')
  async reorderTariffConfigs(@Body() body: { items: Array<{ id: number; sort_order: number; parent_id: number | null }> }) {
    if (!body || !Array.isArray(body.items)) {
      throw new BadRequestException('Ожидается массив items');
    }
    for (const it of body.items) {
      if (!Number.isFinite(Number(it.id))) continue;
      await this.tariffConfigRepo.update(Number(it.id), {
        sort_order: Number(it.sort_order) || 0,
        parent_id: it.parent_id == null ? null : Number(it.parent_id),
      });
    }
    return { success: true };
  }

  /** Create a new tariff. plan_key is now auto-generated from the name when
   *  not supplied (the admin UI no longer asks for it — clients found it
   *  one extra field of friction). plan_key still doubles as YooKassa
   *  metadata.planKey, so we ensure uniqueness via _2/_3 suffixes. */
  @Post('tariff-configs')
  async createTariffConfig(@Body() body: {
    plan_key?: string;
    name: string;
    price: number;
    duration_value: number;
    duration_unit: 'day' | 'month';
    description?: string;
    is_active?: boolean;
    sort_order?: number;
    width?: number;
    height?: number;
    parent_id?: number | null;
    max_activations_per_user?: number;
  }) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('Название обязательно');
    }
    if (!Number.isFinite(Number(body.price)) || Number(body.price) < 0) {
      throw new BadRequestException('Цена должна быть неотрицательным числом');
    }
    if (!Number.isFinite(Number(body.duration_value)) || Number(body.duration_value) <= 0) {
      throw new BadRequestException('Срок должен быть положительным числом');
    }
    if (!['day', 'month'].includes(body.duration_unit)) {
      throw new BadRequestException('Единица срока — "day" или "month"');
    }

    // Resolve plan_key: explicit (legacy callers / bot integrations) or auto.
    let planKey = (body.plan_key || '').trim().toLowerCase();
    if (planKey && !/^[a-z0-9_]+$/.test(planKey)) {
      throw new BadRequestException('plan_key должен содержать только латиницу, цифры и подчёркивания');
    }
    if (!planKey) {
      const base = slugifyForPlanKey(body.name);
      planKey = base;
      let n = 2;
      // Cheap dedup loop — at scale this is fine (admin creates a handful).
      while (await this.tariffConfigRepo.findOne({ where: { plan_key: planKey } })) {
        planKey = `${base}_${n++}`;
        if (n > 999) throw new BadRequestException('Не удалось сгенерировать plan_key');
      }
    } else {
      const existing = await this.tariffConfigRepo.findOne({ where: { plan_key: planKey } });
      if (existing) throw new BadRequestException(`Тариф с ключом '${planKey}' уже существует`);
    }

    const created = await this.tariffConfigRepo.save(this.tariffConfigRepo.create({
      plan_key: planKey,
      name: body.name.trim(),
      price: Number(body.price),
      duration_value: Math.floor(Number(body.duration_value)),
      duration_unit: body.duration_unit,
      description: body.description ?? null,
      is_active: body.is_active ?? true,
      sort_order: body.sort_order ?? 100,
      width: body.width != null ? Math.max(1, Math.min(2, Math.floor(Number(body.width)))) : 1,
      height: body.height != null ? Math.max(1, Math.min(4, Math.floor(Number(body.height)))) : 3,
      parent_id: body.parent_id ?? null,
      max_activations_per_user: body.max_activations_per_user != null ? Math.max(0, Math.floor(Number(body.max_activations_per_user))) : 0,
    }));
    return created;
  }

  @Put('tariff-configs/:id')
  async updateTariffConfig(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      name?: string;
      price?: number;
      price_annual?: number | null;
      duration_value?: number;
      duration_unit?: 'day' | 'month';
      description?: string;
      is_active?: boolean;
      sort_order?: number;
      width?: number;
      height?: number;
      parent_id?: number | null;
      max_activations_per_user?: number;
    },
  ) {
    if (body.duration_unit && !['day', 'month'].includes(body.duration_unit)) {
      throw new BadRequestException('Единица срока — "day" или "month"');
    }
    if (body.duration_value !== undefined &&
        (!Number.isFinite(Number(body.duration_value)) || Number(body.duration_value) <= 0)) {
      throw new BadRequestException('Срок должен быть положительным числом');
    }
    if (body.price !== undefined &&
        (!Number.isFinite(Number(body.price)) || Number(body.price) < 0)) {
      throw new BadRequestException('Цена должна быть неотрицательным числом');
    }
    await this.tariffConfigRepo.update(id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.price !== undefined && { price: Number(body.price) }),
      ...(body.price_annual !== undefined && { price_annual: body.price_annual }),
      ...(body.duration_value !== undefined && { duration_value: Math.floor(Number(body.duration_value)) }),
      ...(body.duration_unit !== undefined && { duration_unit: body.duration_unit }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.is_active !== undefined && { is_active: body.is_active }),
      ...(body.sort_order !== undefined && { sort_order: body.sort_order }),
      ...(body.width !== undefined && { width: Math.max(1, Math.min(2, Math.floor(Number(body.width)))) }),
      ...(body.height !== undefined && { height: Math.max(1, Math.min(4, Math.floor(Number(body.height)))) }),
      ...(body.parent_id !== undefined && { parent_id: body.parent_id }),
      ...(body.max_activations_per_user !== undefined && { max_activations_per_user: Math.max(0, Math.floor(Number(body.max_activations_per_user))) }),
    });
    return this.tariffConfigRepo.findOne({ where: { id } });
  }

  /** Upload a cover image for a tariff (rendered as the tile background). */
  @Post('tariff-configs/:id/image')
  @UseInterceptors(FileInterceptor('file', { storage: tariffImageStorage }))
  async uploadTariffImage(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Файл не загружен');
    const cfg = await this.tariffConfigRepo.findOne({ where: { id } });
    if (!cfg) throw new BadRequestException('Тариф не найден');
    if (cfg.image_path) {
      // Best-effort cleanup of the old file. Don't fail the request if the
      // file is already gone (e.g. uploads dir was wiped between deploys).
      try { fs.unlinkSync(cfg.image_path); } catch {}
    }
    await this.tariffConfigRepo.update(id, { image_path: file.path });
    return this.tariffConfigRepo.findOne({ where: { id } });
  }

  /** Remove the cover image — clears image_path and best-effort unlinks the
   *  file. The tile then falls back to the dark text-on-card rendering. */
  @Delete('tariff-configs/:id/image')
  async deleteTariffImage(@Param('id', ParseIntPipe) id: number) {
    const cfg = await this.tariffConfigRepo.findOne({ where: { id } });
    if (!cfg) throw new BadRequestException('Тариф не найден');
    if (cfg.image_path) {
      try { fs.unlinkSync(cfg.image_path); } catch {}
    }
    await this.tariffConfigRepo.update(id, { image_path: null });
    return this.tariffConfigRepo.findOne({ where: { id } });
  }


  /** Soft delete: marks the tariff inactive so existing user subscriptions
   *  remain valid until expiry but new purchases are no longer offered. */
  @Delete('tariff-configs/:id')
  async deleteTariffConfig(@Param('id', ParseIntPipe) id: number) {
    const cfg = await this.tariffConfigRepo.findOne({ where: { id } });
    if (!cfg) throw new BadRequestException('Тариф не найден');
    // The trial seed shouldn't be deletable — it's wired into /auth/trial
    // and expected to exist by name elsewhere.
    if (cfg.plan_key === 'trial') {
      throw new BadRequestException('Пробный тариф нельзя удалить, можно только деактивировать');
    }
    await this.tariffConfigRepo.update(id, { is_active: false });
    return { success: true, soft_deleted: true };
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
      users, projects, projectFolders, sheets, templates,
      priceListsActive, manufacturers, catalogProducts,
      newUsersToday, newUsersMonth, newProjectsToday, newProjectsMonth,
      newFoldersToday, newFoldersMonth,
    ] = await Promise.all([
      this.usersRepo.count(),
      this.projectsRepo.count(),
      this.foldersRepo.count({ where: { type: 'projects' } }),
      this.sheetsRepo.count(),
      this.templatesRepo.count(),
      this.plRepo.count({ where: { status: PriceListStatus.ACTIVE } }),
      this.manufRepo.count({ where: { is_active: true } }),
      this.prodRepo.count({ where: { is_active: true } }),
      this.usersRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: startOfDay }).getCount(),
      this.usersRepo.createQueryBuilder('u').where('u.createdAt >= :d', { d: startOfMonth }).getCount(),
      this.projectsRepo.createQueryBuilder('p').where('p.createdAt >= :d', { d: startOfDay }).getCount(),
      this.projectsRepo.createQueryBuilder('p').where('p.createdAt >= :d', { d: startOfMonth }).getCount(),
      this.foldersRepo.createQueryBuilder('f').where('f.type = :t AND f.createdAt >= :d', { t: 'projects', d: startOfDay }).getCount(),
      this.foldersRepo.createQueryBuilder('f').where('f.type = :t AND f.createdAt >= :d', { t: 'projects', d: startOfMonth }).getCount(),
    ]);

    // Top users by combined projects+folders count, mirroring the user-facing
    // "All projects" page where both kinds of containers show up.
    const topUsers: { email: string; count: string }[] = await this.projectsRepo.manager.query(`
      SELECT u.email AS email, COUNT(DISTINCT pid)::int AS count
      FROM (
        SELECT id AS pid, "userId" AS uid FROM projects
        UNION
        SELECT id AS pid, owner_id AS uid FROM folders WHERE type = 'projects'
      ) x
      JOIN users u ON u.id = x.uid
      GROUP BY u.email
      ORDER BY count DESC
      LIMIT 5
    `);

    return {
      users,
      // Total projects = legacy `projects` rows + new project-folders.
      projects: projects + projectFolders,
      sheets, templates, priceListsActive,
      manufacturers, catalogProducts,
      newUsersToday, newUsersMonth,
      // "Created today/month" likewise spans both tables.
      newProjectsToday: newProjectsToday + newFoldersToday,
      newProjectsMonth: newProjectsMonth + newFoldersMonth,
      topUsers,
    };
  }

  // ── Activity Log ─────────────────────────────────────────────

  @Get('activity-log')
  async getActivityLog(
    @Query('userId') userIdStr?: string,
    @Query('action') action?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const limit = Math.min(parseInt(limitStr || '100', 10), 500);
    const skip = parseInt(offsetStr || '0', 10);

    const qb = this.activityRepo.createQueryBuilder('log')
      .leftJoin('log.user', 'u')
      .addSelect(['u.id', 'u.email', 'u.name'])
      .orderBy('log.createdAt', 'DESC')
      .take(limit)
      .skip(skip);

    if (userIdStr) qb.andWhere('log.userId = :uid', { uid: parseInt(userIdStr, 10) });
    if (action) qb.andWhere('log.action = :action', { action });
    if (dateFrom) qb.andWhere('log.createdAt >= :from', { from: new Date(dateFrom) });
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      qb.andWhere('log.createdAt <= :to', { to });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  // ── Activity Stats ────────────────────────────────────────────

  @Get('activity-stats')
  async getActivityStats() {
    // Group by action and count, for the last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const rows: { action: string; cnt: string }[] = await this.activityRepo
      .createQueryBuilder('log')
      .select('log.action', 'action')
      .addSelect('COUNT(*)', 'cnt')
      .where('log.createdAt >= :since', { since })
      .groupBy('log.action')
      .getRawMany();

    const map: Record<string, number> = {};
    for (const r of rows) map[r.action] = parseInt(r.cnt, 10);

    // Total users registered (all time)
    const totalUsers = await this.usersRepo.count();
    // Users registered in last 30 days
    const last30 = new Date(); last30.setDate(last30.getDate() - 30);
    const newUsers30 = await this.usersRepo.count({ where: { createdAt: require('typeorm').MoreThan(last30) } });

    return { byAction: map, totalUsers, newUsers30 };
  }

  // ── Demo template (shown to every new user after registration) ────────────

  @Get('demo-template')
  async getDemoTemplate() {
    const t = await this.templatesRepo.findOne({ where: { is_default: true } as any });
    if (!t) return null;
    let rows: any[] = [];
    try { const p = JSON.parse(t.meta); if (Array.isArray(p)) rows = p; } catch {}
    return { ...t, rows };
  }

  @Patch('demo-template/:id')
  async setDemoTemplate(@Param('id', ParseIntPipe) id: number) {
    const target = await this.templatesRepo.findOne({ where: { id } });
    if (!target) throw new BadRequestException('Шаблон не найден');
    await this.templatesRepo.update({ is_default: true } as any, { is_default: false } as any);
    await this.templatesRepo.update(id, { is_default: true } as any);
    let rows: any[] = [];
    try { const p = JSON.parse(target.meta); if (Array.isArray(p)) rows = p; } catch {}
    return { ...target, is_default: true, rows };
  }
}
