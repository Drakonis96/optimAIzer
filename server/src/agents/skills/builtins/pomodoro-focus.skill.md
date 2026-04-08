---
id: pomodoro-focus
name: "Pomodoro y Focus"
description: "Gestion de sesiones de concentracion, descansos y bloques de trabajo con recordatorios"
name_en: "Pomodoro & Focus"
description_en: "Focus session management, breaks and work blocks with reminders"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 58
tags: ["pomodoro", "focus", "timer", "deep work", "productividad"]
tags_en: ["pomodoro", "focus", "timer", "deep work", "productivity"]
category: "productivity"
triggers:
  events:
    - "keyword:pomodoro"
    - "keyword:focus"
    - "keyword:concentracion"
    - "keyword:trabajo profundo"
    - "keyword:timer"
  conditions: "Cuando el usuario quiera organizar una sesion de foco o descansos"
requires_tools:
  - set_reminder
  - list_reminders
  - cancel_reminder
  - postpone_reminder
  - create_note
  - update_note
  - search_notes
  - remember
---

# Pomodoro y Focus

## Objetivo
Ayudar al usuario a iniciar, mantener y cerrar sesiones de trabajo profundo usando recordatorios reales, no temporizadores simulados.

## Protocolo
1. Define objetivo concreto de la sesion antes de empezar.
2. Acuerda formato: 25/5, 50/10, sprint personalizado o bloque unico.
3. Usa `set_reminder` para marcar fin de bloque y descanso.
4. Si el usuario quiere registrar progreso, guarda una nota breve de la sesion.

## Plantilla rapida
- Objetivo del bloque
- Duracion del foco
- Duracion del descanso
- Criterio de exito

## Cierre de sesion
- Pregunta que se completo.
- Registra blockers y siguiente paso.
- Si hace falta, programa el siguiente bloque o pospone el recordatorio actual.

## Reglas
- Nunca digas que un temporizador esta corriendo si no has creado recordatorios reales.
- Si el usuario quiere cancelar una sesion, usa `cancel_reminder` cuando aplique.
- Si el usuario pierde una sesion, ofrece replanificar con `postpone_reminder` en vez de reiniciar desde cero sin preguntar.
- Mantener el tono corto y operativo; esta skill debe reducir friccion, no crear mas texto.

<!-- lang:en -->

# Pomodoro & Focus — Protocol

## Objective
Help the user start, maintain and close deep work sessions using real reminders, not simulated timers.

## Protocol
1. Define a concrete session objective before starting.
2. Agree on format: 25/5, 50/10, custom sprint or single block.
3. Use `set_reminder` to mark end of block and break.
4. If the user wants to record progress, save a brief session note.

## Quick template
- Block objective
- Focus duration
- Break duration
- Success criteria

## Session close
- Ask what was completed.
- Record blockers and next step.
- If needed, schedule the next block or postpone the current reminder.

## Rules
- Never say a timer is running if you haven't created real reminders.
- If the user wants to cancel a session, use `cancel_reminder` when applicable.
- If the user misses a session, offer to reschedule with `postpone_reminder` instead of restarting from scratch without asking.
- Keep the tone short and operational; this skill should reduce friction, not create more text.
