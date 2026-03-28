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

  async create(data: Partial<Template>): Promise<Template> {
    const template = this.templatesRepository.create(data);
    return this.templatesRepository.save(template);
  }

  async findAll(scope?: string): Promise<Template[]> {
    if (scope === 'common') {
      return this.templatesRepository.find({
        where: { userId: IsNull() },
        order: { createdAt: 'DESC' },
      });
    }
    return this.templatesRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: number): Promise<Template> {
    const template = await this.templatesRepository.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }
    return template;
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
