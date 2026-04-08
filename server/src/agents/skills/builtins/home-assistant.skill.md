---
id: home-assistant
name: "Home Assistant"
description: "Control domótico completo: luces, climatización, sensores, interruptores y automatizaciones via Home Assistant"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 80
tags: ["domótica", "smart-home", "home-assistant", "iot", "luces", "clima"]
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
