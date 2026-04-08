---
id: radarr
name: "Radarr — Gestión de Películas"
description: "Buscar, añadir, monitorizar y gestionar películas con Radarr (descargas automatizadas)"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 75
tags: ["media", "películas", "radarr", "descargas", "plex", "cine"]
category: "integration"
triggers:
  events:
    - "keyword:película"
    - "keyword:pelicula"
    - "keyword:movie"
    - "keyword:radarr"
    - "keyword:descargar película"
    - "keyword:cine"
    - "keyword:film"
  conditions: "Cuando el usuario quiera gestionar películas"
requires_tools:
  - radarr_search_movie
  - radarr_add_movie
  - radarr_library
  - radarr_movie_status
  - radarr_queue
  - radarr_get_releases
  - radarr_delete_movie
---

# Radarr — Protocolo de Gestión de Películas

## Herramientas disponibles
- `radarr_search_movie` — Buscar películas online por título (devuelve TMDB/IMDb IDs)
- `radarr_add_movie` — Añadir película a Radarr para monitorización/descarga
- `radarr_library` — Listar películas en la biblioteca local
- `radarr_movie_status` — Estado detallado de una película (descargada, monitoreada, calidad)
- `radarr_queue` — Ver cola de descargas activas
- `radarr_get_releases` — Buscar releases disponibles con filtros de calidad/tamaño
- `radarr_delete_movie` — Eliminar película de la biblioteca

## Flujo de trabajo obligatorio

### "Descarga [título]" o "Añade [título]"
1. **Busca primero en la biblioteca** con `radarr_library` (búsqueda por título).
2. Si ya está en la biblioteca, informa del estado actual.
3. Si NO está, busca online con `radarr_search_movie`.
4. Si hay múltiples resultados, muestra lista con: título, año, TMDB ID, sinopsis breve.
5. Pide al usuario que seleccione la correcta.
6. **Pide confirmación** antes de añadir.
7. Usa `radarr_add_movie` con el TMDB ID correcto.
8. Confirma con recibo: título, año, perfil de calidad.

### "¿Qué películas tengo?"
1. Usa `radarr_library` para listar.
2. Muestra de forma compacta: título, año, estado (descargada/pendiente).
3. Si la lista es larga, muestra las más recientes o permite filtrar.

### "¿Cómo va la descarga?"
1. Usa `radarr_queue` para ver descargas activas.
2. Muestra: título, progreso, tiempo estimado, estado.
3. Si no hay descargas activas, indícalo.

### Control de calidad y tamaño
- Si el usuario pide límite de tamaño (ej: "menos de 10 GB"):
  1. Usa `radarr_get_releases` con `min_size_gb` / `max_size_gb`.
  2. Filtra resultados y muestra opciones.
  3. Si no hay opciones en el rango, amplia ligeramente y avisa.

### Eliminar película
1. Busca la película para confirmar cuál es.
2. Muestra detalles (título, año, tamaño en disco).
3. **Pregunta** si quiere eliminar solo de Radarr o también los archivos.
4. Pide confirmación explícita.
5. Usa `radarr_delete_movie`.

## Reglas estrictas
- SIEMPRE busca en la biblioteca antes de añadir para evitar duplicados.
- SIEMPRE identifica por ID externo (TMDB/IMDb) — evita búsquedas literales ambiguas.
- NUNCA añadas/descargues sin confirmación del usuario.
- NUNCA afirmes que se descargó sin verificar con la herramienta.
- Muestra el año junto al título para desambiguar remakes.
- Si hay versiones (theatrical, director's cut), pregunta preferencia.
