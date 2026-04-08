---
id: pet-care
name: "Cuidado de Mascotas"
description: "Seguimiento de salud, medicacion, vacunas, citas y rutinas de mascotas"
name_en: "Pet Care"
description_en: "Health tracking, medication, vaccines, appointments and pet routines"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 52
tags: ["mascotas", "perro", "gato", "vacunas", "veterinario"]
tags_en: ["pets", "dog", "cat", "vaccines", "veterinary"]
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

<!-- lang:en -->

# Pet Care — Protocol

## Objective
Keep organized the basic information for each pet and not miss appointments, medications or key routines.

## Useful data
- Name, species, age and reference weight.
- Regular veterinarian or center.
- Active medication.
- Vaccines and upcoming checkups.
- Special food or care routines.

## Recommended flow
1. One note per pet for persistent data.
2. Calendar for important appointments.
3. Reminders for medication, checkups and critical purchases.

## Rules
- Don't give veterinary advice as medical diagnosis.
- If the user describes worrying symptoms, suggest professional attention and avoid false reassurance.
- Don't invent doses or treatments; only record what the user confirms.
