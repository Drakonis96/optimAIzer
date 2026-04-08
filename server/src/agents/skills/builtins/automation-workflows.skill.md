---
id: automation-workflows
name: "Automatización y Workflows"
description: "Crear cadenas de automatización: combinar herramientas, programar tareas complejas y flujos condicionales"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["automatización", "workflows", "tareas", "cron", "encadenamiento"]
category: "productivity"
triggers:
  events:
    - "keyword:automatiza"
    - "keyword:automatización"
    - "keyword:workflow"
    - "keyword:cuando pase"
    - "keyword:cada vez que"
    - "keyword:si detectas"
    - "keyword:encadena"
  conditions: "Cuando el usuario quiera crear automatizaciones o flujos complejos"
requires_tools:
  - schedule_task
  - set_reminder
  - subscribe_to_event
  - create_note
  - web_search
  - fetch_webpage
  - send_telegram_message
---

# Automatización y Workflows — Protocolo

## Concepto
Un workflow es una secuencia de acciones que se ejecutan automáticamente ante un trigger (horario, evento, condición).

## Tipos de automatización

### 1. Programada (Cron)
Acciones que se ejecutan en un horario fijo:
```
Ejemplos:
- "Todos los lunes a las 8:00, envíame un resumen de la semana"
- "Cada día a las 22:00, recuérdame mis tareas pendientes para mañana"
- "El primer día del mes, genera un resumen de gastos"
```

**Implementación:**
1. Definir la instrucción completa que el agente debe ejecutar.
2. Crear con `schedule_task` + cron expression.
3. La instrucción debe ser auto-contenida (el agente la ejecutará sin contexto).

### 2. Basada en eventos
Acciones que se disparan cuando algo ocurre:
```
Ejemplos:
- "Cuando reciba un email de [remitente], avísame por Telegram"
- "Si un sensor de Home Assistant cambia, registra en nota"
- "Cuando se complete una descarga en Radarr/Sonarr, notifícame"
```

**Implementación:**
1. Usar `subscribe_to_event` con tipo de evento y condiciones.
2. Definir instrucción de respuesta.
3. Especificar filtros para evitar falsos positivos.

### 3. Cadenas de acciones (Multi-step)
Combinar múltiples herramientas en secuencia:
```
Ejemplos:
- "Busca noticias de X → si hay algo importante → envía resumen por Telegram → guarda en nota"
- "Lee emails nuevos → filtra los de [cliente] → resume contenido → crea tarea de seguimiento"
- "Comprueba agenda de mañana → identifica huecos → sugiere tareas pendientes para llenarlos"
```

**Implementación:**
1. Descomponer en pasos individuales.
2. Crear instrucción para `schedule_task` que incluya toda la cadena.
3. Cada paso usa herramientas nativas del agente.

## Formato de definición
```
⚙️ **Workflow: [Nombre]**

🔄 Trigger: [cron/evento/condición]
📋 Pasos:
  1. [Acción 1] → herramienta: [tool_name]
  2. [Acción 2] → herramienta: [tool_name]
  3. [Acción 3] → herramienta: [tool_name]
🎯 Resultado: [qué se espera lograr]
⏱️ Frecuencia: [cada cuánto se ejecuta]
```

## Patrones comunes de automatización

### Morning briefing
```
Trigger: schedule (8:00 L-V)
Pasos:
  1. list_calendar_events (hoy)
  2. get_unread_email_count
  3. list_scheduled_tasks (pendientes)
  4. web_search (noticias del sector)
  5. send_telegram_message (resumen compilado)
```

### Guardián del hogar
```
Trigger: evento HA (binary_sensor cambio)
Pasos:
  1. Evaluar si el cambio es relevante
  2. Si es alarma/puerta en horario nocturno → alerta urgente
  3. send_telegram_message (con detalles)
```

### Resumen semanal
```
Trigger: schedule (viernes 18:00)
Pasos:
  1. get_notes (gastos de la semana)
  2. list_calendar_events (semana pasada)
  3. Compilar resumen
  4. send_telegram_message (informe semanal)
  5. create_note (archivo del resumen)
```

## Reglas
- Confirmar SIEMPRE con el usuario antes de crear automatizaciones.
- Las instrucciones del schedule_task deben ser claras y auto-contenidas.
- Evitar automatizaciones que puedan generar spam de notificaciones.
- Incluir condiciones de filtrado para reducir falsos positivos.
- Permitir al usuario desactivar fácilmente cualquier automatización.
- Documentar cada workflow creado en una nota para referencia.
