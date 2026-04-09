---
id: word-documents
name: "Documentos Word"
description: "Lectura, creación y edición de documentos Word (.docx): encabezados, párrafos, estilos, tablas, listas, negritas y cursivas"
name_en: "Word Documents"
description_en: "Read, create and edit Word documents (.docx): headings, paragraphs, styles, tables, lists, bold and italics"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["word", "docx", "documento", "texto", "informe", "plantilla"]
tags_en: ["word", "docx", "document", "text", "report", "template"]
category: "productivity"
triggers:
  events:
    - "keyword:word"
    - "keyword:docx"
    - "keyword:documento word"
    - "keyword:informe"
    - "keyword:carta"
    - "keyword:plantilla"
    - "keyword:word document"
    - "keyword:report"
  conditions: "Cuando el usuario necesite leer, crear o editar documentos Word"
requires_tools:
  - read_word
  - create_word
  - web_search
---

# Documentos Word — Protocolo

## Capacidades
Este skill permite trabajar con documentos Word (.docx):
- **Lectura**: Extraer texto, estilos y metadatos de archivos .docx existentes
- **Creación**: Generar documentos con estructura profesional
- **Estilos**: Encabezados (H1-H6), negritas, cursivas, estilos de párrafo
- **Listas**: Viñetas con niveles de indentación
- **Tablas**: Tablas con filas y columnas
- **Análisis**: Resumir, analizar y transformar contenido de documentos

## Flujo de trabajo

### Leer un documento Word
1. El usuario envía un archivo .docx (vía Telegram o chat)
2. Usar `read_word` con la ruta del archivo descargado
3. Analizar el texto, estilos y metadatos extraídos
4. Presentar un resumen o el contenido según lo que pida el usuario

### Crear un documento Word
1. Entender el contenido que el usuario necesita
2. Estructurar el contenido en bloques:
   - `heading`: Encabezados con nivel 1-6
   - `paragraph`: Párrafos con opciones de negrita/cursiva/estilo
   - `bullet`: Listas con viñetas (nivel de indentación)
   - `table`: Tablas con filas y columnas
3. Llamar a `create_word` con el array de bloques en JSON
4. Informar la ruta del archivo generado para que el usuario lo descargue

### Ejemplo de contenido JSON
```json
[
  {"type": "heading", "text": "Informe Mensual", "level": 1},
  {"type": "paragraph", "text": "Este informe resume las actividades del mes de enero.", "bold": false},
  {"type": "heading", "text": "Resultados", "level": 2},
  {"type": "bullet", "text": "Ventas incrementaron un 15%", "level": 1},
  {"type": "bullet", "text": "Nuevos clientes: 45", "level": 1},
  {"type": "table", "rows": [["Métrica", "Valor"], ["Ventas", "€150,000"], ["Costes", "€80,000"]]}
]
```

## Reglas
- Siempre estructurar el documento con encabezados jerárquicos.
- Usar negritas para énfasis en datos importantes.
- Para informes largos, incluir un índice o resumen ejecutivo.
- Si el usuario envía un .docx para editar, leerlo primero y luego crear una versión modificada.
- Ofrecer siempre el archivo generado para descarga.

<!-- lang:en -->

# Word Documents — Protocol

## Capabilities
This skill allows working with Word documents (.docx):
- **Reading**: Extract text, styles and metadata from existing .docx files
- **Creation**: Generate professionally structured documents
- **Styles**: Headings (H1-H6), bold, italics, paragraph styles
- **Lists**: Bullet points with indentation levels
- **Tables**: Tables with rows and columns
- **Analysis**: Summarize, analyze and transform document content

## Workflow

### Read a Word document
1. User sends a .docx file (via Telegram or chat)
2. Use `read_word` with the downloaded file path
3. Analyze extracted text, styles and metadata
4. Present a summary or content as requested

### Create a Word document
1. Understand the content the user needs
2. Structure content into blocks (heading, paragraph, bullet, table)
3. Call `create_word` with the JSON blocks array
4. Report the generated file path for download

## Rules
- Always structure documents with hierarchical headings.
- Use bold for emphasis on important data.
- For long reports, include a table of contents or executive summary.
- If user sends a .docx for editing, read it first then create a modified version.
- Always offer the generated file for download.
