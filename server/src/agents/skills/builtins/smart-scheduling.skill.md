---
id: smart-scheduling
name: "Planificación Inteligente"
description: "Gestión avanzada de agenda: planificación de jornadas, bloques de tiempo, hábitos y optimización del calendario"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["productividad", "planificación", "agenda", "tiempo", "hábitos"]
category: "productivity"
triggers:
  events:
    - "keyword:planifica"
    - "keyword:organiza mi"
    - "keyword:rutina"
    - "keyword:hábito"
    - "keyword:habito"
    - "keyword:bloque"
    - "keyword:time block"
    - "keyword:semana"
  conditions: "Cuando el usuario pida planificación de tiempo o rutinas"
requires_tools:
  - create_calendar_event
  - list_calendar_events
  - set_reminder
  - schedule_task
  - create_note
  - create_list
---

# Planificación Inteligente — Protocolo

## Capacidades
- Planificación diaria/semanal con bloques de tiempo
- Creación de rutinas matutinas/nocturnas
- Seguimiento de hábitos con recordatorios
- Optimización de agenda existente
- Time-blocking para trabajo profundo

## Flujos de trabajo

### Planificación del día
1. Consulta la agenda del día con `list_calendar_events`.
2. Identifica huecos libres.
3. Propone distribución del tiempo:
   - 🔴 Bloques de enfoque (trabajo profundo, sin interrupciones)
   - 🟡 Tareas administrativas (emails, reuniones cortas)
   - 🟢 Descansos y transiciones
   - 🔵 Tiempo personal / ejercicio
4. Crea eventos en el calendario si el usuario acepta.
5. Programa recordatorios de transición entre bloques.

### Planificación semanal
1. Revisa compromisos existentes de la semana (`list_calendar_events` 7 días).
2. Identifica patrones y huecos.
3. Propone distribución semanal:
   - Días "maker" (trabajo creativo/profundo)
   - Días "manager" (reuniones, admin)
   - Bloques de revisión/planificación
4. Presenta en formato visual como tabla semanal.

### Hábitos y rutinas
1. Define el hábito con el usuario: qué, cuándo, duración, frecuencia.
2. Crea tarea recurrente con `schedule_task` (cron).
3. Crea lista de seguimiento con `create_list` para tracking.
4. Ejemplo: "Rutina matutina 6:30-7:30: meditación (10m), ejercicio (30m), ducha (15m), journaling (5m)".

### Formato de plan diario
```
📅 **Plan del día — [Fecha]**

⏰ 07:00 - 07:30 | 🧘 Rutina matutina
⏰ 07:30 - 08:00 | 🍳 Desayuno
⏰ 08:00 - 10:00 | 🔴 Trabajo profundo: [tarea principal]
⏰ 10:00 - 10:15 | ☕ Descanso
⏰ 10:15 - 11:00 | 📧 Emails y admin
⏰ 11:00 - 12:30 | 🟡 Reunión: [nombre]
⏰ 12:30 - 13:30 | 🍽️ Almuerzo
⏰ 13:30 - 15:30 | 🔴 Trabajo profundo: [tarea secundaria]
⏰ 15:30 - 15:45 | ☕ Descanso
⏰ 15:45 - 17:00 | 🟡 Tareas pendientes
⏰ 17:00 - 17:30 | 📋 Revisión del día + plan de mañana

Eventos fijos: [lista de compromisos del calendario]
Huecos libres: [horarios disponibles]
```

## Reglas
- Respeta siempre los eventos existentes en el calendario — no propongas sobrescribir.
- Incluye descansos obligatorios (mínimo 15 min cada 2h de trabajo).
- Pregunta preferencias: ¿madrugador o noctámbulo? ¿Bloques largos o cortos?
- No crees eventos/recordatorios sin confirmación del usuario.
- Si el usuario tiene demasiados compromisos, sugiere priorizar (no llenar todo).
