---
id: web-research
name: "Investigación Web Avanzada"
description: "Investigación profunda en la web: búsqueda multi-fuente, extracción de datos, verificación de hechos y síntesis"
name_en: "Advanced Web Research"
description_en: "Deep web research: multi-source search, data extraction, fact checking and synthesis"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["investigación", "web", "búsqueda", "research", "datos"]
tags_en: ["research", "web", "search", "investigation", "data"]
category: "developer"
triggers:
  events:
    - "keyword:investiga"
    - "keyword:busca"
    - "keyword:research"
    - "keyword:averigua"
    - "keyword:infórmate"
    - "keyword:informate"
  conditions: "Cuando se necesite investigación web exhaustiva"
requires_tools:
  - web_search
  - fetch_webpage
  - browse_website
---

# Investigación Web Avanzada — Protocolo

## Herramientas disponibles
- `web_search` — Búsqueda DuckDuckGo (rápida, sin tracking)
- `fetch_webpage` — Lectura directa de página web (HTTP GET, sin JS)
- `browse_website` — Navegación con headless Chrome (JS, interacciones, screenshots, login)

## Metodología de investigación

### Nivel 1: Búsqueda rápida
Para preguntas factuales simples:
1. Una sola búsqueda con `web_search`.
2. Extraer dato clave de los resultados.
3. Responder de forma directa.

### Nivel 2: Investigación estándar
Para temas que requieren contexto:
1. **2-3 búsquedas** con queries variadas (sinónimos, distintos ángulos).
2. `fetch_webpage` en las 2-3 fuentes más relevantes.
3. Sintetizar información cruzada.
4. Citar fuentes con URLs.

### Nivel 3: Investigación profunda
Para análisis complejos o tomas de decisión:
1. **4-6 búsquedas** cubriendo múltiples perspectivas.
2. `fetch_webpage` en fuentes primarias (documentos oficiales, papers, reportes).
3. `browse_website` si necesitas interactuar (llenar formularios, navegar paginación).
4. Verificación cruzada de datos entre fuentes.
5. Informe estructurado con secciones claras.
6. Lista de todas las fuentes consultadas.

## Técnicas de búsqueda efectiva
- **Operadores**: `"frase exacta"`, `site:dominio.com`, `-excluir`
- **Búsqueda temporal**: Añadir año o "2024" para resultados recientes.
- **Multiidioma**: Buscar en español E inglés para mayor cobertura.
- **Fuentes especializadas**: Buscar directamente en `site:reddit.com`, `site:stackoverflow.com`, etc.

## Extracción de datos de páginas
1. Usar `fetch_webpage` para contenido estático (artículos, Wikipedia, docs).
2. Usar `browse_website` cuando:
   - La página requiere JavaScript para cargar contenido.
   - Necesitas hacer click, scroll, o llenar formularios.
   - Quieres un screenshot visual.
   - Necesitas autenticarte (con credenciales configuradas).

## Formato de respuesta para investigaciones
```
📋 **[Tema investigado]**

### Hallazgos principales
- [Dato 1] (fuente: [URL])
- [Dato 2] (fuente: [URL])

### Análisis
[Síntesis y conclusiones]

### Fuentes consultadas
1. [Título] — [URL]
2. [Título] — [URL]
```

## Reglas
- SIEMPRE cita fuentes con URLs cuando sea posible.
- Distingue entre hechos verificados y opiniones/estimaciones.
- Si los datos son contradictorios entre fuentes, señálalo explícitamente.
- Para datos numéricos (precios, estadísticas), indica la fecha de la fuente.
- Respeta el contexto de sitios con paywall — no intentes bypasses.
- Si una web no carga, prueba con `browse_website` antes de desistir.

<!-- lang:en -->

# Advanced Web Research — Protocol

## Available tools
- `web_search` — DuckDuckGo search (fast, no tracking)
- `fetch_webpage` — Direct web page reading (HTTP GET, no JS)
- `browse_website` — Navigation with headless Chrome (JS, interactions, screenshots, login)

## Research methodology

### Level 1: Quick search
For simple factual questions:
1. A single search with `web_search`.
2. Extract key data from results.
3. Respond directly.

### Level 2: Standard research
For topics requiring context:
1. **2-3 searches** with varied queries (synonyms, different angles).
2. `fetch_webpage` on the 2-3 most relevant sources.
3. Synthesize cross-referenced information.
4. Cite sources with URLs.

### Level 3: Deep research
For complex analysis or decision-making:
1. **4-6 searches** covering multiple perspectives.
2. `fetch_webpage` on primary sources (official documents, papers, reports).
3. `browse_website` if you need to interact (fill forms, navigate pagination).
4. Cross-verify data between sources.
5. Structured report with clear sections.
6. List of all sources consulted.

## Effective search techniques
- **Operators**: `"exact phrase"`, `site:domain.com`, `-exclude`
- **Time-based search**: Add year or "2024" for recent results.
- **Multilingual**: Search in both Spanish and English for broader coverage.
- **Specialized sources**: Search directly on `site:reddit.com`, `site:stackoverflow.com`, etc.

## Page data extraction
1. Use `fetch_webpage` for static content (articles, Wikipedia, docs).
2. Use `browse_website` when:
   - The page requires JavaScript to load content.
   - You need to click, scroll, or fill forms.
   - You want a visual screenshot.
   - You need to authenticate (with configured credentials).

## Response format for research
```
📋 **[Topic researched]**

### Key findings
- [Finding 1] (source: [URL])
- [Finding 2] (source: [URL])

### Analysis
[Synthesis and conclusions]

### Sources consulted
1. [Title] — [URL]
2. [Title] — [URL]
```

## Rules
- ALWAYS cite sources with URLs when possible.
- Distinguish between verified facts and opinions/estimates.
- If data is contradictory between sources, flag it explicitly.
- For numerical data (prices, statistics), indicate the source date.
- Respect sites with paywalls — do not attempt bypasses.
- If a website doesn't load, try `browse_website` before giving up.
