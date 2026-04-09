// ---------------------------------------------------------------------------
// Document Tools — Read, create, and edit Word, PDF, PowerPoint, and Excel
// ---------------------------------------------------------------------------

import { secureTemporaryFilePath } from '../security/terminalSecurity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.DATA_DIR || '/data';

function agentOutputDir(userId: string, agentId: string): string {
  const path = require('path');
  const dir = path.join(DATA_DIR, 'agents', userId, agentId, 'documents');
  const fs = require('fs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function outputPath(userId: string, agentId: string, fileName: string): string {
  const path = require('path');
  // Sanitize filename to prevent path traversal
  const safe = path.basename(fileName);
  return path.join(agentOutputDir(userId, agentId), safe);
}

// ---------------------------------------------------------------------------
// Word (.docx) — Read
// ---------------------------------------------------------------------------

export async function readWord(filePath: string): Promise<{
  text: string;
  styles: string[];
  metadata: Record<string, string>;
}> {
  const mammoth = await import('mammoth');
  const fs = await import('fs');

  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.convertToHtml({ buffer });
  const textResult = await mammoth.extractRawText({ buffer });

  // Extract styles from HTML
  const styleRegex = /class="([^"]+)"/g;
  const styles = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = styleRegex.exec(result.value)) !== null) {
    styles.add(m[1]);
  }

  return {
    text: textResult.value,
    styles: Array.from(styles),
    metadata: {
      warnings: result.messages.map((msg: any) => msg.message).join('; '),
    },
  };
}

// ---------------------------------------------------------------------------
// Word (.docx) — Create / Edit
// ---------------------------------------------------------------------------

export async function createWord(params: {
  userId: string;
  agentId: string;
  fileName: string;
  content: Array<{
    type: 'heading' | 'paragraph' | 'bullet' | 'table';
    text?: string;
    level?: number;
    style?: string;
    bold?: boolean;
    italic?: boolean;
    rows?: string[][];
  }>;
}): Promise<{ filePath: string; size: number }> {
  const docx = await import('docx');
  const fs = await import('fs');

  const children: any[] = [];

  for (const block of params.content) {
    switch (block.type) {
      case 'heading': {
        const headingLevel = block.level && block.level >= 1 && block.level <= 6
          ? (`HEADING_${block.level}` as keyof typeof docx.HeadingLevel)
          : 'HEADING_1';
        children.push(
          new docx.Paragraph({
            text: block.text || '',
            heading: docx.HeadingLevel[headingLevel as keyof typeof docx.HeadingLevel],
          })
        );
        break;
      }
      case 'paragraph': {
        const runs: any[] = [];
        runs.push(
          new docx.TextRun({
            text: block.text || '',
            bold: block.bold,
            italics: block.italic,
          })
        );
        children.push(new docx.Paragraph({ children: runs, style: block.style }));
        break;
      }
      case 'bullet': {
        children.push(
          new docx.Paragraph({
            text: block.text || '',
            bullet: { level: (block.level || 1) - 1 },
          })
        );
        break;
      }
      case 'table': {
        if (block.rows && block.rows.length > 0) {
          const tableRows = block.rows.map(
            (row) =>
              new docx.TableRow({
                children: row.map(
                  (cell) =>
                    new docx.TableCell({
                      children: [new docx.Paragraph({ text: cell })],
                    })
                ),
              })
          );
          children.push(new docx.Table({ rows: tableRows }));
        }
        break;
      }
    }
  }

  const doc = new docx.Document({
    sections: [{ children }],
  });

  const buffer = await docx.Packer.toBuffer(doc);
  const dest = outputPath(params.userId, params.agentId, params.fileName);
  fs.writeFileSync(dest, buffer);

  return { filePath: dest, size: buffer.length };
}

// ---------------------------------------------------------------------------
// PDF — Read
// ---------------------------------------------------------------------------

export async function readPdf(filePath: string): Promise<{
  text: string;
  pageCount: number;
  metadata: Record<string, string>;
}> {
  const fs = await import('fs');

  const buffer = fs.readFileSync(filePath);
  const uint8 = new Uint8Array(buffer);

  // Use pdfjs-dist for PDF text extraction
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({ data: uint8 });
  const pdf = await loadingTask.promise;

  const textParts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str)
      .join(' ');
    textParts.push(pageText);
  }

  // Try to get metadata
  let metadata: Record<string, string> = {};
  try {
    const meta = await pdf.getMetadata();
    const info = (meta?.info || {}) as Record<string, any>;
    metadata = {
      title: info.Title || '',
      author: info.Author || '',
      subject: info.Subject || '',
      creator: info.Creator || '',
    };
  } catch { /* metadata extraction optional */ }

  return {
    text: textParts.join('\n'),
    pageCount: pdf.numPages,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// PDF — Create / Edit (annotations & comments)
// ---------------------------------------------------------------------------

export async function createPdf(params: {
  userId: string;
  agentId: string;
  fileName: string;
  content: Array<{
    type: 'text' | 'heading' | 'comment' | 'page_break' | 'image';
    text?: string;
    fontSize?: number;
    bold?: boolean;
    x?: number;
    y?: number;
    page?: number;
    imageBase64?: string;
    width?: number;
    height?: number;
  }>;
  pageWidth?: number;
  pageHeight?: number;
}): Promise<{ filePath: string; size: number }> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  const fs = await import('fs');

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageW = params.pageWidth || 595;
  const pageH = params.pageHeight || 842;

  let currentPage = pdfDoc.addPage([pageW, pageH]);
  let cursorY = pageH - 50;
  const marginX = 50;
  const lineSpacing = 1.4;

  for (const block of params.content) {
    switch (block.type) {
      case 'heading': {
        const size = block.fontSize || 18;
        if (cursorY < 60) {
          currentPage = pdfDoc.addPage([pageW, pageH]);
          cursorY = pageH - 50;
        }
        currentPage.drawText(block.text || '', {
          x: marginX,
          y: cursorY,
          size,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        cursorY -= size * lineSpacing + 10;
        break;
      }
      case 'text': {
        const size = block.fontSize || 12;
        const usedFont = block.bold ? boldFont : font;
        const words = (block.text || '').split(' ');
        let line = '';
        const maxWidth = pageW - 2 * marginX;
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          const testWidth = usedFont.widthOfTextAtSize(testLine, size);
          if (testWidth > maxWidth && line) {
            if (cursorY < 60) {
              currentPage = pdfDoc.addPage([pageW, pageH]);
              cursorY = pageH - 50;
            }
            currentPage.drawText(line, {
              x: marginX,
              y: cursorY,
              size,
              font: usedFont,
              color: rgb(0, 0, 0),
            });
            cursorY -= size * lineSpacing;
            line = word;
          } else {
            line = testLine;
          }
        }
        if (line) {
          if (cursorY < 60) {
            currentPage = pdfDoc.addPage([pageW, pageH]);
            cursorY = pageH - 50;
          }
          currentPage.drawText(line, {
            x: marginX,
            y: cursorY,
            size,
            font: usedFont,
            color: rgb(0, 0, 0),
          });
          cursorY -= size * lineSpacing;
        }
        cursorY -= 4;
        break;
      }
      case 'comment': {
        // Add a text annotation (sticky note) to the current page
        const x = block.x ?? marginX;
        const y = block.y ?? cursorY;
        const annotationText = block.text || '';
        // pdf-lib doesn't have native annotation API, so we draw a colored marker + small text
        currentPage.drawText(`[Note] ${annotationText}`, {
          x,
          y,
          size: 9,
          font,
          color: rgb(0.8, 0.5, 0.0),
        });
        cursorY -= 14;
        break;
      }
      case 'image': {
        if (block.imageBase64) {
          try {
            const imgBytes = Buffer.from(block.imageBase64, 'base64');
            let image;
            // Detect PNG vs JPG
            if (imgBytes[0] === 0x89 && imgBytes[1] === 0x50) {
              image = await pdfDoc.embedPng(imgBytes);
            } else {
              image = await pdfDoc.embedJpg(imgBytes);
            }
            const w = block.width || 200;
            const h = block.height || (w * image.height) / image.width;
            if (cursorY - h < 60) {
              currentPage = pdfDoc.addPage([pageW, pageH]);
              cursorY = pageH - 50;
            }
            currentPage.drawImage(image, {
              x: marginX,
              y: cursorY - h,
              width: w,
              height: h,
            });
            cursorY -= h + 10;
          } catch (imgErr: any) {
            currentPage.drawText(`[Error embedding image: ${imgErr.message}]`, {
              x: marginX,
              y: cursorY,
              size: 10,
              font,
              color: rgb(1, 0, 0),
            });
            cursorY -= 14;
          }
        }
        break;
      }
      case 'page_break': {
        currentPage = pdfDoc.addPage([pageW, pageH]);
        cursorY = pageH - 50;
        break;
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  const dest = outputPath(params.userId, params.agentId, params.fileName);
  fs.writeFileSync(dest, Buffer.from(pdfBytes));

  return { filePath: dest, size: pdfBytes.length };
}

// ---------------------------------------------------------------------------
// PDF — Annotate existing PDF
// ---------------------------------------------------------------------------

export async function annotatePdf(params: {
  userId: string;
  agentId: string;
  sourceFilePath: string;
  outputFileName: string;
  annotations: Array<{
    page: number;
    x: number;
    y: number;
    text: string;
    fontSize?: number;
    color?: 'red' | 'blue' | 'green' | 'orange' | 'black';
  }>;
}): Promise<{ filePath: string; size: number }> {
  const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
  const fs = await import('fs');

  const existingPdfBytes = fs.readFileSync(params.sourceFilePath);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const colorMap: Record<string, ReturnType<typeof rgb>> = {
    red: rgb(1, 0, 0),
    blue: rgb(0, 0, 1),
    green: rgb(0, 0.6, 0),
    orange: rgb(0.9, 0.5, 0),
    black: rgb(0, 0, 0),
  };

  const pages = pdfDoc.getPages();
  for (const ann of params.annotations) {
    const pageIdx = (ann.page || 1) - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    page.drawText(ann.text, {
      x: ann.x,
      y: ann.y,
      size: ann.fontSize || 10,
      font,
      color: colorMap[ann.color || 'red'] || colorMap.red,
    });
  }

  const pdfBytes = await pdfDoc.save();
  const dest = outputPath(params.userId, params.agentId, params.outputFileName);
  fs.writeFileSync(dest, Buffer.from(pdfBytes));

  return { filePath: dest, size: pdfBytes.length };
}

// ---------------------------------------------------------------------------
// PowerPoint (.pptx) — Create / Edit
// ---------------------------------------------------------------------------

export async function createPowerPoint(params: {
  userId: string;
  agentId: string;
  fileName: string;
  slides: Array<{
    title?: string;
    subtitle?: string;
    content?: string;
    notes?: string;
    layout?: 'title' | 'content' | 'section' | 'blank' | 'two_column';
    images?: Array<{
      base64: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      caption?: string;
    }>;
    bulletPoints?: string[];
    leftColumn?: string;
    rightColumn?: string;
    backgroundColor?: string;
    fontColor?: string;
  }>;
  author?: string;
  title?: string;
  subject?: string;
}): Promise<{ filePath: string; size: number }> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const fs = await import('fs');

  const pptx = new PptxGenJS();
  if (params.author) pptx.author = params.author;
  if (params.title) pptx.title = params.title;
  if (params.subject) pptx.subject = params.subject;

  for (const slideData of params.slides) {
    const slide = pptx.addSlide();

    if (slideData.backgroundColor) {
      slide.background = { color: slideData.backgroundColor.replace('#', '') };
    }

    const fontColor = slideData.fontColor || '363636';

    const layout = slideData.layout || (slideData.title && !slideData.content ? 'title' : 'content');

    switch (layout) {
      case 'title': {
        slide.addText(slideData.title || '', {
          x: 0.5,
          y: 1.5,
          w: 9,
          h: 1.5,
          fontSize: 36,
          bold: true,
          color: fontColor,
          align: 'center',
        });
        if (slideData.subtitle) {
          slide.addText(slideData.subtitle, {
            x: 0.5,
            y: 3.2,
            w: 9,
            h: 1,
            fontSize: 20,
            color: '666666',
            align: 'center',
          });
        }
        break;
      }
      case 'section': {
        slide.addText(slideData.title || '', {
          x: 0.5,
          y: 2.0,
          w: 9,
          h: 1.5,
          fontSize: 32,
          bold: true,
          color: fontColor,
          align: 'center',
        });
        break;
      }
      case 'two_column': {
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.3,
            w: 9,
            h: 0.8,
            fontSize: 24,
            bold: true,
            color: fontColor,
          });
        }
        slide.addText(slideData.leftColumn || '', {
          x: 0.5,
          y: 1.3,
          w: 4.2,
          h: 4.0,
          fontSize: 14,
          color: fontColor,
          valign: 'top',
        });
        slide.addText(slideData.rightColumn || '', {
          x: 5.3,
          y: 1.3,
          w: 4.2,
          h: 4.0,
          fontSize: 14,
          color: fontColor,
          valign: 'top',
        });
        break;
      }
      case 'blank': {
        // No automatic content placement
        break;
      }
      case 'content':
      default: {
        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5,
            y: 0.3,
            w: 9,
            h: 0.8,
            fontSize: 24,
            bold: true,
            color: fontColor,
          });
        }
        if (slideData.content) {
          slide.addText(slideData.content, {
            x: 0.5,
            y: 1.3,
            w: 9,
            h: 3.5,
            fontSize: 14,
            color: fontColor,
            valign: 'top',
          });
        }
        if (slideData.bulletPoints && slideData.bulletPoints.length > 0) {
          const bulletBody = slideData.bulletPoints.map((bp) => ({
            text: bp,
            options: { bullet: true, fontSize: 14, color: fontColor },
          }));
          slide.addText(bulletBody as any, {
            x: 0.5,
            y: slideData.content ? 3.5 : 1.3,
            w: 9,
            h: slideData.content ? 2.0 : 4.0,
            valign: 'top',
          });
        }
        break;
      }
    }

    // Add images
    if (slideData.images && slideData.images.length > 0) {
      for (const img of slideData.images) {
        try {
          // Detect image type from base64 header or assume PNG
          let dataPrefix = 'data:image/png;base64,';
          const raw = img.base64;
          if (raw.startsWith('data:')) {
            // Already has data URI
            slide.addImage({
              data: raw,
              x: img.x ?? 1,
              y: img.y ?? 1.5,
              w: img.w ?? 4,
              h: img.h ?? 3,
            });
          } else {
            // Detect by first bytes
            const buf = Buffer.from(raw, 'base64');
            if (buf[0] === 0xFF && buf[1] === 0xD8) {
              dataPrefix = 'data:image/jpeg;base64,';
            } else if (buf[0] === 0x47 && buf[1] === 0x49) {
              dataPrefix = 'data:image/gif;base64,';
            }
            slide.addImage({
              data: dataPrefix + raw,
              x: img.x ?? 1,
              y: img.y ?? 1.5,
              w: img.w ?? 4,
              h: img.h ?? 3,
            });
          }
          if (img.caption) {
            slide.addText(img.caption, {
              x: img.x ?? 1,
              y: (img.y ?? 1.5) + (img.h ?? 3) + 0.1,
              w: img.w ?? 4,
              h: 0.4,
              fontSize: 10,
              color: '888888',
              align: 'center',
            });
          }
        } catch (imgErr: any) {
          slide.addText(`[Image error: ${imgErr.message}]`, {
            x: img.x ?? 1,
            y: img.y ?? 2,
            w: 4,
            h: 0.5,
            fontSize: 10,
            color: 'CC0000',
          });
        }
      }
    }

    // Add presenter notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  const dest = outputPath(params.userId, params.agentId, params.fileName);
  await pptx.writeFile({ fileName: dest });
  const stats = fs.statSync(dest);

  return { filePath: dest, size: stats.size };
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) — Read
// ---------------------------------------------------------------------------

export async function readExcel(filePath: string): Promise<{
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    headers: string[];
    data: string[][];
  }>;
}> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default || ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    headers: string[];
    data: string[][];
  }> = [];

  workbook.eachSheet((worksheet: any) => {
    const headers: string[] = [];
    const data: string[][] = [];

    worksheet.eachRow((row: any, rowNumber: any) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: any) => {
        values.push(cell.text || String(cell.value ?? ''));
      });
      if (rowNumber === 1) {
        headers.push(...values);
      }
      data.push(values);
    });

    sheets.push({
      name: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      headers,
      data: data.slice(0, 500), // Limit to 500 rows
    });
  });

  return { sheets };
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) — Create / Edit
// ---------------------------------------------------------------------------

export async function createExcel(params: {
  userId: string;
  agentId: string;
  fileName: string;
  sheets: Array<{
    name: string;
    headers?: string[];
    rows: Array<Array<string | number | boolean | null>>;
    columnWidths?: number[];
    headerStyle?: {
      bold?: boolean;
      backgroundColor?: string;
      fontColor?: string;
    };
    formulas?: Array<{
      cell: string;
      formula: string;
    }>;
    charts?: Array<{
      type: 'bar' | 'line' | 'pie';
      title: string;
      dataRange: string;
    }>;
  }>;
  author?: string;
}): Promise<{ filePath: string; size: number }> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default || ExcelJSModule;
  const fs = await import('fs');

  const workbook = new ExcelJS.Workbook();
  if (params.author) {
    workbook.creator = params.author;
  }
  workbook.created = new Date();

  for (const sheetData of params.sheets) {
    const sheet = workbook.addWorksheet(sheetData.name);

    // Set column widths
    if (sheetData.columnWidths) {
      sheet.columns = sheetData.columnWidths.map((w, i) => ({
        header: sheetData.headers?.[i] || '',
        width: w,
      }));
    } else if (sheetData.headers) {
      sheet.columns = sheetData.headers.map((h) => ({
        header: h,
        width: Math.max(h.length + 4, 12),
      }));
    }

    // Style headers
    if (sheetData.headers && sheetData.headers.length > 0) {
      if (!sheetData.columnWidths) {
        sheet.addRow(sheetData.headers);
      }
      const headerRow = sheet.getRow(1);
      const hStyle = sheetData.headerStyle || { bold: true, backgroundColor: '4472C4', fontColor: 'FFFFFF' };
      headerRow.eachCell((cell: any) => {
        cell.font = {
          bold: hStyle.bold !== false,
          color: { argb: hStyle.fontColor || 'FFFFFFFF' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: hStyle.backgroundColor || 'FF4472C4' },
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }

    // Add data rows
    for (const row of sheetData.rows) {
      sheet.addRow(row);
    }

    // Apply formulas
    if (sheetData.formulas) {
      for (const f of sheetData.formulas) {
        const cell = sheet.getCell(f.cell);
        cell.value = { formula: f.formula } as any;
      }
    }

    // Auto-filter on headers
    if (sheetData.headers && sheetData.headers.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: sheetData.headers.length },
      };
    }
  }

  const dest = outputPath(params.userId, params.agentId, params.fileName);
  await workbook.xlsx.writeFile(dest);
  const stats = fs.statSync(dest);

  return { filePath: dest, size: stats.size };
}

// ---------------------------------------------------------------------------
// Edit existing Excel
// ---------------------------------------------------------------------------

export async function editExcel(params: {
  userId: string;
  agentId: string;
  sourceFilePath: string;
  outputFileName: string;
  operations: Array<{
    sheet?: string | number;
    type: 'set_cell' | 'add_row' | 'delete_row' | 'set_formula' | 'add_sheet' | 'rename_sheet';
    cell?: string;
    value?: string | number | boolean | null;
    row?: Array<string | number | boolean | null>;
    rowIndex?: number;
    formula?: string;
    sheetName?: string;
    newName?: string;
  }>;
}): Promise<{ filePath: string; size: number }> {
  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as any).default || ExcelJSModule;
  const fs = await import('fs');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(params.sourceFilePath);

  for (const op of params.operations) {
    let sheet: any = null;
    if (typeof op.sheet === 'number') {
      sheet = workbook.getWorksheet(op.sheet);
    } else if (typeof op.sheet === 'string') {
      sheet = workbook.getWorksheet(op.sheet);
    } else {
      sheet = workbook.worksheets[0];
    }

    switch (op.type) {
      case 'set_cell': {
        if (sheet && op.cell) {
          sheet.getCell(op.cell).value = op.value;
        }
        break;
      }
      case 'add_row': {
        if (sheet && op.row) {
          sheet.addRow(op.row);
        }
        break;
      }
      case 'delete_row': {
        if (sheet && op.rowIndex) {
          sheet.spliceRows(op.rowIndex, 1);
        }
        break;
      }
      case 'set_formula': {
        if (sheet && op.cell && op.formula) {
          sheet.getCell(op.cell).value = { formula: op.formula } as any;
        }
        break;
      }
      case 'add_sheet': {
        if (op.sheetName) {
          workbook.addWorksheet(op.sheetName);
        }
        break;
      }
      case 'rename_sheet': {
        if (sheet && op.newName) {
          sheet.name = op.newName;
        }
        break;
      }
    }
  }

  const dest = outputPath(params.userId, params.agentId, params.outputFileName);
  await workbook.xlsx.writeFile(dest);
  const stats = fs.statSync(dest);

  return { filePath: dest, size: stats.size };
}

// ---------------------------------------------------------------------------
// Cleanup — Remove all generated documents for an agent
// ---------------------------------------------------------------------------

export function clearAgentDocuments(userId: string, agentId: string): number {
  const path = require('path');
  const fs = require('fs');

  const dir = path.join(DATA_DIR, 'agents', userId, agentId, 'documents');
  try {
    if (!fs.existsSync(dir)) return 0;
    const files: string[] = fs.readdirSync(dir);
    let deleted = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(dir, file));
        deleted += 1;
      } catch { /* keep deleting the rest */ }
    }
    // Remove the now-empty directory
    try { fs.rmdirSync(dir); } catch { /* ignore */ }
    return deleted;
  } catch {
    return 0;
  }
}
