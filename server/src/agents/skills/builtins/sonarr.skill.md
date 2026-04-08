---
id: sonarr
name: "Sonarr — Gestión de Series"
description: "Buscar, añadir, monitorizar y gestionar series de TV con Sonarr (descargas automatizadas)"
name_en: "Sonarr — TV Series Management"
description_en: "Search, add, monitor and manage TV series with Sonarr (automated downloads)"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 75
tags: ["media", "series", "sonarr", "descargas", "plex", "tv"]
tags_en: ["media", "series", "sonarr", "downloads", "plex", "tv"]
category: "integration"
triggers:
  events:
    - "keyword:serie"
    - "keyword:series"
    - "keyword:sonarr"
    - "keyword:temporada"
    - "keyword:episodio"
    - "keyword:capitulo"
    - "keyword:capítulo"
    - "keyword:descargar serie"
  conditions: "Cuando el usuario quiera gestionar series de TV"
requires_tools:
  - sonarr_search_series
  - sonarr_add_series
  - sonarr_library
  - sonarr_series_status
  - sonarr_season_episodes
  - sonarr_search_download
  - sonarr_queue
  - sonarr_get_releases
  - sonarr_delete_series
---

# Sonarr — Protocolo de Gestión de Series de TV

## Herramientas disponibles
- `sonarr_search_series` — Buscar series online (TVDB/IMDb IDs)
- `sonarr_add_series` — Añadir serie para monitorización/descarga
- `sonarr_library` — Listar series en la biblioteca local
- `sonarr_series_status` — Estado detallado de una serie
- `sonarr_season_episodes` — Ver episodios de una temporada con estado individual
- `sonarr_search_download` — Buscar y descargar episodios específicos
- `sonarr_queue` — Cola de descargas activas
- `sonarr_get_releases` — Buscar releases con filtros de calidad
- `sonarr_delete_series` — Eliminar serie de la biblioteca

## Flujo de trabajo obligatorio

### "Descarga [serie]" o "Añade [serie]"
1. **Busca primero en la biblioteca** con `sonarr_library`.
2. Si ya está, informa del estado (temporadas/episodios descargados vs pendientes).
3. Si NO está, busca online con `sonarr_search_series`.
4. Muestra opciones: título, año inicio, TVDB ID, número de temporadas.
5. **Pregunta al usuario**:
   - ¿Serie completa?
   - ¿Temporada específica?
   - ¿Episodios concretos?
6. Pide confirmación antes de añadir.
7. Usa `sonarr_add_series` con TVDB ID y selección de temporadas.
8. Confirma con recibo.

### "¿Qué series tengo?"
1. `sonarr_library` para listar.
2. Muestra: título, temporadas disponibles/totales, episodios descargados.

### "¿Qué episodios tiene [serie]?"
1. Busca la serie en la biblioteca.
2. Usa `sonarr_season_episodes` para la temporada solicitada.
3. Muestra cada episodio con: número, título, estado (descargado/pendiente/no emitido).

### "¿Cómo van las descargas?"
1. `sonarr_queue` para descargas activas.
2. Muestra: serie, episodio, progreso, ETA.

### Control de calidad
- Similar a Radarr: usa `sonarr_get_releases` con filtros de tamaño si el usuario lo requiere.

### Eliminar serie
1. Confirma cuál serie.
2. Muestra detalles y tamaño.
3. Pregunta si eliminar archivos también.
4. Confirmación explícita.
5. `sonarr_delete_series`.

## Reglas estrictas
- SIEMPRE busca en biblioteca antes de añadir.
- SIEMPRE identifica por TVDB/IMDb ID.
- NUNCA añadas sin confirmación del usuario.
- Pregunta siempre el alcance: serie completa, temporada o episodios.
- Muestra el año de inicio para desambiguar series con mismo nombre.
- Para series en emisión, informa de episodios futuros no disponibles.

<!-- lang:en -->

# Sonarr — TV Series Management Protocol

## Available tools
- `sonarr_search_series` — Search series online (TVDB/IMDb IDs)
- `sonarr_add_series` — Add series for monitoring/download
- `sonarr_library` — List series in the local library
- `sonarr_series_status` — Detailed series status
- `sonarr_season_episodes` — View episodes of a season with individual status
- `sonarr_search_download` — Search and download specific episodes
- `sonarr_queue` — Active download queue
- `sonarr_get_releases` — Search releases with quality filters
- `sonarr_delete_series` — Remove series from library

## Mandatory workflow

### "Download [series]" or "Add [series]"
1. **Search the library first** with `sonarr_library`.
2. If already there, report status (seasons/episodes downloaded vs pending).
3. If NOT there, search online with `sonarr_search_series`.
4. Show options: title, start year, TVDB ID, number of seasons.
5. **Ask the user**:
   - Complete series?
   - Specific season?
   - Specific episodes?
6. Ask for confirmation before adding.
7. Use `sonarr_add_series` with TVDB ID and season selection.
8. Confirm with receipt.

### "What series do I have?"
1. `sonarr_library` to list.
2. Show: title, available/total seasons, downloaded episodes.

### "What episodes does [series] have?"
1. Search the series in the library.
2. Use `sonarr_season_episodes` for the requested season.
3. Show each episode with: number, title, status (downloaded/pending/unaired).

### "How are the downloads going?"
1. `sonarr_queue` for active downloads.
2. Show: series, episode, progress, ETA.

### Quality control
- Similar to Radarr: use `sonarr_get_releases` with size filters if the user requires it.

### Delete series
1. Confirm which series.
2. Show details and size.
3. Ask if files should also be deleted.
4. Explicit confirmation.
5. `sonarr_delete_series`.

## Strict rules
- ALWAYS search library before adding.
- ALWAYS identify by TVDB/IMDb ID.
- NEVER add without user confirmation.
- Always ask the scope: complete series, season or episodes.
- Show start year to disambiguate series with the same name.
- For airing series, report unavailable future episodes.
