---
id: home-assistant
name: "Home Assistant"
description: "Control domótico completo: luces, climatización, sensores, interruptores y automatizaciones via Home Assistant"
name_en: "Home Assistant"
description_en: "Complete home automation control: lights, climate, switches, sensors, blinds, alarms and media via Home Assistant"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 80
tags: ["domótica", "smart-home", "home-assistant", "iot", "luces", "clima"]
tags_en: ["home automation", "iot", "smart home", "lights", "sensors", "home assistant"]
category: "integration"
triggers:
  events:
    - "keyword:luz"
    - "keyword:luces"
    - "keyword:apaga"
    - "keyword:enciende"
    - "keyword:temperatura"
    - "keyword:termostato"
    - "keyword:clima"
    - "keyword:sensor"
    - "keyword:casa"
    - "keyword:domótica"
    - "keyword:home assistant"
    - "keyword:persiana"
    - "keyword:cortina"
    - "keyword:alarma"
  conditions: "Cuando el usuario quiera controlar dispositivos del hogar"
requires_tools:
  - ha_search_entities
  - ha_turn_on
  - ha_turn_off
  - ha_dict_entities
  - ha_call_service
---

# Home Assistant — Protocolo de Control Domótico

## Herramientas disponibles
- `ha_search_entities` — Buscar entidades por nombre, dominio o área (luces, sensores, switches, etc.)
- `ha_turn_on` — Encender una entidad (luz, interruptor, enchufe, etc.)
- `ha_turn_off` — Apagar una entidad
- `ha_dict_entities` — Listar todas las entidades de un dominio (light, switch, climate, sensor, etc.)
- `ha_call_service` — Llamar a cualquier servicio HA con parámetros personalizados

## Dominios principales

### 💡 Luces (`light`)
- **Encender**: `ha_turn_on` con entity_id (ej: `light.salon`)
- **Apagar**: `ha_turn_off`
- **Brillo**: `ha_call_service` → `light.turn_on` con `{ brightness: 0-255 }` o `{ brightness_pct: 0-100 }`
- **Color**: `ha_call_service` → `light.turn_on` con `{ rgb_color: [R, G, B] }` o `{ color_temp: 153-500 }`
- **Transición**: Incluir `{ transition: segundos }` para cambio gradual.

### 🌡️ Climatización (`climate`)
- **Temperatura**: `ha_call_service` → `climate.set_temperature` con `{ temperature: X }`
- **Modo**: `ha_call_service` → `climate.set_hvac_mode` con `{ hvac_mode: "heat"|"cool"|"auto"|"off" }`
- **Preset**: `ha_call_service` → `climate.set_preset_mode` con `{ preset_mode: "away"|"home"|"eco" }`

### 🔌 Interruptores (`switch`)
- Encender/apagar con `ha_turn_on` / `ha_turn_off`.
- Incluye enchufes inteligentes, electrodomésticos, etc.

### 📊 Sensores (`sensor`, `binary_sensor`)
- Solo lectura — usa `ha_search_entities` para ver estado actual.
- Tipos comunes: temperatura, humedad, movimiento, puertas/ventanas, batería.

### 🪟 Persianas/Cortinas (`cover`)
- **Abrir**: `ha_call_service` → `cover.open_cover`
- **Cerrar**: `ha_call_service` → `cover.close_cover`
- **Posición**: `ha_call_service` → `cover.set_cover_position` con `{ position: 0-100 }`

### 🔒 Alarma (`alarm_control_panel`)
- **Armar**: `ha_call_service` → `alarm_control_panel.alarm_arm_away` o `alarm_arm_home`
- **Desarmar**: `ha_call_service` → `alarm_control_panel.alarm_disarm` (requiere PIN si configurado)

### 🎵 Media (`media_player`)
- **Reproducir/Pausar/Parar**: `media_player.media_play`, `.media_pause`, `.media_stop`
- **Volumen**: `media_player.volume_set` con `{ volume_level: 0.0-1.0 }`
- **Reproducir contenido**: `media_player.play_media` con URL o media_content_id

## Flujo de trabajo

### Comando directo ("Enciende la luz del salón")
1. Usa `ha_search_entities` para encontrar la entidad exacta.
2. Si hay una sola coincidencia, ejecuta directamente.
3. Si hay múltiples, muestra opciones y pide selección.
4. Confirma la acción realizada.

### Consulta de estado ("¿Qué temperatura hay?")
1. Busca sensores relevantes con `ha_search_entities`.
2. Muestra valores actuales de forma clara.

### Escenario complejo ("Modo película")
1. Identifica las acciones necesarias (ej: bajar luces, cerrar persianas, encender TV).
2. Ejecuta cada acción en secuencia.
3. Confirma cada paso completado.

## Eventos en tiempo real (WebSocket)
- Si el WebSocket está activo, recibirás notificaciones automáticas de cambios de estado.
- Úsalos para informar al usuario de cambios inesperados (ej: alarma activada, puerta abierta).
- Los eventos se debouncean (2.5s por defecto) para evitar spam.

## Reglas estrictas
- NUNCA afirmes haber ejecutado una acción sin llamar la herramienta correspondiente.
- Para acciones de seguridad (alarma, cerraduras), SIEMPRE pide confirmación explícita.
- Si una entidad no se encuentra, sugiere alternativas cercanas.
- Muestra entity_id en las confirmaciones para que el usuario verifique.
- Si el servicio falla, explica el error y ofrece alternativas.

<!-- lang:en -->

# Home Assistant — Home Automation Control Protocol

## Available tools
- `ha_search_entities` — Search entities by name, domain or area (lights, sensors, switches, etc.)
- `ha_turn_on` — Turn on an entity (light, switch, plug, etc.)
- `ha_turn_off` — Turn off an entity
- `ha_dict_entities` — List all entities of a domain (light, switch, climate, sensor, etc.)
- `ha_call_service` — Call any HA service with custom parameters

## Main domains

### 💡 Lights (`light`)
- **Turn on**: `ha_turn_on` with entity_id (e.g., `light.living_room`)
- **Turn off**: `ha_turn_off`
- **Brightness**: `ha_call_service` → `light.turn_on` with `{ brightness: 0-255 }` or `{ brightness_pct: 0-100 }`
- **Color**: `ha_call_service` → `light.turn_on` with `{ rgb_color: [R, G, B] }` or `{ color_temp: 153-500 }`
- **Transition**: Include `{ transition: seconds }` for gradual change.

### 🌡️ Climate (`climate`)
- **Temperature**: `ha_call_service` → `climate.set_temperature` with `{ temperature: X }`
- **Mode**: `ha_call_service` → `climate.set_hvac_mode` with `{ hvac_mode: "heat"|"cool"|"auto"|"off" }`
- **Preset**: `ha_call_service` → `climate.set_preset_mode` with `{ preset_mode: "away"|"home"|"eco" }`

### 🔌 Switches (`switch`)
- Turn on/off with `ha_turn_on` / `ha_turn_off`.
- Includes smart plugs, appliances, etc.

### 📊 Sensors (`sensor`, `binary_sensor`)
- Read-only — use `ha_search_entities` to see current state.
- Common types: temperature, humidity, motion, doors/windows, battery.

### 🪟 Blinds/Covers (`cover`)
- **Open**: `ha_call_service` → `cover.open_cover`
- **Close**: `ha_call_service` → `cover.close_cover`
- **Position**: `ha_call_service` → `cover.set_cover_position` with `{ position: 0-100 }`

### 🔒 Alarm (`alarm_control_panel`)
- **Arm**: `ha_call_service` → `alarm_control_panel.alarm_arm_away` or `alarm_arm_home`
- **Disarm**: `ha_call_service` → `alarm_control_panel.alarm_disarm` (requires PIN if configured)

### 🎵 Media (`media_player`)
- **Play/Pause/Stop**: `media_player.media_play`, `.media_pause`, `.media_stop`
- **Volume**: `media_player.volume_set` with `{ volume_level: 0.0-1.0 }`
- **Play content**: `media_player.play_media` with URL or media_content_id

## Workflow

### Direct command ("Turn on the living room light")
1. Use `ha_search_entities` to find the exact entity.
2. If there's a single match, execute directly.
3. If there are multiple, show options and ask for selection.
4. Confirm the action performed.

### Status query ("What's the temperature?")
1. Search for relevant sensors with `ha_search_entities`.
2. Show current values clearly.

### Complex scenario ("Movie mode")
1. Identify necessary actions (e.g., dim lights, close blinds, turn on TV).
2. Execute each action in sequence.
3. Confirm each completed step.

## Real-time events (WebSocket)
- If WebSocket is active, you'll receive automatic state change notifications.
- Use them to inform the user of unexpected changes (e.g., alarm triggered, door opened).
- Events are debounced (2.5s by default) to avoid spam.

## Strict rules
- NEVER claim to have executed an action without calling the corresponding tool.
- For security actions (alarm, locks), ALWAYS ask for explicit confirmation.
- If an entity is not found, suggest close alternatives.
- Show entity_id in confirmations so the user can verify.
- If the service fails, explain the error and offer alternatives.
