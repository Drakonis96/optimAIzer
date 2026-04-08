---
id: google-calendar
name: "Google Calendar"
description: "Gestión completa de Google Calendar: crear, listar, buscar, actualizar y eliminar eventos"
name_en: "Google Calendar"
description_en: "Full Google Calendar management: create, list, search, update and delete events"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 80
tags: ["calendario", "google", "eventos", "agenda", "productividad"]
tags_en: ["calendar", "google", "events", "schedule", "productivity"]
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

<!-- lang:en -->

# Google Calendar — Management Protocol

## Available tools
- `create_calendar_event` — Create events with title, start/end date-time, description, location
- `list_calendar_events` — List events in a date range (default: next 7 days)
- `search_calendar_events` — Search events by text, title or date range
- `update_calendar_event` — Update fields of an existing event (requires event_id)
- `delete_calendar_event` — Delete an event (requires event_id and confirmation)

## Mandatory workflow

### Create event
1. Confirm with user: **title**, **date**, **start time**, **end time** (or duration).
2. Optionally ask: description, location, reminder.
3. If time is ambiguous (e.g., "at 3"), ask AM/PM or 24h format.
4. Call `create_calendar_event` with the data.
5. Confirm with receipt: title, date/time, event ID.

### Check schedule
1. Use `list_calendar_events` with the requested range.
2. Present events clearly with date, time and title.
3. If no events, state that clearly.

### Search event
1. Use `search_calendar_events` with the search term.
2. If there are multiple results, show list with IDs.
3. Ask the user to select if they need to act on a specific one.

### Update event
1. First search for the event to get the `event_id`.
2. If there are multiple candidates, show the list and ask for confirmation.
3. Show proposed changes before executing.
4. Call `update_calendar_event` with the ID and fields to modify.

### Delete event
1. Search the event and confirm which one to delete by showing details.
2. ALWAYS ask for explicit confirmation before deleting.
3. Use `delete_calendar_event` with the event_id.

## Strict rules
- NEVER claim you created/updated/deleted an event without calling the tool.
- If there are multiple candidates, show IDs and ask for explicit confirmation.
- Respect the user's timezone configured in the agent.
- For recurring events, clarify if the change applies to one occurrence or all.
- Format dates in a readable way (e.g., "Monday January 15, 10:00 - 11:00").
