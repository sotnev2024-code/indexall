import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class InitialSchema1711267200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create users table
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            name: 'password',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'plan',
            type: 'enum',
            enum: ['free', 'pro', 'admin'],
            default: "'free'",
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['active', 'inactive'],
            default: "'active'",
          },
          {
            name: 'last_seen',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    // Create projects table
    await queryRunner.createTable(
      new Table({
        name: 'projects',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'user_id',
            type: 'int',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    // Create sheets table
    await queryRunner.createTable(
      new Table({
        name: 'sheets',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'project_id',
            type: 'int',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['project_id'],
            referencedTableName: 'projects',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    // Create equipment_rows table
    await queryRunner.createTable(
      new Table({
        name: 'equipment_rows',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'sheet_id',
            type: 'int',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'brand',
            type: 'varchar',
            length: '255',
            default: "''",
          },
          {
            name: 'article',
            type: 'varchar',
            length: '255',
            default: "''",
          },
          {
            name: 'qty',
            type: 'varchar',
            length: '50',
            default: "'0'",
          },
          {
            name: 'unit',
            type: 'varchar',
            length: '50',
            default: "'шт'",
          },
          {
            name: 'price',
            type: 'varchar',
            length: '50',
            default: "'0'",
          },
          {
            name: 'store',
            type: 'varchar',
            length: '255',
            default: "''",
          },
          {
            name: 'coef',
            type: 'varchar',
            length: '50',
            default: "'1'",
          },
          {
            name: 'total',
            type: 'varchar',
            length: '50',
            default: "'0'",
          },
          {
            name: '_auto_price',
            type: 'boolean',
            default: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['sheet_id'],
            referencedTableName: 'sheets',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    // Create templates table
    await queryRunner.createTable(
      new Table({
        name: 'templates',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'meta',
            type: 'text',
            default: "''",
          },
          {
            name: 'files',
            type: 'int',
            default: 0,
          },
          {
            name: 'user_id',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'SET NULL',
          },
        ],
      }),
    );

    // Create indexes
    await queryRunner.createIndex(
      'projects',
      new TableIndex({
        name: 'IDX_PROJECTS_USER_ID',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'sheets',
      new TableIndex({
        name: 'IDX_SHEETS_PROJECT_ID',
        columnNames: ['project_id'],
      }),
    );

    await queryRunner.createIndex(
      'equipment_rows',
      new TableIndex({
        name: 'IDX_EQUIPMENT_ROWS_SHEET_ID',
        columnNames: ['sheet_id'],
      }),
    );

    await queryRunner.createIndex(
      'templates',
      new TableIndex({
        name: 'IDX_TEMPLATES_USER_ID',
        columnNames: ['user_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('templates', 'IDX_TEMPLATES_USER_ID');
    await queryRunner.dropIndex('equipment_rows', 'IDX_EQUIPMENT_ROWS_SHEET_ID');
    await queryRunner.dropIndex('sheets', 'IDX_SHEETS_PROJECT_ID');
    await queryRunner.dropIndex('projects', 'IDX_PROJECTS_USER_ID');

    await queryRunner.dropTable('templates');
    await queryRunner.dropTable('equipment_rows');
    await queryRunner.dropTable('sheets');
    await queryRunner.dropTable('projects');
    await queryRunner.dropTable('users');
  }
}
