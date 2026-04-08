---
id: sonarr
name: "Sonarr — Gestión de Series"
description: "Buscar, añadir, monitorizar y gestionar series de TV con Sonarr (descargas automatizadas)"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 75
tags: ["media", "series", "sonarr", "descargas", "plex", "tv"]
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
