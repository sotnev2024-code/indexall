import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { Sheet } from '../sheets/sheet.entity';
import { EquipmentRow } from '../equipment/equipment-row.entity';
import { TrashService } from '../trash/trash.service';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private projectsRepo: Repository<Project>,
    @InjectRepository(Sheet) private sheetsRepo: Repository<Sheet>,
    @InjectRepository(EquipmentRow) private rowsRepo: Repository<EquipmentRow>,
    private readonly trashService: TrashService,
  ) {}

  async findAll(userId: number) {
    const projects = await this.projectsRepo.find({
      where: { userId },
      relations: ['sheets', 'sheets.rows'],
      order: { updatedAt: 'DESC' },
    });

    return projects.map((p) => {
      const sheets = (p.sheets || []).map((s) => {
        const total = (s.rows || []).reduce(
          (sum, r) =>
            sum +
            parseFloat(r.price || '0') *
              parseFloat(r.qty || '0') *
              parseFloat(r.coef || '1'),
          0,
        );
        return { ...s, total };
      });
      const projectTotal = sheets.reduce((sum, s) => sum + s.total, 0);
      return { ...p, sheets, total: projectTotal };
    });
  }

  async findOne(id: number, userId?: number) {
    const project = await this.projectsRepo.findOne({
      where: { id },
      relations: ['sheets', 'sheets.rows'],
    });
    if (!project) throw new NotFoundException('Проект не найден');
    if (userId && project.userId !== userId)
      throw new ForbiddenException('Нет доступа');

    const sheets = (project.sheets || []).map((s) => {
      const total = (s.rows || []).reduce(
        (sum, r) =>
          sum +
          parseFloat(r.price || '0') *
            parseFloat(r.qty || '0') *
            parseFloat(r.coef || '1'),
        0,
      );
      return { ...s, total };
    });
    const projectTotal = sheets.reduce((sum, s) => sum + s.total, 0);
    return { ...project, sheets, total: projectTotal };
  }

  async create(userId: number, name: string) {
    const project = await this.projectsRepo.save({
      userId,
      name: name || 'Проект1',
    });
    const sheet = await this.sheetsRepo.save({
      projectId: project.id,
      name: 'Спецификация1',
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
    return this.findOne(project.id, userId);
  }

  async update(id: number, userId: number, data: Partial<Project>) {
    await this.checkOwner(id, userId);
    await this.projectsRepo.update(id, data);
    return this.findOne(id, userId);
  }

  async duplicate(id: number, userId: number) {
    const original = await this.findOne(id, userId);
    const newProject = await this.projectsRepo.save({
      userId,
      name: original.name + ' (копия)',
    });
    for (const sheet of original.sheets || []) {
      const newSheet = await this.sheetsRepo.save({
        projectId: newProject.id,
        name: sheet.name,
      });
      if (sheet.rows?.length) {
        await this.rowsRepo.save(
          sheet.rows.map((r) => ({
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
    }
    return this.findOne(newProject.id, userId);
  }

  async remove(id: number, userId: number) {
    const project = await this.checkOwner(id, userId);
    await this.trashService.addToTrash({
      entity_type: 'project',
      entity_id: id,
      user_id: userId,
      name: project.name,
    });
    await this.projectsRepo.delete(id);
    return { success: true };
  }

  private async checkOwner(id: number, userId: number) {
    const p = await this.projectsRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Проект не найден');
    if (p.userId !== userId) throw new ForbiddenException('Нет доступа');
    return p;
  }
}
