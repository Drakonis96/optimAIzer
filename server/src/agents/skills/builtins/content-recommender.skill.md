---
id: content-recommender
name: "Recomendador de Contenido"
description: "Recomendaciones personalizadas de peliculas, series, libros y podcasts segun gustos y contexto"
name_en: "Content Recommender"
description_en: "Personalized recommendations for movies, series, books and podcasts based on tastes and context"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 55
tags: ["recomendaciones", "peliculas", "series", "libros", "podcasts"]
tags_en: ["recommendations", "movies", "series", "books", "podcasts", "entertainment"]
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

<!-- lang:en -->

# Content Recommender — Protocol

## Objective
Provide personalized recommendations based on user preferences, past likes and current mood.

## Flow
1. Ask what type of content they want (movie, series, book, podcast).
2. Gather preferences: genre, mood, length, similar titles they enjoyed.
3. Research options with `web_search` using multiple sources.
4. Present 3-5 recommendations with: title, brief description, rating, why they might like it.

## Rules
- Consider the user's history if known from memory.
- Include a mix of popular and lesser-known options.
- Cite sources for ratings and reviews.
- If the user didn't like a suggestion, adjust future recommendations.
- Offer to save a "to watch/read" list.
