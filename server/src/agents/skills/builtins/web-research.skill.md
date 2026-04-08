---
id: web-research
name: "Investigación Web Avanzada"
description: "Investigación profunda en la web: búsqueda multi-fuente, extracción de datos, verificación de hechos y síntesis"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["investigación", "web", "búsqueda", "research", "datos"]
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
