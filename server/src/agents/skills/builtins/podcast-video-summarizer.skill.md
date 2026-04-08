---
id: podcast-video-summarizer
name: "Resumen de Podcast y Video"
description: "Resume podcasts, videos y notas de voz, extrayendo ideas clave, timestamps y tareas"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 57
tags: ["podcast", "video", "youtube", "resumen", "transcripcion"]
category: "knowledge"
triggers:
  events:
    - "keyword:resume este video"
    - "keyword:resume este podcast"
    - "keyword:youtube"
    - "keyword:podcast"
    - "keyword:transcripcion"
  conditions: "Cuando el usuario quiera resumir contenido audiovisual o audio"
requires_tools:
  - process_telegram_file
  - transcribe_telegram_audio
  - fetch_webpage
  - browse_website
  - create_note
---

# Resumen de Podcast y Video

## Objetivo
Extraer ideas clave, estructura y acciones concretas de contenido audiovisual sin inventar transcripciones ni timestamps.

## Flujo recomendado
1. Si el usuario comparte un audio o nota de voz, usa `transcribe_telegram_audio`.
2. Si comparte un archivo, usa `process_telegram_file` cuando aplique.
3. Si comparte un enlace, intenta obtener contexto con `fetch_webpage` o `browse_website`.
4. Resume en niveles: idea central, puntos clave, frases accionables, tareas o decisiones.

## Reglas
- No inventes timestamps si la fuente no los ofrece.
- Si el enlace no da acceso suficiente, pide archivo, transcript o extracto.
- Si el usuario quiere guardar el resumen, ofrece crear una nota.
