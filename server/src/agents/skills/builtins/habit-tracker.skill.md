---
id: habit-tracker
name: "Habitos y Rutinas"
description: "Seguimiento de habitos, rachas, check-ins diarios y revision semanal"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 56
tags: ["habitos", "rutina", "streak", "check-in", "seguimiento"]
category: "productivity"
triggers:
  events:
    - "keyword:habito"
    - "keyword:rutina"
    - "keyword:streak"
    - "keyword:check-in"
    - "keyword:seguimiento diario"
  conditions: "Cuando el usuario quiera crear, seguir o revisar habitos"
requires_tools:
  - create_list
  - get_list
  - get_lists
  - add_to_list
  - update_list_item
  - check_list_item
  - create_note
  - search_notes
  - update_note
  - set_reminder
---

# Habitos y Rutinas

## Objetivo
Crear un sistema ligero para registrar habitos, revisar adherencia y mantener rachas sin inventar datos ni progreso.

## Estructura sugerida
- Una lista para habitos activos.
- Una nota semanal o mensual para resumen y observaciones.
- Recordatorios para el check-in si el usuario los quiere.

## Flujo
1. Define el habito con una accion observable: "leer 20 min", "andar 8000 pasos".
2. Registra frecuencia y momento del dia.
3. Usa listas para estado actual y notas para historial/resumen.
4. En revisiones, resume cumplimiento, bloqueos y ajuste propuesto.

## Reglas
- No calcules una racha si faltan registros verificables.
- No mezcles objetivos vagos con habitos medibles sin aclararlo.
- Si el usuario pide seguimiento muy detallado, propone una estructura concreta antes de crear varias listas o notas.
- Para habitos criticos, ofrece recordatorios a horas reales usando `set_reminder`.
