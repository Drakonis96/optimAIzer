---
id: pdf-documents
name: "Documentos PDF"
description: "Lectura, creación y anotación de documentos PDF: texto, encabezados, comentarios, imágenes y metadatos"
name_en: "PDF Documents"
description_en: "Read, create and annotate PDF documents: text, headings, comments, images and metadata"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["pdf", "documento", "anotación", "comentario", "informe"]
tags_en: ["pdf", "document", "annotation", "comment", "report"]
category: "productivity"
triggers:
  events:
    - "keyword:pdf"
    - "keyword:documento pdf"
    - "keyword:anotar pdf"
    - "keyword:comentar pdf"
    - "keyword:annotate pdf"
    - "keyword:pdf document"
  conditions: "Cuando el usuario necesite leer, crear o anotar documentos PDF"
requires_tools:
  - read_pdf
  - create_pdf
  - annotate_pdf
  - web_search
---

# Documentos PDF — Protocolo

## Capacidades
Este skill permite trabajar con documentos PDF:
- **Lectura**: Extraer texto, número de páginas y metadatos (título, autor, asunto)
- **Creación**: Generar PDFs con texto, encabezados, comentarios, imágenes y saltos de página
- **Anotación**: Añadir comentarios y marcas a PDFs existentes con colores personalizados
- **Análisis**: Resumir, analizar y procesar contenido de PDFs

## Flujo de trabajo

### Leer un PDF
1. El usuario envía un archivo PDF
2. Usar `read_pdf` con la ruta del archivo
3. Se extrae: texto completo, número de páginas, metadatos
4. Presentar un resumen o el contenido según lo solicitado

### Crear un PDF
1. **PLAN DE ACTUACIÓN**: Antes de crear el PDF, generar un plan paso a paso visible para el usuario que incluya:
   - Objetivo del documento PDF
   - Estructura propuesta (secciones, encabezados)
   - Contenido clave de cada sección
   - Elementos especiales (imágenes, comentarios, saltos de página)
2. Determinar el contenido necesario
3. Estructurar en bloques:
   - `heading`: Encabezados (fontSize configurable, negrita automática)
   - `text`: Párrafos con tamaño configurable, word-wrap automático
   - `comment`: Comentarios/anotaciones con emoji 📝 en color naranja
   - `image`: Imágenes (base64 PNG/JPG) con dimensiones configurables
   - `page_break`: Salto de página
4. Llamar a `create_pdf` con el array JSON de bloques
5. Informar la ruta del archivo generado

### Anotar un PDF existente
1. Recibir el PDF del usuario
2. Analizar el contenido con `read_pdf`
3. Determinar las anotaciones necesarias
4. Usar `annotate_pdf` especificando:
   - `page`: Número de página (1-based)
   - `x`, `y`: Coordenadas (origen inferior-izquierdo)
   - `text`: Texto de la anotación
   - `color`: red, blue, green, orange, black
   - `fontSize`: Tamaño del texto (por defecto 10)
5. Devolver el nuevo PDF con las anotaciones

### Ejemplo de contenido JSON (crear)
```json
[
  {"type": "heading", "text": "Informe de Revisión", "fontSize": 24},
  {"type": "text", "text": "Este documento contiene la revisión del proyecto X."},
  {"type": "comment", "text": "NOTA: Revisar cifras del Q3"},
  {"type": "page_break"},
  {"type": "heading", "text": "Sección 2: Datos", "fontSize": 18},
  {"type": "text", "text": "Los datos muestran una tendencia positiva...", "bold": true}
]
```

### Ejemplo de anotaciones JSON
```json
[
  {"page": 1, "x": 50, "y": 700, "text": "✓ Aprobado", "color": "green", "fontSize": 12},
  {"page": 1, "x": 50, "y": 300, "text": "⚠ Revisar estos datos", "color": "red"},
  {"page": 2, "x": 100, "y": 500, "text": "Añadir referencia bibliográfica", "color": "blue"}
]
```

## Coordenadas PDF
- El origen (0,0) está en la **esquina inferior-izquierda**
- Ancho de página estándar: 595 puntos (A4)
- Alto de página estándar: 842 puntos (A4)
- Margen típico: 50 puntos desde cada borde

## Reglas
- Al leer PDFs grandes, ofrecer un resumen antes del texto completo.
- Al anotar, usar colores consistentes: rojo para correcciones, verde para aprobaciones, azul para sugerencias.
- Si el usuario pide "comentar" un PDF, usar `annotate_pdf` sobre el original.
- Para crear PDFs desde cero, usar `create_pdf`.
- Siempre informar la ruta del archivo generado para descarga.

<!-- lang:en -->

# PDF Documents — Protocol

## Capabilities
This skill allows working with PDF documents:
- **Reading**: Extract text, page count, and metadata (title, author, subject)
- **Creation**: Generate PDFs with text, headings, comments, images and page breaks
- **Annotation**: Add comments and marks to existing PDFs with custom colors
- **Analysis**: Summarize, analyze and process PDF content

## Workflow

### Read a PDF
1. User sends a PDF file
2. Use `read_pdf` with the file path
3. Extract: full text, page count, metadata
4. Present summary or content as requested

### Create a PDF
1. **ACTION PLAN**: Before creating the PDF, generate a visible step-by-step plan for the user including:
   - Document objective
   - Proposed structure (sections, headings)
   - Key content for each section
   - Special elements (images, comments, page breaks)
2. Determine needed content
3. Structure into blocks (heading, text, comment, image, page_break)
4. Call `create_pdf` with the JSON blocks array
5. Report the generated file path

### Annotate an existing PDF
1. Receive the PDF from the user
2. Analyze content with `read_pdf`
3. Determine needed annotations
4. Use `annotate_pdf` with page, coordinates, text, and color
5. Return the new annotated PDF

## PDF Coordinates
- Origin (0,0) is at the **bottom-left corner**
- Standard A4 width: 595 points, height: 842 points
- Typical margin: 50 points from each edge

## Rules
- When reading large PDFs, offer a summary before the full text.
- Use consistent colors: red for corrections, green for approvals, blue for suggestions.
- To "comment" a PDF, use `annotate_pdf` on the original.
- To create PDFs from scratch, use `create_pdf`.
- Always report the generated file path for download.
