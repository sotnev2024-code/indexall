import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrashItem } from './trash-item.entity';
import { TrashService } from './trash.service';
import { TrashController } from './trash.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TrashItem])],
  controllers: [TrashController],
  providers: [TrashService],
  exports: [TrashService],
})
export class TrashModule {}
