import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import * as fs from 'fs';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  // Enable CORS for frontend
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      process.env.FRONTEND_URL || 'http://localhost:3000',
    ],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('INDEXALL API')
    .setDescription('API для системы учёта оборудования')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const port = process.env.PORT || 4000;

  // Корень без /api — это не веб-приложение, а подсказка (иначе «Cannot GET /»)
  app.getHttpAdapter().get('/', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"/><title>INDEXALL API</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5}
code{background:#f4f4f4;padding:2px 6px;border-radius:4px}a{color:#06c}</style></head><body>
<h1>INDEXALL — сервер API</h1>
<p>Здесь только REST API. Интерфейс сайта запускается <strong>отдельно</strong> на порту 3000.</p>
<ul>
<li><a href="${frontendUrl}">Открыть веб-приложение → ${frontendUrl}</a></li>
<li><a href="/docs">Документация Swagger → /docs</a></li>
<li>Префикс API: <code>/api</code> (например <code>/api/auth/login</code>)</li>
</ul>
<p>Из корня проекта можно поднять всё сразу: <code>npm run dev</code> (backend + frontend).</p>
</body></html>`);
  });

  await app.listen(port);
  console.log(`🚀 Backend API: http://localhost:${port}  (корень / — подсказка, не SPA)`);
  console.log(`📚 Swagger:     http://localhost:${port}/docs`);
  console.log(`🌐 Frontend:    ${frontendUrl}  — запустите: cd frontend && npm run dev`);
}

bootstrap();
