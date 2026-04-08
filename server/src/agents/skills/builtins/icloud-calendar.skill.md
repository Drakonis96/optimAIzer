---
id: icloud-calendar
name: "iCloud Calendar"
description: "Gestión de calendarios iCloud/Apple via CalDAV: crear, listar, buscar, actualizar y eliminar eventos"
name_en: "iCloud Calendar"
description_en: "iCloud/Apple calendar management via CalDAV: create, list, search, update and delete events"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 80
tags: ["calendario", "icloud", "apple", "caldav", "eventos", "agenda"]
tags_en: ["calendar", "icloud", "apple", "caldav", "events", "schedule"]
category: "integration"
triggers:
  events:
    - "keyword:calendario"
    - "keyword:calendar"
    - "keyword:evento"
    - "keyword:icloud"
    - "keyword:apple calendar"
    - "keyword:cita"
    - "keyword:agenda"
  conditions: "Cuando el usuario gestione eventos de iCloud Calendar"
requires_tools:
  - create_calendar_event
  - list_calendar_events
  - search_calendar_events
  - update_calendar_event
  - delete_calendar_event
---

# iCloud Calendar — Protocolo de Gestión via CalDAV

## Herramientas disponibles
Las mismas herramientas de calendario genéricas se usan para iCloud:
- `create_calendar_event` — Crear eventos con título, fechas, descripción, ubicación
- `list_calendar_events` — Listar eventos en rango de fechas
- `search_calendar_events` — Buscar eventos por texto o rango
- `update_calendar_event` — Modificar eventos existentes (requiere event_id)
- `delete_calendar_event` — Eliminar eventos (requiere event_id)

## Consideraciones específicas de iCloud
- La conexión usa CalDAV con contraseña específica de aplicación (nunca exponerla).
- Si el usuario tiene un calendario específico configurado (`calendarName`), los eventos se crean ahí.
- Los IDs de evento son URIs CalDAV — trátalos como opacos, no los modifiques.
- La sincronización puede tener un ligero retardo (1-2 segundos).

## Flujo de trabajo

### Crear evento
1. Confirma: **título**, **fecha/hora inicio**, **fecha/hora fin** (o duración).
2. Opcionalmente: descripción, ubicación, recordatorio.
3. Usa `create_calendar_event` — el sistema enruta automáticamente al proveedor iCloud.
4. Confirma con recibo claro.

### Consultar / Buscar
1. `list_calendar_events` para ver agenda.
2. `search_calendar_events` para buscar por texto.
3. Presenta resultados de forma legible.

### Actualizar / Eliminar
1. Busca primero para obtener event_id.
2. Muestra detalles y pide confirmación.
3. Ejecuta la acción.

## Reglas
- NUNCA expongas credenciales de iCloud (email, contraseña de app).
- Nunca afirmes haber hecho algo sin llamar la herramienta.
- Si hay múltiples calendarios, pregunta en cuál actuar.
- Formatea fechas de forma legible con día de la semana.

<!-- lang:en -->

# iCloud Calendar — CalDAV Management Protocol

## Available tools
The same generic calendar tools are used for iCloud:
- `create_calendar_event` — Create events with title, dates, description, location
- `list_calendar_events` — List events in a date range
- `search_calendar_events` — Search events by text or range
- `update_calendar_event` — Modify existing events (requires event_id)
- `delete_calendar_event` — Delete events (requires event_id)

## iCloud-specific considerations
- The connection uses CalDAV with an app-specific password (never expose it).
- If the user has a specific calendar configured (`calendarName`), events are created there.
- Event IDs are CalDAV URIs — treat them as opaque, do not modify them.
- Sync may have a slight delay (1-2 seconds).

## Workflow

### Create event
1. Confirm: **title**, **start date/time**, **end date/time** (or duration).
2. Optionally: description, location, reminder.
3. Use `create_calendar_event` — the system automatically routes to the iCloud provider.
4. Confirm with a clear receipt.

### Query / Search
1. `list_calendar_events` to view schedule.
2. `search_calendar_events` to search by text.
3. Present results in a readable format.

### Update / Delete
1. Search first to get event_id.
2. Show details and ask for confirmation.
3. Execute the action.

## Rules
- NEVER expose iCloud credentials (email, app password).
- Never claim to have done something without calling the tool.
- If there are multiple calendars, ask which one to act on.
- Format dates in a readable way including day of the week.
