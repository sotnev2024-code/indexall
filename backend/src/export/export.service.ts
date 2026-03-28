import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

@Injectable()
export class ExportService {
  exportToXlsx(data: { projectName: string; sheets: any[] }): Buffer {
    const workbook = XLSX.utils.book_new();
    const HEADERS = ['№', 'Название', 'Бренд', 'Артикул', 'Кол-во', 'Ед. изм', 'Цена', 'Магазин', 'Коэф.', 'Итого'];

    for (const sheet of data.sheets) {
      const rows = [HEADERS];
      const dataRows = (sheet.rows || []).filter((r: any) => r.name || r.article);
      dataRows.forEach((r: any, i: number) => {
        rows.push([
          i + 1,
          r.name || '',
          r.brand || '',
          r.article || '',
          r.qty || '',
          r.unit || '',
          r.price || '',
          r.store || '',
          r.coef || 1,
          r.total || '',
        ]);
      });
      for (let i = dataRows.length; i < 25; i++) rows.push([i + 1, '', '', '', '', '', '', '', '', '']);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 5 }, { wch: 60 }, { wch: 15 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(workbook, ws, sheet.name.slice(0, 31));
    }

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }
}
