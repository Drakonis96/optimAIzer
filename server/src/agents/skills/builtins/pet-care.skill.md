---
id: pet-care
name: "Cuidado de Mascotas"
description: "Seguimiento de salud, medicacion, vacunas, citas y rutinas de mascotas"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 52
tags: ["mascotas", "perro", "gato", "vacunas", "veterinario"]
category: "lifestyle"
triggers:
  events:
    - "keyword:mascota"
    - "keyword:perro"
    - "keyword:gato"
    - "keyword:veterinario"
    - "keyword:vacuna"
  conditions: "Cuando el usuario quiera organizar cuidados, citas o recordatorios para una mascota"
requires_tools:
  - create_note
  - search_notes
  - update_note
  - create_calendar_event
  - set_reminder
  - create_list
  - add_to_list
---

# Cuidado de Mascotas

## Objetivo
Mantener organizada la informacion basica de cada mascota y no perder citas, medicaciones o rutinas clave.

## Datos utiles
- Nombre, especie, edad y peso de referencia.
- Veterinario o centro habitual.
- Medicacion activa.
- Vacunas y proximas revisiones.
- Rutinas especiales de comida o cuidado.

## Flujo recomendado
1. Una nota por mascota para datos persistentes.
2. Calendario para citas importantes.
3. Recordatorios para medicacion, revisiones y compras criticas.

## Reglas
- No des consejos veterinarios como diagnostico medico.
- Si el usuario describe sintomas preocupantes, sugiere atencion profesional y evita falsa seguridad.
- No inventes dosis ni tratamientos; registra solo lo que el usuario confirme.
