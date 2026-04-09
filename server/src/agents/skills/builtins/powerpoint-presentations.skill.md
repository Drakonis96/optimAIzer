---
id: powerpoint-presentations
name: "Presentaciones PowerPoint"
description: "Creación de presentaciones PowerPoint (.pptx): diapositivas, notas del presentador, imágenes de internet, layouts, viñetas y estilos"
name_en: "PowerPoint Presentations"
description_en: "Create PowerPoint presentations (.pptx): slides, presenter notes, internet images, layouts, bullets and styles"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["powerpoint", "pptx", "presentación", "diapositivas", "slides"]
tags_en: ["powerpoint", "pptx", "presentation", "slides", "deck"]
category: "productivity"
triggers:
  events:
    - "keyword:powerpoint"
    - "keyword:pptx"
    - "keyword:presentación"
    - "keyword:presentacion"
    - "keyword:diapositivas"
    - "keyword:slides"
    - "keyword:presentation"
  conditions: "Cuando el usuario necesite crear presentaciones PowerPoint"
requires_tools:
  - create_powerpoint
  - web_search
  - fetch_webpage
---

# Presentaciones PowerPoint — Protocolo

## Capacidades
Este skill permite crear presentaciones PowerPoint (.pptx) profesionales:
- **Layouts**: Diapositiva de título, contenido, sección, dos columnas, en blanco
- **Notas del presentador**: Cada diapositiva puede incluir notas detalladas para el orador
- **Imágenes**: Buscar imágenes en internet e insertarlas en las diapositivas
- **Viñetas**: Listas con puntos organizados
- **Estilos**: Colores de fondo, colores de fuente, tamaños personalizados
- **Metadatos**: Título, autor y asunto de la presentación

## Flujo de trabajo

### Crear una presentación
1. Entender el tema y estructura deseada
2. Planificar la estructura de diapositivas:
   - Diapositiva 1: Título y subtítulo
   - Diapositivas intermedias: Contenido con texto, viñetas, imágenes
   - Diapositiva final: Resumen/conclusiones
3. Para cada diapositiva, definir:
   - `title`: Título de la diapositiva
   - `subtitle`: Subtítulo (para diapositivas de título)
   - `content`: Texto principal
   - `notes`: **Notas del presentador** (lo que debe decir el orador)
   - `layout`: "title", "content", "section", "two_column", "blank"
   - `bulletPoints`: Array de puntos/viñetas
   - `images`: Array de imágenes con posición y tamaño
   - `leftColumn`/`rightColumn`: Texto para layout de dos columnas
   - `backgroundColor`: Color de fondo (hex, ej: "FFFFFF")
   - `fontColor`: Color de texto (hex, ej: "363636")
4. Llamar a `create_powerpoint` con el array de slides en JSON
5. Informar la ruta del archivo generado

### Buscar e insertar imágenes
1. Usar `web_search` para encontrar imágenes relevantes
2. Usar `fetch_webpage` para obtener la URL directa de la imagen
3. Para insertar la imagen:
   - Descargar la imagen y convertirla a base64
   - O usar `execute_code` para descargar y codificar la imagen
   - Incluirla en el campo `images` de la diapositiva
4. Configurar posición (`x`, `y`), tamaño (`w`, `h`) y `caption`

### Ejemplo de slides JSON
```json
[
  {
    "title": "Plan Estratégico 2025",
    "subtitle": "Departamento de Marketing",
    "layout": "title",
    "notes": "Bienvenida. Explicar el contexto del plan estratégico y agradecer la asistencia."
  },
  {
    "title": "Objetivos del Trimestre",
    "bulletPoints": [
      "Incrementar ventas online un 20%",
      "Lanzar 3 nuevas campañas digitales",
      "Reducir coste por adquisición un 15%"
    ],
    "layout": "content",
    "notes": "Detallar cada objetivo. El objetivo de ventas se basa en el crecimiento del Q4. Las campañas están ya en fase de diseño."
  },
  {
    "title": "Análisis Comparativo",
    "leftColumn": "Q1 2024:\n- Ventas: €500K\n- CAC: €45\n- ROI: 2.3x",
    "rightColumn": "Q1 2025 (objetivo):\n- Ventas: €600K\n- CAC: €38\n- ROI: 3.0x",
    "layout": "two_column",
    "notes": "Comparar ambas columnas punto por punto. Resaltar la mejora esperada en ROI."
  },
  {
    "title": "Próximos Pasos",
    "content": "1. Revisión semanal de KPIs\n2. Reunión de seguimiento cada 15 días\n3. Informe final en marzo",
    "backgroundColor": "1F3864",
    "fontColor": "FFFFFF",
    "notes": "Cerrar con las fechas clave. Preguntar si hay dudas."
  }
]
```

## Layouts disponibles
| Layout | Descripción |
|--------|-------------|
| `title` | Título centrado grande + subtítulo. Para portada y divisores. |
| `content` | Título + área de contenido/viñetas. El más común. |
| `section` | Título centrado. Para separar secciones. |
| `two_column` | Título + dos columnas (izquierda y derecha). |
| `blank` | Diapositiva vacía. Solo se añaden imágenes u objetos manuales. |

## Notas del presentador
- **SIEMPRE** incluir notas del presentador en cada diapositiva.
- Las notas deben contener: qué decir, datos clave a mencionar, transiciones.
- Son invisibles durante la presentación pero visibles en el modo presentador.
- Usar un tono conversacional y directo en las notas.

## Reglas
- Mínimo de texto por diapositiva: preferir viñetas cortas sobre párrafos largos.
- Máximo 6-7 viñetas por diapositiva.
- Usar colores consistentes en toda la presentación.
- Para presentaciones profesionales: fondo blanco o azul oscuro.
- Incluir siempre una diapositiva de título y una de cierre.
- Si el usuario pide imágenes, buscarlas con web_search e intentar incluirlas.
- Ofrecer siempre el archivo generado para descarga.

<!-- lang:en -->

# PowerPoint Presentations — Protocol

## Capabilities
This skill creates professional PowerPoint (.pptx) presentations:
- **Layouts**: Title, content, section, two-column, blank slides
- **Presenter notes**: Each slide can include detailed speaker notes
- **Images**: Search images online and insert them into slides
- **Bullets**: Organized bullet point lists
- **Styles**: Background colors, font colors, custom sizes
- **Metadata**: Presentation title, author, and subject

## Workflow

### Create a presentation
1. Understand the topic and desired structure
2. Plan slide structure (title, content slides, closing)
3. For each slide, define: title, content, notes, layout, bulletPoints, images
4. Call `create_powerpoint` with the slides JSON array
5. Report the generated file path

### Search and insert images
1. Use `web_search` to find relevant images
2. Use `fetch_webpage` to get the direct image URL
3. Download, convert to base64, and include in the slide's `images` array
4. Configure position (x, y), size (w, h), and caption

## Presenter Notes
- **ALWAYS** include presenter notes on each slide.
- Notes should contain: what to say, key data points, transitions.
- They are invisible during presentation but visible in presenter mode.

## Rules
- Minimal text per slide: prefer short bullets over long paragraphs.
- Maximum 6-7 bullets per slide.
- Use consistent colors throughout.
- Always include a title slide and a closing slide.
- If user asks for images, search with web_search and try to include them.
- Always offer the generated file for download.
