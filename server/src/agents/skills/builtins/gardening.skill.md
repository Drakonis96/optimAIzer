---
id: gardening
name: "Jardineria"
description: "Calendario de riego, cuidados, siembra y diagnostico basico de plantas"
name_en: "Gardening"
description_en: "Watering schedule, care, planting and basic plant diagnostics"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 49
tags: ["jardineria", "plantas", "riego", "siembra", "huerto"]
tags_en: ["gardening", "plants", "watering", "planting", "garden"]
category: "lifestyle"
triggers:
  events:
    - "keyword:planta"
    - "keyword:jardin"
    - "keyword:regar"
    - "keyword:siembra"
    - "keyword:huerto"
  conditions: "Cuando el usuario quiera cuidar plantas o planificar tareas de jardin"
requires_tools:
  - web_search
  - fetch_webpage
  - create_note
  - search_notes
  - set_reminder
  - create_calendar_event
  - analyze_telegram_image
---

# Jardineria

## Objetivo
Ayudar a planificar cuidados, detectar necesidades comunes y registrar calendario de riego o siembra.

## Casos de uso
- Plan de riego y abonado.
- Calendario de siembra o poda.
- Diagnostico basico apoyado por imagen si el usuario envia foto.
- Ficha por planta con notas utiles.

## Protocolo
1. Identifica especie o contexto aproximado.
2. Si el cuidado depende de clima o temporada, aclara ubicacion o busca referencia.
3. Para sintomas visuales, usa `analyze_telegram_image` si el usuario envia imagen.
4. Convierte cuidados repetitivos en recordatorios reales.

## Reglas
- No presentes el analisis de imagen como diagnostico definitivo.
- Si no conoces la especie, pregunta o investiga antes de recomendar riego o poda.
- Evita instrucciones agresivas cuando la evidencia es baja.

<!-- lang:en -->

# Gardening — Protocol

## Objective
Help plan care, detect common needs and record watering or planting schedules.

## Use cases
- Watering and fertilizing plan.
- Planting or pruning calendar.
- Basic diagnostics supported by image if the user sends a photo.
- Plant info sheet with useful notes.

## Protocol
1. Identify species or approximate context.
2. If care depends on climate or season, clarify location or search for reference.
3. For visual symptoms, use `analyze_telegram_image` if the user sends an image.
4. Convert recurring care into real reminders.

## Rules
- Don't present image analysis as definitive diagnosis.
- If you don't know the species, ask or research before recommending watering or pruning.
- Avoid aggressive instructions when evidence is low.
