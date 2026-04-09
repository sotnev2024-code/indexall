import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Folder } from './folder.entity';
import { Sheet } from '../sheets/sheet.entity';
import { Template } from '../templates/template.entity';
import { Project } from '../projects/project.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';

@Injectable()
export class FoldersService implements OnModuleInit {
  private readonly logger = new Logger(FoldersService.name);

  constructor(
    @InjectRepository(Folder) private foldersRepo: Repository<Folder>,
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(Template) private templatesRepo: Repository<Template>,
    @InjectRepository(Project) private projectsRepo: Repository<Project>,
    @InjectRepository(EquipmentRow) private rowsRepo: Repository<EquipmentRow>,
  ) {}

  /** Auto-migrate existing projects → folders on startup */
  async onModuleInit() {
    try {
      await this.migrateProjectsToFolders();
    } catch (e) {
      this.logger.error('Migration projects→folders failed: ' + e?.message);
    }
  }

  private async migrateProjectsToFolders() {
    const projects = await this.projectsRepo.find({
      relations: ['sheets'],
      order: { sort_order: 'ASC', createdAt: 'ASC' },
    });

    for (const project of projects) {
      // Find if a folder already exists for this project (migration ran before)
      const existing = await this.foldersRepo.findOne({
        where: { owner_id: project.userId, type: 'projects' },
      });

      // Check sheets that still belong to this project but have no folder_id
      const unmigratedSheets = (project.sheets || []).filter(
        (s) => !s.folder_id,
      );

      if (unmigratedSheets.length === 0) continue;

      // Find or create a root folder for this project
      let folder = await this.foldersRepo.findOne({
        where: {
          owner_id: project.userId,
          type: 'projects',
          parent_id: IsNull(),
          name: project.name,
        },
      });

      if (!folder) {
        folder = await this.foldersRepo.save({
          name: project.name,
          parent_id: null,
          owner_id: project.userId,
          type: 'projects',
          sort_order: project.sort_order,
        });
      }

      // Assign folder_id to all unmigrated sheets
      for (const sheet of unmigratedSheets) {
        await this.sheetsRepo.update(sheet.id, { folder_id: folder.id });
      }
    }

    this.logger.log('Projects→folders migration complete');
  }

  // ── Tree ──────────────────────────────────────────────────────

  async getTree(userId: number, type: string) {
    // Load all folders of this type for this user
    const folders = await this.foldersRepo.find({
      where: { owner_id: userId, type },
      order: { sort_order: 'ASC', createdAt: 'ASC' },
    });

    // Load root-level items (not in any folder)
    let rootItems: any[] = [];
    if (type === 'projects') {
      const sheets = await this.sheetsRepo.find({
        where: { owner_id: userId, folder_id: IsNull() },
        relations: ['rows'],
        order: { sort_order: 'ASC', createdAt: 'ASC' },
      });
      rootItems = sheets.map((s) => this.enrichSheet(s));
    } else {
      const rawTpls = await this.templatesRepo.find({
        where: { userId, folder_id: IsNull() },
        order: { createdAt: 'ASC' },
      });
      rootItems = rawTpls.map(t => this.enrichTemplate(t));
    }

    const children = await this.buildTree(folders, null, userId, type);
    return { children, items: rootItems };
  }

  private async buildTree(
    allFolders: Folder[],
    parentId: number | null,
    userId: number,
    type: string,
  ): Promise<any[]> {
    const children = allFolders.filter((f) => f.parent_id === parentId);
    const result: any[] = [];

    for (const folder of children) {
      // Load sheets/templates in this folder
      let folderItems: any[] = [];
      if (type === 'projects') {
        const sheets = await this.sheetsRepo.find({
          where: { folder_id: folder.id },
          relations: ['rows'],
          order: { sort_order: 'ASC', createdAt: 'ASC' },
        });
        folderItems = sheets.map((s) => this.enrichSheet(s));
      } else {
        const rawTpls = await this.templatesRepo.find({
          where: { userId, folder_id: folder.id },
          order: { createdAt: 'ASC' },
        });
        folderItems = rawTpls.map(t => this.enrichTemplate(t));
      }

      const subFolders = await this.buildTree(
        allFolders,
        folder.id,
        userId,
        type,
      );

      result.push({
        ...folder,
        children: subFolders,
        items: folderItems,
      });
    }

    return result;
  }

  private enrichTemplate(t: any) {
    let rows: any[] = [];
    try { const parsed = JSON.parse(t.meta); if (Array.isArray(parsed)) rows = parsed; } catch {}
    return { ...t, rows, scope: t.userId == null ? 'common' : 'my' };
  }

  private enrichSheet(s: any) {
    const total = (s.rows || []).reduce(
      (sum: number, r: any) =>
        sum +
        parseFloat(r.price || '0') *
          parseFloat(r.qty || '0') *
          parseFloat(r.coef || '1'),
      0,
    );
    const { rows, ...rest } = s;
    return { ...rest, total };
  }

  // ── Single folder with sheets (for spec page tabs) ────────────

  async getFolderWithSheets(folderId: number, userId: number) {
    const folder = await this.checkOwner(folderId, userId);
    const sheets = await this.sheetsRepo.find({
      where: { folder_id: folderId },
      relations: ['rows'],
      order: { sort_order: 'ASC', createdAt: 'ASC' },
    });
    const enriched = sheets.map((s) => this.enrichSheet(s));
    const total = enriched.reduce((sum, s) => sum + (s.total || 0), 0);
    return { ...folder, sheets: enriched, total };
  }

  // ── CRUD ──────────────────────────────────────────────────────

  async createFolder(
    userId: number,
    name: string,
    parent_id: number | null,
    type: string,
  ) {
    if (parent_id) {
      await this.checkOwner(parent_id, userId);
    }
    const count = await this.foldersRepo.count({
      where: {
        owner_id: userId,
        type,
        parent_id: parent_id ?? IsNull(),
      },
    });
    const folder = await this.foldersRepo.save({
      name,
      parent_id: parent_id ?? null,
      owner_id: userId,
      type,
      sort_order: count,
    });
    return folder;
  }

  async renameFolder(id: number, userId: number, name: string) {
    await this.checkOwner(id, userId);
    await this.foldersRepo.update(id, { name });
    return this.foldersRepo.findOne({ where: { id } });
  }

  async moveFolder(id: number, userId: number, parent_id: number | null) {
    await this.checkOwner(id, userId);
    if (parent_id) {
      await this.checkOwner(parent_id, userId);
      // Prevent circular: make sure the new parent isn't a descendant
      const descendants = await this.getDescendantIds(id);
      if (descendants.includes(parent_id)) {
        throw new ForbiddenException('Нельзя переместить папку в её подпапку');
      }
    }
    await this.foldersRepo.update(id, { parent_id: parent_id ?? null });
    return this.foldersRepo.findOne({ where: { id } });
  }

  async deleteFolder(id: number, userId: number) {
    await this.checkOwner(id, userId);
    // CASCADE in DB handles children folders + sheets/templates via their folder_id FK
    await this.foldersRepo.delete(id);
    return { success: true };
  }

  async reorderFolders(userId: number, ids: number[]) {
    for (let i = 0; i < ids.length; i++) {
      await this.foldersRepo.update({ id: ids[i], owner_id: userId }, { sort_order: i });
    }
    return { ok: true };
  }

  // ── Sheet management ──────────────────────────────────────────

  async createSheet(folderId: number, userId: number, name?: string) {
    await this.checkOwner(folderId, userId);
    const count = await this.sheetsRepo.count({ where: { folder_id: folderId } });

    const sheet = await this.sheetsRepo.save({
      folder_id: folderId,
      owner_id: userId,
      name: name || `Спецификация${count + 1}`,
    });

    const rows = Array.from({ length: 25 }, () => ({
      sheetId: sheet.id,
      name: '',
      brand: '',
      article: '',
      qty: '0',
      unit: 'шт',
      price: '0',
      store: '',
      coef: '1',
      total: '0',
    }));
    await this.rowsRepo.save(rows);

    const full = await this.sheetsRepo.findOne({
      where: { id: sheet.id },
      relations: ['rows'],
    });
    return this.enrichSheet(full!);
  }

  async moveSheet(sheetId: number, userId: number, folderId: number) {
    await this.checkSheetOwner(sheetId, userId);
    await this.checkOwner(folderId, userId);
    await this.sheetsRepo.update(sheetId, { folder_id: folderId });
    return { success: true };
  }

  async reorderSheets(folderId: number, userId: number, ids: number[]) {
    await this.checkOwner(folderId, userId);
    for (let i = 0; i < ids.length; i++) {
      await this.sheetsRepo.update({ id: ids[i], folder_id: folderId }, { sort_order: i });
    }
    return { ok: true };
  }

  // ── Template management ───────────────────────────────────────

  async moveTemplate(templateId: number, userId: number, folderId: number | null) {
    const tpl = await this.templatesRepo.findOne({ where: { id: templateId } });
    if (!tpl) throw new NotFoundException('Шаблон не найден');
    if (tpl.userId !== userId) throw new ForbiddenException('Нет доступа');
    if (folderId) await this.checkOwner(folderId, userId);
    await this.templatesRepo.update(templateId, { folder_id: folderId ?? null });
    return { success: true };
  }

  // ── Save as template ─────────────────────────────────────────

  /** Save a project sheet as a template entry */
  async saveSheetAsTemplate(
    sheetId: number,
    userId: number,
    name: string,
    templateFolderId?: number | null,
  ) {
    const sheet = await this.sheetsRepo.findOne({
      where: { id: sheetId },
      relations: ['rows'],
    });
    if (!sheet) throw new NotFoundException('Лист не найден');
    await this.checkSheetOwner(sheetId, userId);

    if (templateFolderId) await this.checkOwner(templateFolderId, userId);

    const rows = (sheet.rows || [])
      .filter((r) => r.name || r.article)
      .map((r) => ({
        row_number: r.id,
        name: r.name,
        brand: r.brand,
        article: r.article,
        qty: r.qty,
        unit: r.unit,
        price: r.price,
        store: r.store,
        coef: r.coef,
      }));

    return this.templatesRepo.save({
      name: name || sheet.name,
      meta: JSON.stringify(rows),
      userId,
      folder_id: templateFolderId ?? null,
      is_active: true,
    });
  }

  /** Recursively copy a project folder (and all its contents) into the templates space */
  async saveFolderAsTemplate(
    folderId: number,
    userId: number,
    name?: string,
    templateParentId?: number | null,
  ) {
    const sourceFolder = await this.checkOwner(folderId, userId);
    if (templateParentId) await this.checkOwner(templateParentId, userId);

    // Create template folder
    const tplFolder = await this.foldersRepo.save({
      name: name || sourceFolder.name,
      parent_id: templateParentId ?? null,
      owner_id: userId,
      type: 'templates',
      sort_order: 0,
    });

    // Copy sheets in this folder → template entries
    const sheets = await this.sheetsRepo.find({
      where: { folder_id: folderId },
      relations: ['rows'],
      order: { sort_order: 'ASC' },
    });
    for (const sheet of sheets) {
      const rows = (sheet.rows || [])
        .filter((r) => r.name || r.article)
        .map((r) => ({
          row_number: r.id,
          name: r.name,
          brand: r.brand,
          article: r.article,
          qty: r.qty,
          unit: r.unit,
          price: r.price,
          store: r.store,
          coef: r.coef,
        }));
      await this.templatesRepo.save({
        name: sheet.name,
        meta: JSON.stringify(rows),
        userId,
        folder_id: tplFolder.id,
        is_active: true,
      });
    }

    // Recurse into subfolders
    const subFolders = await this.foldersRepo.find({ where: { parent_id: folderId, type: 'projects' } });
    for (const sub of subFolders) {
      await this.saveFolderAsTemplate(sub.id, userId, sub.name, tplFolder.id);
    }

    return tplFolder;
  }

  // ── Load template ─────────────────────────────────────────────

  /** Load a single template entry as a sheet inside a project folder */
  async loadTemplateAsSheet(
    templateId: number,
    userId: number,
    mode: 'new' | 'into',
    targetFolderId?: number | null,
  ) {
    const tpl = await this.templatesRepo.findOne({ where: { id: templateId } });
    if (!tpl) throw new NotFoundException('Шаблон не найден');

    let folderId = targetFolderId ?? null;

    if (mode === 'new') {
      // Create a new root folder for this template sheet
      const newFolder = await this.foldersRepo.save({
        name: tpl.name,
        parent_id: null,
        owner_id: userId,
        type: 'projects',
        sort_order: 0,
      });
      folderId = newFolder.id;
    } else {
      if (!folderId) throw new NotFoundException('Укажите папку назначения');
      await this.checkOwner(folderId, userId);
    }

    return this.createSheetFromTemplate(tpl, folderId!, userId);
  }

  /** Load a template folder recursively into the projects space */
  async loadTemplateFolderIntoProject(
    templateFolderId: number,
    userId: number,
    mode: 'new' | 'into',
    targetFolderId?: number | null,
  ) {
    const tplFolder = await this.foldersRepo.findOne({ where: { id: templateFolderId } });
    if (!tplFolder) throw new NotFoundException('Шаблонная папка не найдена');
    // Allow loading common templates (owner != user) but user-owned folders must match
    if (tplFolder.owner_id !== userId && tplFolder.owner_id !== 0) {
      // Allow if it's a template folder (type='templates') owned by anyone — it's readable
    }

    let parentId: number | null = null;

    if (mode === 'new') {
      // Create as a root-level project folder
      const newFolder = await this.foldersRepo.save({
        name: tplFolder.name,
        parent_id: null,
        owner_id: userId,
        type: 'projects',
        sort_order: 0,
      });
      await this.copyTemplateFolderContents(templateFolderId, newFolder.id, userId);
      return newFolder;
    } else {
      if (!targetFolderId) throw new NotFoundException('Укажите папку назначения');
      await this.checkOwner(targetFolderId, userId);
      // Create as subfolder inside targetFolderId
      const newFolder = await this.foldersRepo.save({
        name: tplFolder.name,
        parent_id: targetFolderId,
        owner_id: userId,
        type: 'projects',
        sort_order: 0,
      });
      await this.copyTemplateFolderContents(templateFolderId, newFolder.id, userId);
      return newFolder;
    }
  }

  private async copyTemplateFolderContents(
    templateFolderId: number,
    projectFolderId: number,
    userId: number,
  ) {
    // Copy template entries → sheets
    const templates = await this.templatesRepo.find({ where: { folder_id: templateFolderId } });
    for (const tpl of templates) {
      await this.createSheetFromTemplate(tpl, projectFolderId, userId);
    }
    // Recurse into subfolders
    const subFolders = await this.foldersRepo.find({ where: { parent_id: templateFolderId } });
    for (const sub of subFolders) {
      const newSub = await this.foldersRepo.save({
        name: sub.name,
        parent_id: projectFolderId,
        owner_id: userId,
        type: 'projects',
        sort_order: 0,
      });
      await this.copyTemplateFolderContents(sub.id, newSub.id, userId);
    }
  }

  private async createSheetFromTemplate(tpl: any, folderId: number, userId: number) {
    const sheet = await this.sheetsRepo.save({
      name: tpl.name,
      folder_id: folderId,
      owner_id: userId,
    });
    let rows: any[] = [];
    try { rows = JSON.parse(tpl.meta) || []; } catch {}
    if (rows.length) {
      await this.rowsRepo.save(
        rows.map((r: any) => ({
          sheetId: sheet.id,
          name: r.name || '',
          brand: r.brand || '',
          article: r.article || '',
          qty: r.qty || '0',
          unit: r.unit || 'шт',
          price: r.price || '0',
          store: r.store || '',
          coef: r.coef || '1',
          total: '0',
        })),
      );
    }
    return sheet;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async checkOwner(id: number, userId: number) {
    const folder = await this.foldersRepo.findOne({ where: { id } });
    if (!folder) throw new NotFoundException('Папка не найдена');
    if (folder.owner_id !== userId) throw new ForbiddenException('Нет доступа');
    return folder;
  }

  private async checkSheetOwner(sheetId: number, userId: number) {
    const sheet = await this.sheetsRepo.findOne({ where: { id: sheetId } });
    if (!sheet) throw new NotFoundException('Лист не найден');
    if (sheet.owner_id !== userId && sheet.folder_id) {
      const folder = await this.foldersRepo.findOne({ where: { id: sheet.folder_id } });
      if (!folder || folder.owner_id !== userId) throw new ForbiddenException('Нет доступа');
    }
    return sheet;
  }

  private async getDescendantIds(folderId: number): Promise<number[]> {
    const children = await this.foldersRepo.find({ where: { parent_id: folderId } });
    const ids: number[] = children.map((c) => c.id);
    for (const child of children) {
      const nested = await this.getDescendantIds(child.id);
      ids.push(...nested);
    }
    return ids;
  }
}
