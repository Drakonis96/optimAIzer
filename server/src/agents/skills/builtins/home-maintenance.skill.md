---
id: home-maintenance
name: "Mantenimiento del Hogar"
description: "Checklists y recordatorios de mantenimiento domestico, vehiculo y revisiones periodicas"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 53
tags: ["mantenimiento", "hogar", "revision", "checklist", "recordatorios"]
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
