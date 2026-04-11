import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Template } from './template.entity';
import { User } from '../users/user.entity';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { ProGuard } from '../auth/guards/pro.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Template, User])],
  providers: [TemplatesService, ProGuard],
  controllers: [TemplatesController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
