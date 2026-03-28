// Shared types for INDEXALL project
// These types are shared between backend and frontend

export interface User {
  id: number;
  email: string;
  password?: string;
  name: string;
  plan: 'free' | 'pro' | 'admin';
  status: 'active' | 'inactive';
  lastSeen: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: number;
  name: string;
  userId: number;
  sheets?: Sheet[];
  expanded?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Sheet {
  id: number;
  name: string;
  projectId: number;
  rows?: EquipmentRow[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EquipmentRow {
  id: number;
  sheetId: number;
  name: string;
  brand: string;
  article: string;
  qty: string;
  unit: string;
  price: string;
  store: string;
  coef: string;
  total: string;
  _autoPrice?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Template {
  id: number;
  name: string;
  meta: string;
  files: number;
  userId?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthPayload {
  userId: number;
  email: string;
  plan: 'free' | 'pro' | 'admin';
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
}

export interface JwtToken {
  accessToken: string;
  expiresIn: number;
}

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
  sort?: string;
  order?: 'ASC' | 'DESC';
}

export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
