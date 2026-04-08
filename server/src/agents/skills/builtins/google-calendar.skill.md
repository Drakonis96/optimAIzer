---
id: google-calendar
name: "Google Calendar"
description: "Gestión completa de Google Calendar: crear, listar, buscar, actualizar y eliminar eventos"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 80
tags: ["calendario", "google", "eventos", "agenda", "productividad"]
category: "integration"
triggers:
  events:
    - "keyword:calendario"
    - "keyword:calendar"
    - "keyword:evento"
    - "keyword:reunión"
    - "keyword:reunion"
    - "keyword:cita"
    - "keyword:agenda"
  conditions: "Cuando el usuario gestione eventos de Google Calendar"
requires_tools:
  - create_calendar_event
  - list_calendar_events
  - search_calendar_events
  - update_calendar_event
  - delete_calendar_event
---

# Google Calendar — Protocolo de Gestión

## Herramientas disponibles
- `create_calendar_event` — Crear eventos con título, fecha/hora inicio y fin, descripción, ubicación
- `list_calendar_events` — Listar eventos en un rango de fechas (por defecto: próximos 7 días)
- `search_calendar_events` — Buscar eventos por texto, título o rango de fechas
- `update_calendar_event` — Actualizar campos de un evento existente (requiere event_id)
- `delete_calendar_event` — Eliminar un evento (requiere event_id y confirmación)

## Flujo de trabajo obligatorio

### Crear evento
1. Confirma con el usuario: **título**, **fecha**, **hora inicio**, **hora fin** (o duración).
2. Pregunta opcionalmente: descripción, ubicación, recordatorio.
3. Si la hora es ambigua (ej: "a las 3"), pregunta AM/PM o formato 24h.
4. Llama a `create_calendar_event` con los datos.
5. Confirma con recibo: título, fecha/hora, ID del evento.

### Consultar agenda
1. Usa `list_calendar_events` con el rango solicitado.
2. Presenta los eventos de forma clara con fecha, hora y título.
3. Si no hay eventos, indícalo claramente.

### Buscar evento
1. Usa `search_calendar_events` con el término de búsqueda.
2. Si hay múltiples resultados, muestra lista con IDs.
3. Pide al usuario que seleccione si necesita actuar sobre uno específico.

### Actualizar evento
1. Primero busca el evento para obtener el `event_id`.
2. Si hay múltiples candidatos, muestra la lista y pide confirmación.
3. Muestra los cambios propuestos antes de ejecutar.
4. Llama a `update_calendar_event` con el ID y los campos a modificar.

### Eliminar evento
1. Busca el evento y confirma cuál eliminar mostrando detalles.
2. SIEMPRE pide confirmación explícita antes de eliminar.
3. Usa `delete_calendar_event` con el event_id.

## Reglas estrictas
- NUNCA afirmes que creaste/actualizaste/eliminaste un evento sin llamar la herramienta.
- Si hay múltiples candidatos, muestra IDs y pide confirmación explícita.
- Respeta la zona horaria del usuario configurada en el agente.
- Para eventos recurrentes, aclara si el cambio aplica a una ocurrencia o a todas.
- Formatea fechas de forma legible (ej: "Lunes 15 de enero, 10:00 - 11:00").
