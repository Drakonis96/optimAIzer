---
id: podcast-video-summarizer
name: "Resumen de Podcast y Video"
description: "Resume podcasts, videos y notas de voz, extrayendo ideas clave, timestamps y tareas"
name_en: "Podcast & Video Summarizer"
description_en: "Summarize podcasts, videos and voice notes, extracting key ideas, timestamps and tasks"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 57
tags: ["podcast", "video", "youtube", "resumen", "transcripcion"]
tags_en: ["podcast", "video", "youtube", "summary", "transcription"]
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

<!-- lang:en -->

# Podcast & Video Summarizer — Protocol

## Objective
Extract key ideas, structure and concrete actions from audiovisual content without inventing transcriptions or timestamps.

## Recommended flow
1. If the user shares an audio or voice note, use `transcribe_telegram_audio`.
2. If they share a file, use `process_telegram_file` when applicable.
3. If they share a link, try to get context with `fetch_webpage` or `browse_website`.
4. Summarize in levels: central idea, key points, actionable phrases, tasks or decisions.

## Rules
- Don't invent timestamps if the source doesn't provide them.
- If the link doesn't give enough access, ask for the file, transcript or excerpt.
- If the user wants to save the summary, offer to create a note.
