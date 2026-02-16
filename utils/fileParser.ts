/**
 * File parsing utilities for chat attachments.
 *
 * Supports:
 * - Text files (txt, md, code, csv, json, yaml, etc.)
 * - PDF files (via pdf.js from CDN)
 * - Images (jpg, png, gif, webp, svg) → base64 data URL
 *
 * Text/PDF content is cleaned via `cleanDocumentText` to reduce token noise.
 * The full text is stored in `textContent` but NOT embedded in
 * `formatAttachmentAsMarkdown` — instead a compact marker is produced.
 * RAG retrieval of relevant chunks happens in App.tsx via DocumentRAGStore.
 */

import { cleanDocumentText } from './documentProcessor';

// ---- Constants ----
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_CHARS = 50_000;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB for images

const TEXT_EXTENSIONS = new Set([
  'txt','md','markdown','json','csv','yml','yaml','xml','html','htm','css',
  'js','jsx','ts','tsx','py','go','java','rs','sql','sh','bash','zsh',
  'rb','php','c','cpp','h','hpp','cs','swift','kt','kts','lua','r',
  'toml','ini','cfg','conf','env','dockerfile','makefile','gitignore',
  'log','diff','patch',
]);

const IMAGE_EXTENSIONS = new Set([
  'jpg','jpeg','png','gif','webp','svg','bmp','ico',
]);

const PDF_EXTENSION = 'pdf';
const PDF_MIME_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/acrobat',
  'applications/vnd.pdf',
  'text/pdf',
]);

// ---- Types ----

export type AttachmentType = 'text' | 'image' | 'pdf' | 'unknown';

export interface ParsedAttachment {
  type: AttachmentType;
  fileName: string;
  /** For text/pdf: extracted text content */
  textContent?: string;
  /** For images: data URL (base64) */
  dataUrl?: string;
  /** Original MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Whether content was truncated */
  truncated?: boolean;
  /** Error message if parsing failed */
  error?: string;
}

// ---- Helpers ----

function getExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function classifyFile(fileName: string, mimeType: string): AttachmentType {
  const ext = getExtension(fileName);
  const normalizedMime = mimeType.toLowerCase();

  if (ext === PDF_EXTENSION || PDF_MIME_TYPES.has(normalizedMime)) return 'pdf';
  if (IMAGE_EXTENSIONS.has(ext) || normalizedMime.startsWith('image/')) return 'image';
  if (
    TEXT_EXTENSIONS.has(ext) ||
    normalizedMime.startsWith('text/') ||
    normalizedMime.includes('markdown') ||
    normalizedMime.includes('json') ||
    normalizedMime.includes('xml') ||
    normalizedMime.includes('yaml') ||
    normalizedMime.includes('javascript') ||
    normalizedMime.includes('typescript')
  ) return 'text';

  return 'unknown';
}

// ---- PDF Parsing (lazy-load pdf.js from CDN) ----

let pdfjsLib: any = null;

async function loadPdfJs(): Promise<any> {
  if (pdfjsLib) return pdfjsLib;

  // Use the global pdfjsLib if available
  if ((window as any).pdfjsLib) {
    pdfjsLib = (window as any).pdfjsLib;
    return pdfjsLib;
  }

  return new Promise<any>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
    script.type = 'module';

    // For module scripts, we need a different approach
    // Use the global UMD build instead
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.js';
    script.type = 'text/javascript';
    
    script.onload = () => {
      pdfjsLib = (window as any).pdfjsLib;
      if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js';
        resolve(pdfjsLib);
      } else {
        reject(new Error('pdf.js failed to load'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
    document.head.appendChild(script);
  });
}

async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<{ text: string; truncated: boolean }> {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  let totalChars = 0;
  let truncated = false;

  for (let i = 1; i <= pdf.numPages; i++) {
    if (totalChars >= MAX_TEXT_CHARS) { truncated = true; break; }
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ')
      .trim();
    if (pageText) {
      pages.push(`[Page ${i}]\n${pageText}`);
      totalChars += pageText.length;
    }
  }

  let text = pages.join('\n\n');
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }

  return { text, truncated };
}

function decodePdfLiteralString(value: string): string {
  const withoutEscapes = value
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')');

  return withoutEscapes.replace(/\\([0-7]{1,3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8))
  );
}

function extractPdfTextFallback(arrayBuffer: ArrayBuffer): { text: string; truncated: boolean } {
  const raw = new TextDecoder('latin1').decode(new Uint8Array(arrayBuffer));
  const extractedSegments: string[] = [];

  const inlineLiteralMatches = raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*(?:Tj|')/g);
  for (const match of inlineLiteralMatches) {
    const decoded = decodePdfLiteralString(match[1]).trim();
    if (decoded) extractedSegments.push(decoded);
  }

  const tjArrayMatches = raw.matchAll(/\[(.*?)\]\s*TJ/gs);
  for (const match of tjArrayMatches) {
    const arrayBody = match[1] || '';
    const literals = arrayBody.matchAll(/\(((?:\\.|[^\\()])*)\)/g);
    for (const literal of literals) {
      const decoded = decodePdfLiteralString(literal[1]).trim();
      if (decoded) extractedSegments.push(decoded);
    }
  }

  let text = extractedSegments.join('\n');
  if (!text.trim()) {
    const printableLines = raw
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 24);
    text = printableLines.join('\n');
  }

  let truncated = false;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }

  return { text, truncated };
}

// ---- Image → Data URL ----

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

// ---- Main parser ----

export async function parseFile(file: File): Promise<ParsedAttachment> {
  const base: Omit<ParsedAttachment, 'type'> = {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
  };

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ...base,
      type: 'unknown',
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024} MB.`,
    };
  }

  const fileType = classifyFile(file.name, file.type);

  try {
    switch (fileType) {
      case 'text': {
        let raw = await file.text();
        let truncated = false;
        if (raw.length > MAX_TEXT_CHARS) {
          raw = raw.slice(0, MAX_TEXT_CHARS);
          truncated = true;
        }
        const cleaned = cleanDocumentText(raw);
        const textContent = cleaned || raw.trim();
        return { ...base, type: 'text', textContent, truncated };
      }

      case 'pdf': {
        const buffer = await file.arrayBuffer();
        let extraction = await extractPdfText(buffer).catch(() => extractPdfTextFallback(buffer));
        if (!extraction.text.trim()) {
          extraction = extractPdfTextFallback(buffer);
        }
        const { text, truncated } = extraction;
        const cleaned = cleanDocumentText(text);
        const textContent = cleaned || text.trim();
        if (!textContent) {
          return {
            ...base,
            type: 'pdf',
            error: 'Could not extract readable text from PDF.',
          };
        }
        return { ...base, type: 'pdf', textContent, truncated };
      }

      case 'image': {
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          return {
            ...base,
            type: 'image',
            error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB.`,
          };
        }
        const dataUrl = await fileToDataUrl(file);
        return { ...base, type: 'image', dataUrl };
      }

      default: {
        // Try to read as text anyway
        try {
          let raw = await file.text();
          let truncated = false;
          if (raw.length > MAX_TEXT_CHARS) {
            raw = raw.slice(0, MAX_TEXT_CHARS);
            truncated = true;
          }
          // Check if it looks like text
          const nonPrintable = raw.slice(0, 1000).split('').filter(c => {
            const code = c.charCodeAt(0);
            return code < 32 && code !== 9 && code !== 10 && code !== 13;
          }).length;
          if (nonPrintable > 10) {
            const sizeKb = Math.max(1, Math.round(file.size / 1024));
            return {
              ...base,
              type: 'unknown',
              textContent: `[Binary file: ${file.name}] (${sizeKb} KB, ${file.type || 'unknown type'})`,
            };
          }
          const cleaned = cleanDocumentText(raw);
          const textContent = cleaned || raw.trim();
          return { ...base, type: 'text', textContent, truncated };
        } catch {
          const sizeKb = Math.max(1, Math.round(file.size / 1024));
          return {
            ...base,
            type: 'unknown',
            textContent: `[Binary file: ${file.name}] (${sizeKb} KB, ${file.type || 'unknown type'})`,
          };
        }
      }
    }
  } catch (err) {
    return {
      ...base,
      type: fileType,
      error: err instanceof Error ? err.message : 'Failed to parse file',
    };
  }
}

/**
 * Format a parsed attachment as a compact marker for the message content.
 *
 * The full document text is NOT embedded. Instead a brief summary is shown.
 * Actual content retrieval is handled by the DocumentRAGStore (RAG) so that
 * only the relevant chunks are sent to the LLM, saving 80-90% of tokens.
 */
export function formatAttachmentAsMarkdown(
  attachment: ParsedAttachment,
  label: string = 'Attached file',
): string {
  if (attachment.error) {
    return `⚠️ ${attachment.fileName}: ${attachment.error}`;
  }

  if (attachment.type === 'image' && attachment.dataUrl) {
    return `🖼️ [${label}: ${attachment.fileName}]`;
  }

  if (attachment.textContent) {
    const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024));
    const charCount = attachment.textContent.length.toLocaleString();
    const truncNote = attachment.truncated ? ' [truncated]' : '';
    const icon = attachment.type === 'pdf' ? '📄' : '📎';

    return `${icon} [${label}: ${attachment.fileName}] (${sizeKb} KB, ${charCount} chars${truncNote})`;
  }

  const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024));
  return `[${label}: ${attachment.fileName}] (${sizeKb} KB, ${attachment.mimeType})`;
}

export { MAX_ATTACHMENT_SIZE_BYTES, MAX_IMAGE_SIZE_BYTES, MAX_TEXT_CHARS };
