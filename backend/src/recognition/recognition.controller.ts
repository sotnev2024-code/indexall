import {
  Controller, Get, Post, Patch, Delete, Param, Body, Request,
  UseGuards, UseInterceptors, UploadedFile, ParseIntPipe, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecognitionService } from './recognition.service';

const documentStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (_, file, cb) => cb(null, `recog-src-${Date.now()}${extname(file.originalname).toLowerCase()}`),
});

@Controller('recognition')
@UseGuards(JwtAuthGuard)
export class RecognitionController {
  constructor(private readonly service: RecognitionService) {}

  @Get('status')
  status() {
    return { configured: this.service.isConfigured() };
  }

  // ── Документы ─────────────────────────────────────────────────

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', {
    storage: documentStorage,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
      if (!/(pdf|png|jpe?g|webp)$/i.test(file.mimetype) && !/\.(pdf|png|jpe?g|webp)$/i.test(file.originalname)) {
        return cb(new BadRequestException('Поддерживаются PDF, PNG и JPG'), false);
      }
      cb(null, true);
    },
  }))
  upload(@UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return this.service.createDocument(req.user.userId, file);
  }

  @Get('documents')
  list(@Request() req) {
    return this.service.listDocuments(req.user.userId);
  }

  @Get('documents/:id')
  getOne(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.getDocument(id, req.user.userId);
  }

  @Delete('documents/:id')
  remove(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.removeDocument(id, req.user.userId);
  }

  @Post('documents/:id/create-sheet')
  createSheet(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.createSheetFromDocument(id, req.user.userId);
  }

  // ── Страницы ──────────────────────────────────────────────────

  @Patch('pages/:id')
  updatePage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { hidden?: boolean; confirmed?: boolean },
    @Request() req,
  ) {
    return this.service.updatePage(id, req.user.userId, body);
  }

  @Post('pages/:id/detect')
  detect(
    @Param('id', ParseIntPipe) id: number,
    @Body('zone') zone: { x: number; y: number; w: number; h: number },
    @Request() req,
  ) {
    if (!zone) throw new BadRequestException('Не передана зона распознавания');
    return this.service.detectZone(id, req.user.userId, zone);
  }

  @Post('pages/:id/elements')
  createElement(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Request() req,
  ) {
    return this.service.createElement(id, req.user.userId, body);
  }

  // ── Элементы ──────────────────────────────────────────────────

  @Patch('elements/:id')
  updateElement(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Request() req) {
    return this.service.updateElement(id, req.user.userId, body);
  }

  @Delete('elements/:id')
  removeElement(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.removeElement(id, req.user.userId);
  }
}
