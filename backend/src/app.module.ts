import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { SheetsModule } from './sheets/sheets.module';
import { EquipmentModule } from './equipment/equipment.module';
import { TemplatesModule } from './templates/templates.module';
import { CatalogModule } from './catalog/catalog.module';
import { StoresModule } from './stores/stores.module';
import { AdminModule } from './admin/admin.module';
import { TrashModule } from './trash/trash.module';
import { MailModule } from './mail/mail.module';
import { ExportModule } from './export/export.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      username: process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_PASSWORD || 'postgres',
      database: process.env.DATABASE_NAME || 'indexall',
      entities: [__dirname + '/**/*.entity{.ts,.js}', __dirname + '/**/*.entities{.ts,.js}'],
      migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production', // Auto-create tables in dev
      logging: process.env.NODE_ENV === 'development',
    }),
    AuthModule,
    UsersModule,
    ProjectsModule,
    SheetsModule,
    EquipmentModule,
    TemplatesModule,
    CatalogModule,
    StoresModule,
    AdminModule,
    TrashModule,
    MailModule,
    ExportModule,
    PaymentsModule,
  ],
})
export class AppModule {}
