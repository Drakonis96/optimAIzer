---
id: home-maintenance
name: "Mantenimiento del Hogar"
description: "Checklists y recordatorios de mantenimiento domestico, vehiculo y revisiones periodicas"
name_en: "Home Maintenance"
description_en: "Checklists and reminders for home maintenance, vehicle and periodic inspections"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 53
tags: ["mantenimiento", "hogar", "revision", "checklist", "recordatorios"]
tags_en: ["maintenance", "home", "inspection", "checklist", "reminders"]
category: "lifestyle"
triggers:
  events:
    - "keyword:mantenimiento"
    - "keyword:revision"
    - "keyword:itv"
    - "keyword:filtro"
    - "keyword:seguro"
  conditions: "Cuando el usuario quiera planificar tareas periodicas de hogar o vehiculo"
requires_tools:
  - create_list
  - add_to_list
  - update_list_item
  - check_list_item
  - schedule_task
  - list_scheduled_tasks
  - set_reminder
  - create_note
---

# Mantenimiento del Hogar

## Objetivo
Convertir mantenimiento recurrente en tareas visibles, fechadas y faciles de revisar.

## Agrupacion sugerida
- Mensual: filtros, limpieza tecnica, consumibles.
- Trimestral: revisiones preventivas.
- Anual: seguros, ITV, caldera, aire acondicionado, renovaciones.

## Flujo
1. Identifica activo o area: casa, coche, oficina, electrodomestico.
2. Define frecuencia realista.
3. Crea checklist y recordatorio o tarea programada.
4. Cuando el usuario complete algo, marca el item y propone la siguiente fecha.

## Reglas
- No inventes intervalos tecnicos: si dependen del fabricante, pregunta o busca referencia.
- Si hay riesgo de seguridad o garantia, senalalo y sugiere prioridad alta.
- Mantener nombres de tareas concretos, no genricos.

<!-- lang:en -->

# Home Maintenance — Protocol

## Objective
Turn recurring maintenance into visible, dated and easy-to-review tasks.

## Suggested grouping
- Monthly: filters, technical cleaning, consumables.
- Quarterly: preventive inspections.
- Annual: insurance, vehicle inspection, boiler, AC, renewals.

## Flow
1. Identify asset or area: house, car, office, appliance.
2. Define realistic frequency.
3. Create checklist and reminder or scheduled task.
4. When the user completes something, mark the item and propose the next date.

## Rules
- Don't invent technical intervals: if they depend on the manufacturer, ask or search for reference.
- If there's a safety risk or warranty concern, flag it and suggest high priority.
- Keep task names concrete, not generic.
