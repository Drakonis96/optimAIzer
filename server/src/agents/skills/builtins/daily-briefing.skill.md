---
id: daily-briefing
name: "Resumen Diario / Daily Briefing"
description: "Genera un resumen operativo del dia con agenda, correo, tareas y contexto relevante"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 68
tags: ["briefing", "resumen", "agenda", "correo", "tareas", "morning"]
category: "productivity"
triggers:
  events:
    - "keyword:briefing"
    - "keyword:resumen del dia"
    - "keyword:buenos dias"
    - "keyword:plan del dia"
    - "keyword:morning brief"
  conditions: "Cuando el usuario pida un resumen operativo del dia o de la manana"
requires_tools:
  - get_current_time
  - list_calendar_events
  - get_unread_email_count
  - list_emails
  - get_pending_tasks
  - list_reminders
  - search_notes
  - web_search
  - fetch_webpage
---

# Resumen Diario / Daily Briefing

## Objetivo
Construir un resumen corto, accionable y orientado a decisiones para empezar el dia o preparar el siguiente bloque de trabajo.

## Fuentes prioritarias
- Agenda del dia con `list_calendar_events`.
- Inbox con `get_unread_email_count` y `list_emails`.
- Pendientes con `get_pending_tasks` y `list_reminders`.
- Contexto guardado con `search_notes` si el usuario tiene proyectos o asuntos abiertos.
- Contexto externo con `web_search` o `fetch_webpage` solo si el usuario pide noticias, mercado, trafico, clima o un tema especifico.

## Flujo recomendado
1. Usa `get_current_time` para fijar la ventana temporal correcta.
2. Revisa agenda, correo y pendientes antes de buscar informacion externa.
3. Agrupa el briefing en bloques claros: hoy, riesgos, foco sugerido, siguientes acciones.
4. Si detectas conflictos horarios o demasiadas tareas, senalalo explicitamente.

## Formato sugerido
1. Agenda de hoy
2. Inbox y mensajes pendientes
3. Tareas y recordatorios clave
4. Riesgos, bloqueos o solapes
5. Propuesta de prioridad para el siguiente bloque de foco

## Reglas
- No inventes noticias, clima o contexto externo: usa herramientas si el usuario lo ha pedido.
- Si no hay eventos o correos, dilo de forma directa y breve.
- Si el usuario pide un briefing ultra corto, limitate a 3-5 bullets.
- Si el usuario pide un briefing ejecutivo, prioriza decisiones y riesgos sobre detalle operativo.
