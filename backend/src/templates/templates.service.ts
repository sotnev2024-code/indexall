import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Template } from './template.entity';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template)
    private templatesRepository: Repository<Template>,
  ) {}

  private withRows(t: Template): any {
    let rows: any[] = [];
    try { const parsed = JSON.parse(t.meta); if (Array.isArray(parsed)) rows = parsed; } catch {}
    return { ...t, rows, scope: t.userId == null ? 'common' : 'my' };
  }

  async create(data: any): Promise<any> {
    const { rows, ...templateData } = data;
    if (rows !== undefined && !templateData.meta) {
      templateData.meta = JSON.stringify(rows);
    }
    const template = this.templatesRepository.create(templateData);
    const saved = await this.templatesRepository.save(template) as unknown as Template;
    return this.withRows(saved);
  }

  async findAll(scope?: string, userId?: number): Promise<any[]> {
    let templates: Template[];
    if (scope === 'common') {
      templates = await this.templatesRepository.find({
        where: { userId: IsNull(), is_active: true },
        order: { createdAt: 'DESC' },
      });
    } else if (userId) {
      // Return user's own templates + all active common templates
      templates = await this.templatesRepository.find({ order: { createdAt: 'DESC' } });
      templates = templates.filter(t =>
        t.userId === userId || (t.userId == null && (t.is_active ?? true))
      );
    } else {
      templates = await this.templatesRepository.find({ order: { createdAt: 'DESC' } });
    }
    return templates.map(t => this.withRows(t));
  }

  async findOne(id: number): Promise<any> {
    const template = await this.templatesRepository.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }
    return this.withRows(template);
  }

  async update(id: number, updateData: Partial<Template>): Promise<Template> {
    const template = await this.findOne(id);
    Object.assign(template, updateData);
    return this.templatesRepository.save(template);
  }

  async remove(id: number): Promise<void> {
    const template = await this.findOne(id);
    await this.templatesRepository.remove(template);
  }

  async toggleFavorite(id: number): Promise<any> {
    const template = await this.findOne(id);
    template.is_favorite = !template.is_favorite;
    const saved = await this.templatesRepository.save(template) as unknown as Template;
    return this.withRows(saved);
  }

  /** Admin: get all templates from all users */
  async findAllForAdmin(): Promise<any[]> {
    const templates = await this.templatesRepository.find({
      order: { createdAt: 'DESC' },
      relations: ['user'],
    });
    return templates.map(t => ({
      ...this.withRows(t),
      ownerEmail: (t as any).user?.email || null,
      ownerName:  (t as any).user?.name  || null,
    }));
  }

  /** Admin: mark template as common (userId = null) */
  async makeCommon(id: number): Promise<any> {
    const template = await this.findOne(id);
    const saved = await this.templatesRepository.save({ ...template, userId: null, is_active: true }) as unknown as Template;
    return this.withRows(saved);
  }

  /** Admin: unmark template as common (restore ownership) */
  async unmakeCommon(id: number, userId: number): Promise<any> {
    const template = await this.findOne(id);
    const saved = await this.templatesRepository.save({ ...template, userId }) as unknown as Template;
    return this.withRows(saved);
  }

  async addFile(id: number): Promise<Template> {
    const template = await this.findOne(id);
    template.files += 1;
    return this.templatesRepository.save(template);
  }

  async removeFile(id: number): Promise<Template> {
    const template = await this.findOne(id);
    if (template.files > 0) {
      template.files -= 1;
    }
    return this.templatesRepository.save(template);
  }
}
