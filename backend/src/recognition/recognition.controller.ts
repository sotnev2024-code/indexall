import {
  Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Request, Res,
  UseGuards, UseInterceptors, UploadedFile, ParseIntPipe, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { extname } from 'path';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { RecognitionService } from './recognition.service';

const documentStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (_, file, cb) => cb(null, `recog-src-${Date.now()}${extname(file.originalname).toLowerCase()}`),
});

const modelStorage = diskStorage({
  destination: process.env.UPLOAD_DIR || './uploads',
  filename: (_, file, cb) => cb(null, `model-${Date.now()}.onnx`),
});

// Обкатка: доступ всем администраторам. Когда откроем пользователям —
// убрать AdminGuard здесь и проверки isAdmin в Header.tsx /
// app/recognition/page.tsx (панели «Датасет» и «Модель» оставить админам).
@Controller('recognition')
@UseGuards(JwtAuthGuard, AdminGuard)
export class RecognitionController {
  constructor(private readonly service: RecognitionService) {}

  @Get('status')
  status() {
    return this.service.status();
  }

  /** Самопроверка интеграции: режим, эндпоинт, активная модель и живой ли
   *  провайдер (пробный вызов). Открыт только админам — как весь контроллер. */
  @Get('diagnostics')
  diagnostics() {
    return this.service.diagnostics();
  }

  // ── Таксономия классов (из конфига Label Studio) ──────────────

  @Get('classes')
  getClasses() {
    return this.service.getClassConfig();
  }

  @Put('classes/ls-config')
  saveLsConfig(@Body('xml') xml: string) {
    return this.service.saveLsConfig(xml);
  }

  // ── Датасет ───────────────────────────────────────────────────

  @Get('dataset/stats')
  datasetStats() {
    return this.service.datasetStats();
  }

  @Get('dataset/export')
  exportDataset(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.exportDataset(from, to);
  }

  /** ZIP: images/ + labels/ (YOLO) + classes.txt + data.yaml + labelstudio.json */
  @Get('dataset/export-zip')
  async exportDatasetZip(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { archive, filename } = await this.service.exportDatasetZip(from, to);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    archive.pipe(res);
    await archive.finalize();
  }

  /** Импорт проверенной разметки из Label Studio (JSON-экспорт). */
  @Post('dataset/import')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  }))
  importDataset(@UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file?.buffer) throw new BadRequestException('Файл не загружен');
    return this.service.importLsAnnotations(req.user.userId, file.buffer.toString('utf8'));
  }

  // ── Версии модели YOLO и режим распознавания ─────────────────

  @Get('models')
  listModels() {
    return this.service.listModels();
  }

  @Post('models')
  @UseInterceptors(FileInterceptor('file', {
    storage: modelStorage,
    limits: { fileSize: 600 * 1024 * 1024 },
  }))
  uploadModel(
    @UploadedFile() file: Express.Multer.File,
    @Body('note') note: string,
    @Body('role') role: string,
    @Body('tiled') tiled: string,
  ) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return this.service.uploadModel(file, note, role, tiled === 'true' || tiled === '1');
  }

  @Post('models/:id/activate')
  activateModel(@Param('id', ParseIntPipe) id: number) {
    return this.service.activateModel(id);
  }

  /** class_mapping.json к модели-классификатору: номер выхода → имя класса */
  @Post('models/:id/class-map')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
  }))
  uploadClassMap(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) throw new BadRequestException('Файл не загружен');
    return this.service.setClassMap(id, file.buffer.toString('utf8'));
  }

  /** Роль модели в конвейере (детектор/классификатор) и нарезка на тайлы */
  @Patch('models/:id')
  updateModel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { role?: string; tiled?: boolean; note?: string },
  ) {
    return this.service.updateModel(id, body);
  }

  @Delete('models/:id')
  deleteModel(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteModel(id);
  }

  @Put('mode')
  setMode(@Body('mode') mode: string) {
    return this.service.setMode(mode);
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
    // админам видны все схемы (чужие — с пометкой владельца)
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

  /** Дозагрузка листов в существующий документ («+ Добавить лист») */
  @Post('documents/:id/pages')
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
  addPages(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) throw new BadRequestException('Файл не загружен');
    return this.service.addPagesToDocument(id, req.user.userId, file);
  }

  /** Схема, из которой собран лист спецификации (кнопка «К схеме») */
  @Get('by-sheet/:sheetId')
  findBySheet(@Param('sheetId', ParseIntPipe) sheetId: number, @Request() req) {
    return this.service.findBySheet(sheetId, req.user.userId);
  }

  // ── Страницы ──────────────────────────────────────────────────

  @Patch('pages/:id')
  updatePage(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { hidden?: boolean; confirmed?: boolean; schema_type?: string; title?: string },
    @Request() req,
  ) {
    return this.service.updatePage(id, req.user.userId, body);
  }

  /** Лист спецификации из подтверждённых элементов ЭТОЙ схемы */
  @Post('pages/:id/create-sheet')
  createSheet(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.createSheetFromPage(id, req.user.userId);
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
