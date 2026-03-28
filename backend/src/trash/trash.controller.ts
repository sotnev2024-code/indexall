import { Controller, Get, Post, Delete, Param, UseGuards, Req, ParseIntPipe } from '@nestjs/common';
import { TrashService } from './trash.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('trash')
@UseGuards(JwtAuthGuard)
export class TrashController {
  constructor(private readonly service: TrashService) {}

  @Get()
  getTrash(@Req() req: any) { return this.service.getTrash(req.user.userId); }

  @Post(':id/restore')
  restore(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.restore(id, req.user.userId);
  }

  @Delete(':id')
  permanentDelete(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.service.permanentDelete(id, req.user.userId);
  }
}
