import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/auth/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// ── Auth ──────────────────────────────────────────────────────
export const authApi = {
  register: (email: string, password: string) => api.post('/auth/register', { email, password }),
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  confirmEmail: (token: string) => api.get('/auth/confirm', { params: { token } }),
  confirmResend: (email: string) => api.post('/auth/confirm/resend', { email }),
  resetRequest: (email: string) => api.post('/auth/password/reset-request', { email }),
  resetPassword: (token: string, newPassword: string) => api.post('/auth/password/reset', { token, newPassword }),
};

// ── Folders ───────────────────────────────────────────────────
export const foldersApi = {
  getTree:        (type = 'projects') => api.get('/folders', { params: { type } }),
  getOne:         (id: number) => api.get(`/folders/${id}`),
  create:         (name: string, parent_id: number | null, type = 'projects') =>
                    api.post('/folders', { name, parent_id, type }),
  rename:         (id: number, name: string) => api.put(`/folders/${id}`, { name }),
  move:           (id: number, parent_id: number | null) =>
                    api.put(`/folders/${id}/move`, { parent_id }),
  remove:         (id: number) => api.delete(`/folders/${id}`),
  createSheet:    (folderId: number, name?: string) =>
                    api.post(`/folders/${folderId}/sheets`, { name }),
  moveSheet:      (sheetId: number, folder_id: number) =>
                    api.put(`/folders/sheets/${sheetId}/move`, { folder_id }),
  moveTemplate:   (templateId: number, folder_id: number | null) =>
                    api.put(`/folders/templates/${templateId}/move`, { folder_id }),
  reorderSheets:  (folderId: number, ids: number[]) =>
                    api.put(`/folders/${folderId}/sheets/reorder`, { ids }),
  reorder:             (ids: number[]) => api.put('/folders/reorder/batch', { ids }),
  // Save as template
  saveFolderAsTemplate:(id: number, name: string, templateFolderId?: number | null) =>
                         api.post(`/folders/${id}/save-as-template`, { name, template_folder_id: templateFolderId ?? null }),
  saveSheetAsTemplate: (sheetId: number, name: string, templateFolderId?: number | null) =>
                         api.post(`/folders/sheets/${sheetId}/save-as-template`, { name, template_folder_id: templateFolderId ?? null }),
  // Load template
  loadTemplateFolder:  (templateFolderId: number, mode: 'new'|'into', targetFolderId?: number | null) =>
                         api.post('/folders/load-template-folder', { template_folder_id: templateFolderId, mode, target_folder_id: targetFolderId ?? null }),
  loadTemplateSheet:   (templateId: number, mode: 'new'|'into', targetFolderId?: number | null) =>
                         api.post('/folders/load-template-sheet', { template_id: templateId, mode, target_folder_id: targetFolderId ?? null }),
};

// ── Projects ──────────────────────────────────────────────────
export const projectsApi = {
  getAll: () => api.get('/projects'),
  getOne: (id: number) => api.get(`/projects/${id}`),
  create: (name: string) => api.post('/projects', { name }),
  update: (id: number, data: any) => api.put(`/projects/${id}`, data),
  duplicate: (id: number) => api.post(`/projects/${id}/duplicate`),
  remove: (id: number) => api.delete(`/projects/${id}`),
  reorder: (ids: number[]) => api.put('/projects/reorder', { ids }),
  reorderSheets: (projectId: number, ids: number[]) => api.put(`/projects/${projectId}/reorder-sheets`, { ids }),
};

// ── Sheets ────────────────────────────────────────────────────
export const sheetsApi = {
  create: (projectId: number, name?: string) => api.post(`/sheets/project/${projectId}`, { name }),
  getOne: (id: number) => api.get(`/sheets/${id}`),
  update: (id: number, data: any) => api.put(`/sheets/${id}`, data),
  duplicate: (id: number) => api.post(`/sheets/${id}/duplicate`),
  remove: (id: number) => api.delete(`/sheets/${id}`),
  saveRows: (id: number, rows: any[]) => api.put(`/sheets/${id}/rows`, { rows }),
};

// ── Catalog ───────────────────────────────────────────────────
export const catalogApi = {
  getManufacturers: () => api.get('/catalog/manufacturers'),
  getTree: (manufacturerId?: number) => api.get('/catalog/tree', { params: { manufacturerId } }),
  getProducts: (categoryId: number, attrs?: Record<string, string>) => api.get('/catalog/products', { params: { categoryId, ...(attrs && Object.keys(attrs).length ? { attrs: JSON.stringify(attrs) } : {}) } }),
  search: (q: string) => api.get('/catalog/search', { params: { q } }),
  getPriceLists: () => api.get('/catalog/pricelists'),
  uploadPriceList: (formData: FormData) => api.post('/catalog/pricelists/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  replacePriceList: (id: number, formData: FormData) => api.post(`/catalog/pricelists/${id}/replace`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deletePriceList: (id: number) => api.delete(`/catalog/pricelists/${id}`),
  setPriceListStatus: (id: number, active: boolean) => api.patch(`/catalog/pricelists/${id}/status`, { active }),
  downloadPriceList: (id: number) => api.get(`/catalog/pricelists/${id}/download`, { responseType: 'blob' }),
  getAnalogs: (productId: number) => api.get(`/catalog/products/${productId}/analogs`),
  getAccessories: (productId: number) => api.get(`/catalog/products/${productId}/accessories`),
  filterProducts: (slug: string, brands?: string[], extraFilters?: Record<string, string[]>) => {
    const params: Record<string, string> = { slug };
    if (brands?.length) params.brands = brands.join(',');
    // Pass non-brand filters as JSON for parametric backend filtering
    const nonBrand = extraFilters
      ? Object.fromEntries(Object.entries(extraFilters).filter(([k, v]) => k !== 'Производитель' && v.length > 0))
      : {};
    if (Object.keys(nonBrand).length) params.filters = JSON.stringify(nonBrand);
    return api.get('/catalog/products/filter', { params });
  },
  getTiles: () => api.get('/catalog/tiles'),
  getTilesAll: () => api.get('/catalog/tiles/all'),
  createTile: (data: any) => api.post('/catalog/tiles', data),
  updateTile: (id: number, data: any) => api.put(`/catalog/tiles/${id}`, data),
  deleteTile: (id: number) => api.delete(`/catalog/tiles/${id}`),
  uploadTileImage: (id: number, fd: FormData) => api.post(`/catalog/tiles/${id}/image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  // Tile data (Excel upload per tile)
  previewTileExcel: (fd: FormData) => api.post<{ headers: string[]; rows: any[][] }>('/catalog/tiles/preview-excel', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadTileData: (id: number, fd: FormData) => api.post('/catalog/tiles/' + id + '/data', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deleteTileData: (id: number) => api.delete(`/catalog/tiles/${id}/data`),
  /** Returns dynamic filter options for a given category slug */
  getFilterOptions: (slug: string) => api.get<{ label: string; opts: string[] }[]>('/catalog/filter-options', { params: { slug } }),
  getPricesByArticles: (articles: string[]) => api.post<Record<string, { price: number; manufacturer: string } | null>>('/catalog/prices-by-articles', { articles }),
};

// ── Templates ─────────────────────────────────────────────────
export const templatesApi = {
  getAll: (params?: any) => api.get('/templates', { params }),
  getOne: (id: number) => api.get(`/templates/${id}`),
  create: (data: any) => api.post('/templates', data),
  createFromSheet: (data: any) => api.post('/templates/from-sheet', data),
  update: (id: number, data: any) => api.put(`/templates/${id}`, data),
  remove: (id: number) => api.delete(`/templates/${id}`),
  toggleFavorite: (id: number) => api.post(`/templates/${id}/favorite`),
  addFile: (id: number, formData: FormData) => api.post(`/templates/${id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  removeFile: (fileId: number) => api.delete(`/templates/files/${fileId}`),
  // Admin
  getAllForAdmin: () => api.get('/templates/admin/all'),
  makeCommon:    (id: number) => api.post(`/templates/${id}/make-common`),
  unmakeCommon:  (id: number) => api.post(`/templates/${id}/unmake-common`),
};

// ── Export ────────────────────────────────────────────────────
export const exportApi = {
  xlsx: (params: { projectId?: number; folderId?: number; sheetId?: number }) =>
    api.post('/export/xlsx', params, { responseType: 'blob' }),
};

// ── Stores ────────────────────────────────────────────────────
export const storesApi = {
  getAll: () => api.get('/stores'),
  getOffersByArticle: (article: string) => api.get('/stores/offers', { params: { article } }),
  getEtmStatus: () => api.get<{ configured: boolean; usingProxy?: boolean }>('/stores/etm/status'),
  // Returns { [article]: price | null } — takes up to 1.1s per article (ETM rate limit)
  getEtmPrices: (articles: string[]) => api.post<Record<string, number | null>>('/stores/etm/prices', { articles }),
  // Returns { [article]: { price, term } } — uses 7-day cache + batching (50 articles/request)
  getEtmPricesWithTerms: (articles: string[], skipCache = false) =>
    api.post<Record<string, { price: number | null; term: string }>>(
      '/stores/etm/prices-with-terms',
      { articles, skipCache },
    ),
  getEtmCredentials: () => api.get('/stores/etm/credentials'),
  saveEtmCredentials: (login: string, password: string) => api.post('/stores/etm/credentials', { login, password }),
  removeEtmCredentials: () => api.delete('/stores/etm/credentials'),
};

// ── Trash ─────────────────────────────────────────────────────
export const trashApi = {
  getAll: () => api.get('/trash'),
  restore: (id: number) => api.post(`/trash/${id}/restore`),
  permanentDelete: (id: number) => api.delete(`/trash/${id}`),
};

// ── Admin ─────────────────────────────────────────────────────
export const adminApi = {
  getUsers: () => api.get('/admin/users'),
  updateUserPlan: (id: number, plan: string) => api.patch(`/admin/users/${id}/plan`, { plan }),
  updateUserStatus: (id: number, status: string) => api.patch(`/admin/users/${id}/status`, { status }),
  updateUserVerified: (id: number, emailVerified: boolean) => api.patch(`/admin/users/${id}/verified`, { emailVerified }),
  updateUserSubscription: (id: number, subscriptionExpiresAt: string | null) => api.patch(`/admin/users/${id}/subscription`, { subscriptionExpiresAt }),
  updateUserPassword: (id: number, newPassword: string) => api.patch(`/admin/users/${id}/password`, { newPassword }),
  getStats: () => api.get('/admin/stats'),
  getConversions: () => api.get('/admin/conversions'),
  getTariffOperations: () => api.get('/admin/tariff-operations'),
  createTariffOperation: (data: any) => api.post('/admin/tariff-operations', data),
  deleteTariffOperation: (id: number) => api.delete(`/admin/tariff-operations/${id}`),
  getAdminTemplates: () => api.get('/admin/templates'),
  getAdminTemplatesTree: () => api.get('/admin/templates-tree'),
  publishFolderAsCommon: (id: number) => api.post(`/admin/folders/${id}/publish-as-common`, {}),
  publishTemplate: (id: number) => api.post(`/admin/templates/${id}/publish`, {}),
  toggleTemplateActive: (id: number) => api.patch(`/admin/templates/${id}/toggle-active`, {}),
  deleteAdminTemplate: (id: number) => api.delete(`/admin/templates/${id}`),
  getPricelists: () => api.get('/admin/pricelists'),
  getTilesStats: () => api.get('/admin/tiles-stats'),
  getTariffConfigs: () => api.get('/admin/tariff-configs'),
  updateTariffConfig: (id: number, data: { name?: string; price?: number; description?: string; is_active?: boolean }) =>
    api.put(`/admin/tariff-configs/${id}`, data),
};

// ── Profile ───────────────────────────────────────────────────
export const profileApi = {
  updateProfile: (data: { name?: string; email?: string }) => api.patch('/auth/profile', data),
  changePassword: (data: { oldPassword: string; newPassword: string }) => api.patch('/auth/change-password', data),
};

// ── Payments / Subscriptions ──────────────────────────────────
export const paymentsApi = {
  getPlans: () => api.get('/payments/plans'),
  createPayment: (planType: 'monthly' | 'annual', returnUrl?: string) =>
    api.post('/payments/create', { planType, ...(returnUrl ? { returnUrl } : {}) }),
  getStatus: (paymentId: string) =>
    api.get(`/payments/status/${paymentId}`),
  confirmPayment: (paymentId: string) =>
    api.post(`/payments/confirm/${paymentId}`),
  activateTrial: () =>
    api.post('/auth/trial'),
};
