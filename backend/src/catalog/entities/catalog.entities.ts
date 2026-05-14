import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, OneToMany, RelationId } from 'typeorm';

@Entity('manufacturers')
export class Manufacturer {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ default: true }) is_active: boolean;
  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;

  @OneToMany(() => PriceList, pl => pl.manufacturer)
  price_lists: PriceList[];
}

export enum PriceListStatus { 
  PENDING = 'pending', 
  PROCESSING = 'processing', 
  ACTIVE = 'active', 
  INACTIVE = 'inactive', 
  ARCHIVE = 'archive' 
}

@Entity('price_lists')
export class PriceList {
  @PrimaryGeneratedColumn() id: number;
  @Column() manufacturer_id: number;
  @ManyToOne(() => Manufacturer, { nullable: false }) @JoinColumn({ name: 'manufacturer_id' }) manufacturer: Manufacturer;
  @Column() file_name: string;
  @Column({ nullable: true }) file_path: string;
  @Column({ type: 'enum', enum: PriceListStatus, default: PriceListStatus.PENDING }) status: PriceListStatus;
  @Column({ nullable: true, type: 'jsonb' }) mapping: object; // { firstRow, g1..g6, nameCol, artCol }
  @Column({ nullable: true }) uploaded_by: number;
  @Column({ nullable: true, type: 'timestamptz' }) archived_at: Date;
  @Column({ default: 0 }) visit_count: number;
  @CreateDateColumn() uploaded_at: Date;
}

@Entity('catalog_categories')
export class CatalogCategory {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ nullable: true }) parent_id: number;
  @ManyToOne(() => CatalogCategory, { nullable: true }) @JoinColumn({ name: 'parent_id' }) parent: CatalogCategory;
  @Column({ nullable: true }) manufacturer_id: number;
  @ManyToOne(() => Manufacturer, { nullable: true }) @JoinColumn({ name: 'manufacturer_id' }) manufacturer: Manufacturer;
  @Column({ nullable: true }) price_list_id: number;
  @Column({ default: 0 }) sort_order: number;

  @OneToMany(() => CatalogCategory, child => child.parent)
  children: CatalogCategory[];
}

@Entity('catalog_products')
export class CatalogProduct {
  @PrimaryGeneratedColumn() id: number;
  @Column() manufacturer_id: number;
  @ManyToOne(() => Manufacturer) @JoinColumn({ name: 'manufacturer_id' }) manufacturer: Manufacturer;
  @Column({ nullable: true }) category_id: number;
  @ManyToOne(() => CatalogCategory, { nullable: true }) @JoinColumn({ name: 'category_id' }) category: CatalogCategory;
  @Column() name: string;
  @Column({ nullable: true }) article: string;
  /** ETM internal code for direct API lookup (type=etm). Optional. */
  @Column({ nullable: true }) etm_code: string;
  @Column({ nullable: true }) unit: string;
  @Column({ nullable: true, type: 'decimal', precision: 12, scale: 2 }) price: number;
  /** External URL to manufacturer/supplier page for this product */
  @Column({ nullable: true }) external_url: string;
  /** Image URL for this product */
  @Column({ nullable: true }) image_url: string;
  @Column({ nullable: true, type: 'jsonb' }) attributes: object;
  @Column({ default: true }) is_active: boolean;
  @CreateDateColumn() created_at: Date;

  @OneToMany(() => ProductAnalog, pa => pa.product)
  analogs: ProductAnalog[];

  @OneToMany(() => ProductAccessory, pac => pac.product)
  accessories: ProductAccessory[];
}

@Entity('product_analogs')
export class ProductAnalog {
  @PrimaryGeneratedColumn() id: number;
  @Column() product_id: number;
  @ManyToOne(() => CatalogProduct, { nullable: false }) @JoinColumn({ name: 'product_id' }) product: CatalogProduct;
  @Column() analog_product_id: number;
  @ManyToOne(() => CatalogProduct, { nullable: false }) @JoinColumn({ name: 'analog_product_id' }) analog: CatalogProduct;
  @Column({ nullable: true }) note: string;
}

@Entity('product_accessories')
export class ProductAccessory {
  @PrimaryGeneratedColumn() id: number;
  @Column() product_id: number;
  @ManyToOne(() => CatalogProduct, { nullable: false }) @JoinColumn({ name: 'product_id' }) product: CatalogProduct;
  @Column() accessory_product_id: number;
  @ManyToOne(() => CatalogProduct, { nullable: false }) @JoinColumn({ name: 'accessory_product_id' }) accessory: CatalogProduct;
  @Column({ nullable: true }) note: string;
}

@Entity('catalog_tiles')
export class CatalogTile {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true }) @Column() slug: string;
  @Column() name: string;
  @Column({ default: '⚡' }) icon: string;
  @Column({ nullable: true }) image_path: string;
  /** Legacy flag — kept for backward compat; new code uses width/height */
  @Column({ default: false }) is_large: boolean;
  /** Tile width in grid cells: 1 or 2. Combined with height for 1×1, 2×1, 1×2, 2×2 layouts. */
  @Column({ default: 1 }) width: number;
  /** Tile height in grid cells: 1 or 2 */
  @Column({ default: 1 }) height: number;
  @Column({ default: 0 }) sort_order: number;
  @Column({ default: true }) is_active: boolean;
  @Column({ type: 'jsonb', default: '[]' }) filters: any[];
  @Column({ default: 0 }) visit_count: number;
  @CreateDateColumn() created_at: Date;

  // Data upload fields
  @Column({ nullable: true }) data_file_name: string;
  @Column({ nullable: true }) data_file_path: string;
  @Column({ nullable: true, type: 'jsonb' }) column_mapping: {
    firstRow: number;
    nameCol: string;
    articleCol: string;
    priceCol: string;
    unitCol: string;
    brandCol: string;
    etmCodeCol: string;
    imageUrlCol: string;
    externalUrlCol: string;
    accessoriesStartCol: string;
    filters: { col: string; label: string }[];
  };
  @Column({ default: 0 }) products_count: number;

  @OneToMany(() => TileProduct, tp => tp.tile)
  products: TileProduct[];
}

@Entity('tile_products')
@Index('idx_tile_products_tile_brand', ['tile_id', 'brand'])
export class TileProduct {
  @PrimaryGeneratedColumn() id: number;

  @Column() tile_id: number;
  @ManyToOne(() => CatalogTile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tile_id' })
  tile: CatalogTile;

  @Column() name: string;
  @Column({ nullable: true }) article: string;
  @Column({ nullable: true, type: 'decimal', precision: 12, scale: 2 }) price: number;
  @Column({ nullable: true }) unit: string;
  @Column({ nullable: true }) brand: string;
  /** ETM internal code for direct API lookup (type=etm). Optional — falls back to article. */
  @Column({ nullable: true }) etm_code: string;
  /** External URL to manufacturer/supplier page for this product */
  @Column({ nullable: true }) external_url: string;
  /** Image URL for this product */
  @Column({ nullable: true }) image_url: string;
  @Column({ type: 'jsonb', default: '{}' }) attributes: Record<string, string>;
  @Column({ type: 'jsonb', default: '[]' }) accessories: { type: string; name: string; article: string; url: string }[];
}

/** Uploaded accessory table, linked to a CatalogTile OR a PriceList */
@Entity('accessory_tables')
export class AccessoryTable {
  @PrimaryGeneratedColumn() id: number;
  /** Link to a category tile (from "База" section). Nullable — one of tile_id/price_list_id must be set. */
  @Column({ nullable: true }) tile_id: number;
  @ManyToOne(() => CatalogTile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tile_id' })
  tile: CatalogTile;
  /** Link to a manufacturer price list (from "Прайс-листы" section). Nullable. */
  @Column({ nullable: true }) price_list_id: number;
  @ManyToOne(() => PriceList, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'price_list_id' })
  priceList: PriceList;
  @Column() file_name: string;
  @Column({ nullable: true }) file_path: string;
  /** Column mapping: { firstRow, articleCol, nameCol, imageUrlCol, siteUrlCol, descriptionCol, params: [{col, label}] } */
  @Column({ type: 'jsonb', nullable: true }) column_mapping: {
    firstRow: number;
    articleCol: string;
    nameCol: string;
    imageUrlCol?: string;
    siteUrlCol?: string;
    descriptionCol?: string;
    params: { col: string; label: string }[];
  };
  @Column({ default: 0 }) items_count: number;
  @CreateDateColumn() created_at: Date;
}

/** Individual accessory item parsed from an AccessoryTable */
@Entity('accessory_items')
@Index('idx_acc_items_article', ['accessory_table_id', 'article'])
export class AccessoryItem {
  @PrimaryGeneratedColumn() id: number;
  @Column() accessory_table_id: number;
  @ManyToOne(() => AccessoryTable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accessory_table_id' })
  table: AccessoryTable;
  @Column({ nullable: true }) article: string;
  @Column({ nullable: true }) name: string;
  @Column({ nullable: true }) image_url: string;
  @Column({ nullable: true }) site_url: string;
  @Column({ nullable: true, type: 'text' }) description: string;
  @Column({ type: 'jsonb', default: '{}' }) attributes: Record<string, string>;
}
