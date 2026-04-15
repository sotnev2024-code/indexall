import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sheet } from './sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { Project } from '../projects/project.entity';
import { Folder } from '../folders/folder.entity';
import { TrashService } from '../trash/trash.service';

@Injectable()
export class SheetsService {
  constructor(
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(EquipmentRow) private rowsRepo: Repository<EquipmentRow>,
    @InjectRepository(Project) private projectsRepo: Repository<Project>,
    @InjectRepository(Folder) private foldersRepo: Repository<Folder>,
    private readonly trashService: TrashService,
  ) {}

  /** Create sheet in a project (legacy — keeps backward compat) */
  async createSheet(projectId: number, userId: number, name?: string) {
    await this.checkProjectOwner(projectId, userId);
    const count = await this.sheetsRepo.count({ where: { projectId } });
    if (count >= 200)
      throw new BadRequestException('Максимум 200 листов в проекте');

    const sheet = await this.sheetsRepo.save({
      projectId,
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
    return this.getSheetWithRows(sheet.id);
  }

  async getSheetWithRowsOwned(sheetId: number, userId: number) {
    await this.checkSheetOwner(sheetId, userId);
    return this.getSheetWithRows(sheetId);
  }

  async getSheetWithRows(sheetId: number) {
    const sheet = await this.sheetsRepo.findOne({
      where: { id: sheetId },
      relations: ['rows'],
    });
    if (!sheet) throw new NotFoundException('Лист не найден');
    const total = (sheet.rows || []).reduce(
      (sum, r) =>
        sum +
        parseFloat(r.price || '0') *
          parseFloat(r.qty || '0') *
          parseFloat(r.coef || '1'),
      0,
    );
    return { ...sheet, total };
  }

  async updateSheet(sheetId: number, userId: number, data: Partial<Sheet>) {
    await this.checkSheetOwner(sheetId, userId);
    const { folder_id, ...safe } = data as any;
    await this.sheetsRepo.update(sheetId, safe);
    return this.getSheetWithRows(sheetId);
  }

  async duplicateSheet(sheetId: number, userId: number) {
    await this.checkSheetOwner(sheetId, userId);
    const original = await this.getSheetWithRows(sheetId);
    const newSheet = await this.sheetsRepo.save({
      projectId: original.projectId,
      folder_id: original.folder_id,
      owner_id: userId,
      name: original.name + ' (копия)',
    });
    if (original.rows?.length) {
      await this.rowsRepo.save(
        original.rows.map((r) => ({
          sheetId: newSheet.id,
          name: r.name || '',
          brand: r.brand || '',
          article: r.article || '',
          qty: r.qty || '0',
          unit: r.unit || 'шт',
          price: r.price || '0',
          store: r.store || '',
          coef: r.coef || '1',
          total: r.total || '0',
          _autoPrice: r._autoPrice,
        })),
      );
    }
    return this.getSheetWithRows(newSheet.id);
  }

  async removeSheet(sheetId: number, userId: number) {
    const sheet = await this.checkSheetOwner(sheetId, userId);

    // Legacy check: prevent deleting last sheet in a project
    if (sheet.projectId && !sheet.folder_id) {
      const count = await this.sheetsRepo.count({
        where: { projectId: sheet.projectId },
      });
      if (count <= 1)
        throw new BadRequestException('Нельзя удалить последний лист проекта');
    }

    await this.trashService.addToTrash({
      entity_type: 'sheet',
      entity_id: sheetId,
      user_id: userId,
      name: sheet.name,
    });
    await this.sheetsRepo.delete(sheetId);
    return { success: true };
  }

  async saveRows(sheetId: number, userId: number, rows: any[]) {
    await this.checkSheetOwner(sheetId, userId);
    await this.rowsRepo.delete({ sheetId });
    if (rows?.length) {
      const toSave = rows.map((r) => ({
        sheetId,
        name: r.name || '',
        brand: r.brand || '',
        article: r.article || '',
        etm_code: r.etm_code || '',
        qty: r.qty != null ? String(r.qty) : '0',
        unit: r.unit || 'шт',
        price: r.price != null ? String(r.price) : '0',
        store: r.store || '',
        coef: r.coef != null ? String(r.coef) : '1',
        total: r.total != null ? String(r.total) : '0',
        _autoPrice: r._autoPrice ?? r.auto_price ?? true,
        custom: r.custom || {},
      }));
      await this.rowsRepo.save(toSave);
    }
    return this.getSheetWithRows(sheetId);
  }

  // ── Ownership checks ──────────────────────────────────────────

  private async checkProjectOwner(projectId: number, userId: number) {
    const p = await this.projectsRepo.findOne({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Проект не найден');
    if (p.userId !== userId) throw new ForbiddenException('Нет доступа');
    return p;
  }

  async checkSheetOwner(sheetId: number, userId: number) {
    const sheet = await this.sheetsRepo.findOne({ where: { id: sheetId } });
    if (!sheet) throw new NotFoundException('Лист не найден');

    // Folder-based ownership
    if (sheet.folder_id) {
      const folder = await this.foldersRepo.findOne({ where: { id: sheet.folder_id } });
      if (!folder || folder.owner_id !== userId) {
        throw new ForbiddenException('Нет доступа');
      }
      return sheet;
    }

    // owner_id direct check
    if (sheet.owner_id) {
      if (sheet.owner_id !== userId) throw new ForbiddenException('Нет доступа');
      return sheet;
    }

    // Legacy: check via project
    if (sheet.projectId) {
      await this.checkProjectOwner(sheet.projectId, userId);
      return sheet;
    }

    throw new ForbiddenException('Нет доступа');
  }
}
