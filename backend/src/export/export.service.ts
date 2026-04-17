import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

@Injectable()
export class ExportService {
  exportToXlsx(data: { projectName: string; sheets: any[] }): Buffer {
    const workbook = XLSX.utils.book_new();
    const BASE_HEADERS = ['№', 'Название', 'Бренд', 'Артикул', 'Кол-во', 'Ед. изм', 'Цена с НДС, ₽', 'Источник', 'Коэф.', 'Итого, ₽', 'Срок'];
    const now = new Date().toLocaleDateString('ru-RU');

    for (const sheet of data.sheets) {
      const dataRows = (sheet.rows || []).filter((r: any) => r.name || r.article);
      const customCols: { key: string; label: string }[] = sheet.custom_columns || [];
      const HEADERS = [...BASE_HEADERS, ...customCols.map(c => c.label)];
      const totalCols = HEADERS.length;
      const emptyPad = Array(customCols.length).fill('');

      // Row 1: project name + date, Row 2: empty, Row 3: headers, Row 4+: data
      const titleRow = Array(totalCols).fill('');
      titleRow[0] = `Проект: ${data.projectName}`;
      titleRow[10] = `Дата: ${now}`;
      const aoa: any[][] = [titleRow, [], HEADERS];

      dataRows.forEach((r: any, i: number) => {
        const customVals = customCols.map(c => (r.custom || {})[c.key] || '');
        aoa.push([
          i + 1,
          r.name || '',
          r.brand || '',
          r.article || '',
          r.qty !== '' && r.qty != null ? Number(r.qty) || r.qty : '',
          r.unit || '',
          r.price !== '' && r.price != null ? Number(r.price) || r.price : '',
          r.store || '',
          r.coef !== '' && r.coef != null ? Number(r.coef) || 1 : 1,
          r.total !== '' && r.total != null ? Number(r.total) || r.total : '',
          r.deadline || '',
          ...customVals,
        ]);
      });

      // Empty rows padding to at least 1000 data rows
      const emptyRow = (i: number) => [i + 1, '', '', '', '', '', '', '', '', '', '', ...emptyPad];
      for (let i = dataRows.length; i < 1000; i++) {
        aoa.push(emptyRow(i));
      }

      // Totals row
      const totalSum = dataRows.reduce((s: number, r: any) => s + (parseFloat(r.total) || 0), 0);
      aoa.push([]);
      aoa.push(['', 'ИТОГО:', '', '', '', '', '', '', '', totalSum > 0 ? Math.round(totalSum * 100) / 100 : '', '']);

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Ensure sheet range covers all columns
      const lastColLetter = XLSX.utils.encode_col(totalCols - 1);
      ws['!ref'] = `A1:${lastColLetter}${aoa.length}`;

      // Column widths
      ws['!cols'] = [
        { wch: 5 },  // №
        { wch: 55 }, // Название
        { wch: 14 }, // Бренд
        { wch: 18 }, // Артикул
        { wch: 8 },  // Кол-во
        { wch: 8 },  // Ед. изм
        { wch: 12 }, // Цена
        { wch: 12 }, // Источник
        { wch: 8 },  // Коэф.
        { wch: 14 }, // Итого
        { wch: 10 }, // Срок
        ...customCols.map(() => ({ wch: 14 })),
      ];

      // Merge project title across row 1
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(10, totalCols - 1) } }];

      // Style header row (row index 2 = 0-based)
      const headerRowIdx = 2;
      HEADERS.forEach((_, ci) => {
        const cellAddr = XLSX.utils.encode_cell({ r: headerRowIdx, c: ci });
        if (!ws[cellAddr]) ws[cellAddr] = { v: HEADERS[ci], t: 's' };
        ws[cellAddr].s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '2563EB' } },
          alignment: { horizontal: 'center', wrapText: true },
          border: {
            bottom: { style: 'thin', color: { rgb: 'BBBBBB' } },
          },
        };
      });

      // Style project title (row 0)
      const titleCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
      if (ws[titleCell]) {
        ws[titleCell].s = { font: { bold: true, sz: 13 } };
      }

      // Style totals label
      const totalsLabelRow = aoa.length - 1;
      const labelCell = XLSX.utils.encode_cell({ r: totalsLabelRow, c: 1 });
      const valueCell = XLSX.utils.encode_cell({ r: totalsLabelRow, c: 9 });
      if (ws[labelCell]) ws[labelCell].s = { font: { bold: true } };
      if (ws[valueCell]) ws[valueCell].s = { font: { bold: true }, numFmt: '#,##0.00' };

      // Autofilter on header row
      ws['!autofilter'] = { ref: `A3:${lastColLetter}3` };

      // Excel sheet names: max 31 chars, must be unique, cannot be empty
      const usedNames = new Set(workbook.SheetNames);
      let sheetName = (sheet.name || `Лист${data.sheets.indexOf(sheet) + 1}`).slice(0, 28);
      let attempt = sheetName;
      let n = 2;
      while (usedNames.has(attempt)) { attempt = `${sheetName.slice(0, 25)} (${n++})`; }
      XLSX.utils.book_append_sheet(workbook, ws, attempt);
    }

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }
}
