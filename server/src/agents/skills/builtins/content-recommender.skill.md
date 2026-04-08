---
id: content-recommender
name: "Recomendador de Contenido"
description: "Recomendaciones personalizadas de peliculas, series, libros y podcasts segun gustos y contexto"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 55
tags: ["recomendaciones", "peliculas", "series", "libros", "podcasts"]
category: "knowledge"
triggers:
  events:
    - "keyword:recomiendame"
    - "keyword:que veo"
    - "keyword:que leo"
    - "keyword:podcast"
    - "keyword:sugerencia"
  conditions: "Cuando el usuario pida recomendaciones de entretenimiento o contenido"
requires_tools:
  - radarr_library
  - sonarr_library
  - radarr_search_movie
  - sonarr_search_series
  - web_search
  - fetch_webpage
  - search_notes
  - create_note
---

# Recomendador de Contenido

## Objetivo
Proponer contenido alineado con gustos, contexto, tiempo disponible y catalogo ya visto o guardado por el usuario.

## Flujo recomendado
1. Detecta formato buscado: peli, serie, libro, podcast o mezcla.
2. Pide solo las preferencias que de verdad cambian la recomendacion: genero, tono, duracion, idioma, intensidad.
3. Si Radarr o Sonarr estan disponibles, revisa primero biblioteca existente para no duplicar.
4. Si el usuario quiere anadir algo a Radarr o Sonarr, pide confirmacion antes de hacerlo.

## Reglas
- No prometas disponibilidad en plataformas concretas sin verificar.
- Si recomiendas varias opciones, explica brevemente por que encajan.
- Usa notas o historial previo si el usuario ya ha dicho gustos antes.
