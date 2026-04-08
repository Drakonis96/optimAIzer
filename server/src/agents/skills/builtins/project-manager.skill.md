---
id: project-manager
name: "Gestión de Proyectos"
description: "Planificación, seguimiento y gestión de proyectos: tareas, hitos, dependencias y seguimiento de progreso"
name_en: "Project Management"
description_en: "Project planning, tracking and management: tasks, milestones, dependencies and progress tracking"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["proyectos", "tareas", "gestión", "productividad", "planificación"]
tags_en: ["projects", "tasks", "management", "productivity", "planning"]
category: "productivity"
triggers:
  events:
    - "keyword:proyecto"
    - "keyword:tarea"
    - "keyword:milestone"
    - "keyword:hito"
    - "keyword:sprint"
    - "keyword:deadline"
    - "keyword:progreso"
    - "keyword:kanban"
  conditions: "Cuando el usuario gestione proyectos o tareas"
requires_tools:
  - create_list
  - get_lists
  - add_to_list
  - check_list_item
  - create_note
  - get_notes
  - update_note
  - set_reminder
  - schedule_task
---

# Gestión de Proyectos — Protocolo

## Estructura de proyecto

### Creación de proyecto
1. Recoge información: nombre, objetivo, fecha límite, participantes.
2. Crea una **nota** con el plan general:
   ```
   # Proyecto: [Nombre]
   📅 Inicio: [fecha] | Deadline: [fecha]
   🎯 Objetivo: [descripción]
   
   ## Fases
   1. [Fase 1] — [fecha inicio] a [fecha fin]
   2. [Fase 2] — [fecha inicio] a [fecha fin]
   ```
3. Crea **listas** para cada fase/sprint con tareas concretas.
4. Programa recordatorios de revisión con `schedule_task`.

### Seguimiento con listas
Cada fase del proyecto es una lista:
```
📋 [Proyecto] - Fase 1: Diseño
☑️ Definir requisitos — completado 15/01
☑️ Wireframes — completado 18/01
⬜ Mockups UI — en progreso
⬜ Revisión con cliente — pendiente
⬜ Aprobación final — bloqueado (espera mockups)
```

### Dashboard de proyecto
```
📊 **[Proyecto] — Estado actual**

Progreso global: ████████░░ 80%

Fase actual: Fase 3 - Desarrollo
📅 Deadline: 15 Feb 2025 (quedan 12 días)

✅ Completadas: 16/20 tareas
🔄 En progreso: 2
⏳ Pendientes: 2
🚫 Bloqueadas: 0

⚠️ Riesgo: Moderado (2 tareas sin empezar a 12 días del deadline)
```

### Revisión periódica
Si el usuario activa revisiones automáticas:
1. Programa con `schedule_task` (ej: "todos los lunes a las 9:00").
2. En cada revisión:
   - Lee las listas del proyecto
   - Calcula progreso
   - Identifica tareas atrasadas
   - Envía resumen por Telegram

## Metodologías soportadas

### Kanban simple
Tres listas por proyecto:
- `[Proyecto] - Por hacer`
- `[Proyecto] - En progreso`
- `[Proyecto] - Completado`

### Sprint (mini-Scrum)
- Sprint de 1-2 semanas
- Backlog general + sprint actual
- Retrospectiva al final del sprint

## Reglas
- Tareas deben ser accionables y específicas (no genéricas).
- Cada tarea debe tener un criterio claro de "completado".
- Si una tarea lleva más de 3 días sin moverse, sugerir dividirla.
- Alertar si el deadline se acerca y hay tareas sin empezar.
- No crear estructura excesiva para proyectos pequeños (adaptar al tamaño).

<!-- lang:en -->

# Project Management — Protocol

## Project structure

### Project creation
1. Collect information: name, objective, deadline, participants.
2. Create a **note** with the general plan.
3. Create **lists** for each phase/sprint with concrete tasks.
4. Schedule review reminders with `schedule_task`.

### Tracking with lists
Each project phase is a list with tasks showing completion status.

### Project dashboard
Show: global progress percentage, current phase, deadline, completed/in-progress/pending/blocked tasks, risk assessment.

### Periodic review
If the user activates automatic reviews:
1. Schedule with `schedule_task`.
2. On each review: read project lists, calculate progress, identify overdue tasks, send summary via Telegram.

## Supported methodologies

### Simple Kanban
Three lists per project: To do, In progress, Completed.

### Sprint (mini-Scrum)
- 1-2 week sprints
- General backlog + current sprint
- Retrospective at end of sprint

## Rules
- Tasks must be actionable and specific (not generic).
- Each task must have a clear "done" criterion.
- If a task has been stuck for more than 3 days, suggest splitting it.
- Alert if the deadline is approaching and there are unstarted tasks.
- Do not create excessive structure for small projects (adapt to size).
