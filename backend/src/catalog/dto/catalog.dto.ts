import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

export class SearchProductDto {
  @IsString()
  q: string;

  @IsOptional()
  @IsNumber()
  manufacturerId?: number;

  @IsOptional()
  @IsNumber()
  categoryId?: number;
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  article?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsNumber()
  manufacturerId: number;

  @IsOptional()
  @IsNumber()
  categoryId?: number;

  @IsOptional()
  @IsObject()
  attributes?: object;
}

export class PriceListMappingDto {
  @IsNumber()
  firstRow: number;

  @IsString()
  nameCol: string;

  @IsString()
  artCol: string;

  @IsOptional()
  @IsString()
  priceCol?: string;

  @IsOptional()
  @IsString()
  unitCol?: string;
}
