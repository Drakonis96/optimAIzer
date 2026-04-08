---
id: document-summarizer
name: "Resumen de Documentos"
description: "Resumen inteligente de documentos, artículos, PDFs y textos largos con extracción de puntos clave"
name_en: "Document Summarizer"
description_en: "Smart summarization of documents, articles, PDFs and long texts with key point extraction"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 55
tags: ["documentos", "resumen", "pdf", "artículos", "lectura", "síntesis"]
tags_en: ["documents", "summary", "pdf", "articles", "reading", "synthesis"]
category: "knowledge"
triggers:
  events:
    - "keyword:resume"
    - "keyword:resumen"
    - "keyword:resumir"
    - "keyword:sintetiza"
    - "keyword:puntos clave"
    - "keyword:documento"
    - "keyword:artículo"
    - "keyword:articulo"
    - "keyword:pdf"
  conditions: "Cuando el usuario envíe documentos o pida resúmenes"
requires_tools:
  - fetch_webpage
  - browse_website
  - create_note
  - web_search
  - analyze_telegram_image
---

# Resumen de Documentos — Protocolo

## Tipos de entrada soportados

### Documentos de Telegram
- **PDFs**: Texto extraído automáticamente antes de procesar.
- **Imágenes de documentos**: OCR con visión IA.
- **Archivos de texto**: Leídos directamente.

### URLs de artículos
- `fetch_webpage` para artículos estáticos.
- `browse_website` para sitios dinámicos (JS-heavy).

### Texto pegado en el chat
- Procesar directamente el texto proporcionado.

## Niveles de resumen

### 🟢 Express (TL;DR)
- 2-3 líneas con la idea principal.
- Para: noticias cortas, emails, posts.
```
📝 TL;DR: [Resumen en máximo 3 líneas]
```

### 🟡 Estándar
- 1-2 párrafos con puntos clave.
- Para: artículos, informes cortos.
```
📋 **Resumen: [Título]**

**Idea principal:** [1-2 líneas]

**Puntos clave:**
• [Punto 1]
• [Punto 2]
• [Punto 3]

**Conclusión:** [1-2 líneas]
```

### 🔴 Detallado
- Resumen por secciones con análisis.
- Para: papers, reportes largos, documentos legales.
```
📄 **Análisis: [Título]**

### Contexto
[Quién, qué, cuándo, por qué]

### Secciones principales
**1. [Sección]** — [Resumen de esta sección]
**2. [Sección]** — [Resumen]
...

### Datos clave
- [Dato/cifra 1]
- [Dato/cifra 2]

### Implicaciones
[Qué significa esto, a quién afecta]

### Acción recomendada
[Si aplica, qué debería hacer el usuario]
```

## Flujo de trabajo

### Documento recibido
1. Detectar tipo y longitud.
2. Elegir nivel de resumen apropiado (o preguntar).
3. Procesar y generar resumen.
4. Preguntar si quiere guardarlo como nota.

### URL proporcionada
1. Intentar `fetch_webpage` primero.
2. Si el contenido es insuficiente, usar `browse_website`.
3. Generar resumen con fuente citada.

### Texto largo en chat
1. Identificar estructura del texto.
2. Generar resumen del nivel apropiado.

## Reglas
- Mantener fidelidad al contenido original — no inventar información.
- Si el documento tiene datos numéricos importantes, incluirlos en el resumen.
- Para documentos legales/técnicos, señalar términos clave y sus implicaciones.
- Si el documento está en otro idioma, resumir en el idioma del usuario.
- Ofrecer guardar como nota los resúmenes largos.
- Indicar si alguna parte del documento no se pudo procesar (imágenes, tablas complejas).

<!-- lang:en -->

# Document Summarizer — Protocol

## Supported input types

### Telegram documents
- **PDFs**: Text extracted automatically before processing.
- **Document images**: OCR with AI vision.
- **Text files**: Read directly.

### Article URLs
- `fetch_webpage` for static articles.
- `browse_website` for dynamic sites (JS-heavy).

### Text pasted in chat
- Process the provided text directly.

## Summary levels

### 🟢 Express (TL;DR)
- 2-3 lines with the main idea.
- For: short news, emails, posts.

### 🟡 Standard
- 1-2 paragraphs with key points.
- For: articles, short reports.

### 🔴 Detailed
- Summary by sections with analysis.
- For: papers, long reports, legal documents.

## Workflow

### Document received
1. Detect type and length.
2. Choose appropriate summary level (or ask).
3. Process and generate summary.
4. Ask if they want to save it as a note.

### URL provided
1. Try `fetch_webpage` first.
2. If content is insufficient, use `browse_website`.
3. Generate summary with cited source.

## Rules
- Maintain fidelity to original content — do not invent information.
- If the document has important numerical data, include it in the summary.
- For legal/technical documents, highlight key terms and their implications.
- If the document is in another language, summarize in the user's language.
- Offer to save long summaries as notes.
- Indicate if any part of the document could not be processed (images, complex tables).
