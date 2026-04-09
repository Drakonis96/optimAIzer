// ---------------------------------------------------------------------------
// Document Tools — Read, create, and edit Word, PDF, PowerPoint, and Excel
// ---------------------------------------------------------------------------

import { secureTemporaryFilePath } from '../security/terminalSecurity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the root directory for agent data — same logic as storage.ts */
function resolveAgentsDataRoot(): string {
  const path = require('path');
  const explicitRoot = (process.env.OPTIMAIZER_AGENTS_DATA_ROOT || '').trim();
  if (explicitRoot) return path.resolve(explicitRoot);
  return path.resolve(__dirname, '../../../data/agents');
}

function agentOutputDir(userId: string, agentId: string): string {
  const path = require('path');
  const dir = path.join(resolveAgentsDataRoot(), userId, agentId, 'documents');
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

/** Map user-friendly alignment string to docx AlignmentType */
function resolveAlignment(docx: any, align?: string): any {
  if (!align) return undefined;
  const map: Record<string, string> = {
    left: 'LEFT',
    center: 'CENTER',
    right: 'RIGHT',
    justified: 'JUSTIFIED',
    justify: 'JUSTIFIED',
    both: 'JUSTIFIED',
  };
  const key = map[align.toLowerCase()];
  return key ? docx.AlignmentType[key] : undefined;
}

/** Convert line-spacing multiplier (1.0, 1.5, 2.0) to 240ths-of-a-line */
function lineSpacingToTwips(multiplier: number): number {
  return Math.round(multiplier * 240);
}

/** Convert points to twips (1 pt = 20 twips) */
function pointsToTwips(pts: number): number {
  return Math.round(pts * 20);
}

/** Convert centimetres to twips (1 cm ≈ 567 twips) */
function cmToTwips(cm: number): number {
  return Math.round(cm * 567);
}

interface WordFormatting {
  alignment?: 'left' | 'center' | 'right' | 'justified';
  lineSpacing?: number;      // multiplier: 1.0, 1.15, 1.5, 2.0 …
  spacingBefore?: number;    // points
  spacingAfter?: number;     // points
  firstLineIndent?: number;  // centimetres
  fontSize?: number;         // points
  fontFamily?: string;
}

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
    underline?: boolean;
    rows?: string[][];
    // Per-block formatting overrides
    alignment?: string;
    lineSpacing?: number;
    spacingBefore?: number;
    spacingAfter?: number;
    firstLineIndent?: number;
    fontSize?: number;
    fontFamily?: string;
  }>;
  formatting?: WordFormatting;
}): Promise<{ filePath: string; size: number }> {
  const docx = await import('docx');
  const fs = await import('fs');

  const fmt = params.formatting || {};
  const children: any[] = [];

  /** Build spacing object from defaults + per-block overrides */
  const buildSpacing = (block: any) => {
    const ls = block.lineSpacing ?? fmt.lineSpacing;
    const sb = block.spacingBefore ?? fmt.spacingBefore;
    const sa = block.spacingAfter ?? fmt.spacingAfter;
    if (ls == null && sb == null && sa == null) return undefined;
    const obj: any = {};
    if (ls != null) {
      obj.line = lineSpacingToTwips(ls);
      obj.lineRule = docx.LineRuleType.AUTO;
    }
    if (sb != null) obj.before = pointsToTwips(sb);
    if (sa != null) obj.after = pointsToTwips(sa);
    return obj;
  };

  /** Build indent object from defaults + per-block overrides */
  const buildIndent = (block: any) => {
    const fli = block.firstLineIndent ?? fmt.firstLineIndent;
    if (fli == null) return undefined;
    return { firstLine: cmToTwips(fli) };
  };

  /** Resolve alignment for a block (block override > document default) */
  const blockAlignment = (block: any) =>
    resolveAlignment(docx, block.alignment ?? fmt.alignment);

  /** Build a TextRun for a given block, respecting font defaults */
  const buildTextRun = (block: any) => {
    const opts: any = {
      text: block.text || '',
      bold: block.bold,
      italics: block.italic,
    };
    if (block.underline) opts.underline = { type: docx.UnderlineType.SINGLE };
    const size = block.fontSize ?? fmt.fontSize;
    if (size) opts.size = size * 2; // docx uses half-points
    const font = block.fontFamily ?? fmt.fontFamily;
    if (font) opts.font = font;
    return new docx.TextRun(opts);
  };

  for (const block of params.content) {
    switch (block.type) {
      case 'heading': {
        const headingLevel = block.level && block.level >= 1 && block.level <= 6
          ? (`HEADING_${block.level}` as keyof typeof docx.HeadingLevel)
          : 'HEADING_1';
        const headingOpts: any = {
          children: [buildTextRun(block)],
          heading: docx.HeadingLevel[headingLevel as keyof typeof docx.HeadingLevel],
        };
        const ha = resolveAlignment(docx, block.alignment);
        if (ha) headingOpts.alignment = ha;
        const hs = buildSpacing(block);
        if (hs) headingOpts.spacing = hs;
        children.push(new docx.Paragraph(headingOpts));
        break;
      }
      case 'paragraph': {
        const paraOpts: any = {
          children: [buildTextRun(block)],
          style: block.style,
        };
        const pa = blockAlignment(block);
        if (pa) paraOpts.alignment = pa;
        const ps = buildSpacing(block);
        if (ps) paraOpts.spacing = ps;
        const pi = buildIndent(block);
        if (pi) paraOpts.indent = pi;
        children.push(new docx.Paragraph(paraOpts));
        break;
      }
      case 'bullet': {
        const bulletOpts: any = {
          children: [buildTextRun(block)],
          bullet: { level: (block.level || 1) - 1 },
        };
        const ba = blockAlignment(block);
        if (ba) bulletOpts.alignment = ba;
        const bs = buildSpacing(block);
        if (bs) bulletOpts.spacing = bs;
        children.push(new docx.Paragraph(bulletOpts));
        break;
      }
      case 'table': {
        if (block.rows && block.rows.length > 0) {
          const tblAlignment = blockAlignment(block);
          const tblSpacing = buildSpacing(block);
          const tableRows = block.rows.map(
            (row) =>
              new docx.TableRow({
                children: row.map(
                  (cell) => {
                    const cellParaOpts: any = { text: cell };
                    if (tblAlignment) cellParaOpts.alignment = tblAlignment;
                    if (tblSpacing) cellParaOpts.spacing = tblSpacing;
                    return new docx.TableCell({
                      children: [new docx.Paragraph(cellParaOpts)],
                    });
                  }
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
// Word (.docx) — Edit existing document
// ---------------------------------------------------------------------------

export async function editWord(params: {
  userId: string;
  agentId: string;
  sourceFilePath: string;
  outputFileName: string;
  operations: Array<{
    type: 'replace_text' | 'append_paragraph' | 'set_formatting';
    /** For replace_text: the text to find */
    find?: string;
    /** For replace_text: the replacement text */
    replace?: string;
    /** For append_paragraph: text to add */
    text?: string;
    bold?: boolean;
    italic?: boolean;
    /** For set_formatting: applies document-wide formatting */
    formatting?: WordFormatting;
  }>;
}): Promise<{ filePath: string; size: number }> {
  const JSZip = (await import('jszip')).default;
  const fs = await import('fs');
  const path = await import('path');

  const data = fs.readFileSync(params.sourceFilePath);
  const zip = await JSZip.loadAsync(data);

  for (const op of params.operations) {
    switch (op.type) {
      case 'replace_text': {
        if (!op.find) break;
        // Replace in main document body
        const docXml = await zip.file('word/document.xml')?.async('string');
        if (docXml) {
          // XML-escape the search/replace strings for safety
          const escapedFind = op.find.replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));
          const escapedReplace = (op.replace || '').replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));
          const newXml = docXml.split(escapedFind).join(escapedReplace);
          zip.file('word/document.xml', newXml);
        }
        break;
      }
      case 'append_paragraph': {
        const docXml = await zip.file('word/document.xml')?.async('string');
        if (docXml && op.text) {
          // Build a <w:p> element with optional bold/italic
          let runProps = '';
          if (op.bold) runProps += '<w:b/>';
          if (op.italic) runProps += '<w:i/>';
          const rPr = runProps ? `<w:rPr>${runProps}</w:rPr>` : '';
          const newPara = `<w:p><w:r>${rPr}<w:t xml:space="preserve">${
            op.text.replace(/[&<>"']/g, (c) =>
              ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c))
          }</w:t></w:r></w:p>`;
          // Insert before closing </w:body>
          const newDoc = docXml.replace('</w:body>', newPara + '</w:body>');
          zip.file('word/document.xml', newDoc);
        }
        break;
      }
      case 'set_formatting': {
        const docXml = await zip.file('word/document.xml')?.async('string');
        if (docXml && op.formatting) {
          let modified = docXml;
          const f = op.formatting;

          // Build pPr XML snippet for formatting
          let pPrContent = '';
          if (f.alignment) {
            const jcMap: Record<string, string> = {
              left: 'left', center: 'center', right: 'right',
              justified: 'both', justify: 'both', both: 'both',
            };
            pPrContent += `<w:jc w:val="${jcMap[f.alignment] || 'left'}"/>`;
          }
          if (f.lineSpacing != null || f.spacingBefore != null || f.spacingAfter != null) {
            let spacingAttrs = '';
            if (f.lineSpacing != null) spacingAttrs += ` w:line="${lineSpacingToTwips(f.lineSpacing)}" w:lineRule="auto"`;
            if (f.spacingBefore != null) spacingAttrs += ` w:before="${pointsToTwips(f.spacingBefore)}"`;
            if (f.spacingAfter != null) spacingAttrs += ` w:after="${pointsToTwips(f.spacingAfter)}"`;
            pPrContent += `<w:spacing${spacingAttrs}/>`;
          }
          if (f.firstLineIndent != null) {
            pPrContent += `<w:ind w:firstLine="${cmToTwips(f.firstLineIndent)}"/>`;
          }

          if (pPrContent) {
            // Add/replace pPr in every <w:p> element
            // Strategy: insert pPr after each <w:p> opening tag where no <w:pPr> exists,
            // and augment existing <w:pPr> blocks.
            
            // For paragraphs WITHOUT existing <w:pPr>: add one
            modified = modified.replace(/<w:p(?:\s[^>]*)?>(?![\s\S]*?<w:pPr)/g, (match) => {
              return match + `<w:pPr>${pPrContent}</w:pPr>`;
            });

            // For paragraphs WITH existing <w:pPr>: inject our properties before </w:pPr>
            // (existing properties will take precedence if there are duplicates in some parsers,
            //  but we insert at the beginning to override)
            modified = modified.replace(/<w:pPr>/g, `<w:pPr>${pPrContent}`);
          }

          zip.file('word/document.xml', modified);
        }
        break;
      }
    }
  }

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const dest = outputPath(params.userId, params.agentId, params.outputFileName);
  fs.writeFileSync(dest, outBuf);

  return { filePath: dest, size: outBuf.length };
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
// PowerPoint (.pptx) — Edit existing presentation
// ---------------------------------------------------------------------------

export async function editPowerPoint(params: {
  userId: string;
  agentId: string;
  sourceFilePath: string;
  outputFileName: string;
  operations: Array<{
    type: 'set_notes' | 'replace_text' | 'set_title';
    /** 1-based slide number */
    slide: number;
    /** New notes text (for set_notes) */
    notes?: string;
    /** Text to find (for replace_text) */
    find?: string;
    /** Replacement text (for replace_text / set_title) */
    replace?: string;
    /** New title (for set_title) */
    title?: string;
  }>;
}): Promise<{ filePath: string; size: number }> {
  const JSZip = (await import('jszip')).default;
  const fs = await import('fs');

  const data = fs.readFileSync(params.sourceFilePath);
  const zip = await JSZip.loadAsync(data);

  // Helper: XML-escape text
  const xmlEscape = (s: string) =>
    s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c));

  // Discover how many slides exist
  const slideFiles = Object.keys(zip.files).filter(
    (f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)
  ).sort();

  for (const op of params.operations) {
    const slideIdx = op.slide; // 1-based
    if (slideIdx < 1 || slideIdx > slideFiles.length) continue;

    switch (op.type) {
      case 'set_notes': {
        if (!op.notes) break;
        const notesPath = `ppt/notesSlides/notesSlide${slideIdx}.xml`;
        const escaped = xmlEscape(op.notes);

        if (zip.file(notesPath)) {
          // Notes file exists — replace the body text
          let notesXml = await zip.file(notesPath)!.async('string');
          // Replace content in the second <a:p> block (first is slide number placeholder)
          // Strategy: replace all <a:t> content in the notes body
          notesXml = notesXml.replace(
            /(<a:t>)([\s\S]*?)(<\/a:t>)/g,
            (match, open, _text, close, offset) => {
              // Skip the first occurrence (slide number) by checking position
              return `${open}${escaped}${close}`;
            }
          );
          zip.file(notesPath, notesXml);
        } else {
          // No notes file — create one
          const slideRelPath = `ppt/slides/_rels/slide${slideIdx}.xml.rels`;
          const noteBody = escaped.split('\n').map(
            (line: string) =>
              `<a:p><a:r><a:rPr lang="es-ES" dirty="0"/><a:t>${line}</a:t></a:r></a:p>`
          ).join('');

          const notesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${noteBody}</p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>`;
          zip.file(notesPath, notesXml);

          // Add relationship in slide rels
          const slideRels = await zip.file(slideRelPath)?.async('string');
          if (slideRels) {
            const relId = `rIdNotes${slideIdx}`;
            if (!slideRels.includes('notesSlide')) {
              const newRel = `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideIdx}.xml"/>`;
              const updated = slideRels.replace('</Relationships>', newRel + '</Relationships>');
              zip.file(slideRelPath, updated);
            }
          }

          // Ensure Content_Types has the notes content type
          const ctFile = '[Content_Types].xml';
          let ct = await zip.file(ctFile)?.async('string') || '';
          if (!ct.includes(`/ppt/notesSlides/notesSlide${slideIdx}.xml`)) {
            const override = `<Override PartName="/ppt/notesSlides/notesSlide${slideIdx}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`;
            ct = ct.replace('</Types>', override + '</Types>');
            zip.file(ctFile, ct);
          }
        }
        break;
      }
      case 'replace_text': {
        if (!op.find) break;
        const slideFile = slideFiles[slideIdx - 1];
        let slideXml = await zip.file(slideFile)!.async('string');
        const escapedFind = xmlEscape(op.find);
        const escapedReplace = xmlEscape(op.replace || '');
        slideXml = slideXml.split(escapedFind).join(escapedReplace);
        zip.file(slideFile, slideXml);
        break;
      }
      case 'set_title': {
        if (!op.title) break;
        const slideFile = slideFiles[slideIdx - 1];
        let slideXml = await zip.file(slideFile)!.async('string');
        // Find the first <a:t> in a shape with ph type="title" or "ctrTitle" and replace
        const titleRegex = /(ph type="(?:title|ctrTitle)"[\s\S]*?<a:t>)([\s\S]*?)(<\/a:t>)/;
        const escaped = xmlEscape(op.title);
        slideXml = slideXml.replace(titleRegex, `$1${escaped}$3`);
        zip.file(slideFile, slideXml);
        break;
      }
    }
  }

  const outBuf = await zip.generateAsync({ type: 'nodebuffer' });
  const dest = outputPath(params.userId, params.agentId, params.outputFileName);
  fs.writeFileSync(dest, outBuf);

  return { filePath: dest, size: outBuf.length };
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

    // Add data rows — detect formula strings (starting with '=')
    for (const row of sheetData.rows) {
      const addedRow = sheet.addRow(row);
      // Post-process: convert any cell whose value starts with '=' into a formula
      addedRow.eachCell({ includeEmpty: false }, (cell: any) => {
        if (typeof cell.value === 'string' && cell.value.startsWith('=')) {
          cell.value = { formula: cell.value.slice(1), result: undefined } as any;
        }
      });
    }

    // Apply formulas
    if (sheetData.formulas) {
      for (const f of sheetData.formulas) {
        const cell = sheet.getCell(f.cell);
        // Strip leading '=' if present — ExcelJS expects bare formulas
        const cleanFormula = f.formula.startsWith('=') ? f.formula.slice(1) : f.formula;
        cell.value = { formula: cleanFormula, result: undefined } as any;
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
          const cleanFormula = op.formula.startsWith('=') ? op.formula.slice(1) : op.formula;
          sheet.getCell(op.cell).value = { formula: cleanFormula, result: undefined } as any;
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

  const dir = path.join(resolveAgentsDataRoot(), userId, agentId, 'documents');
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
