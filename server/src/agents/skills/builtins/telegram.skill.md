---
id: telegram
name: "Telegram"
description: "Comunicación proactiva por Telegram: enviar mensajes, botones interactivos y gestión de archivos multimedia"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 85
tags: ["telegram", "mensajería", "comunicación", "bot", "notificaciones"]
category: "integration"
triggers:
  events:
    - "keyword:telegram"
    - "keyword:enviar mensaje"
    - "keyword:notifica"
    - "keyword:avisa"
    - "keyword:manda"
  conditions: "Cuando se necesite comunicación por Telegram"
requires_tools:
  - send_telegram_message
  - send_telegram_buttons
---

# Telegram — Protocolo de Comunicación

## Herramientas disponibles
- `send_telegram_message` — Enviar mensaje de texto al usuario (soporta Markdown)
- `send_telegram_buttons` — Enviar mensaje con botones de respuesta rápida (inline keyboard)

## Capacidades de entrada (automáticas)
- **Texto**: Mensajes normales procesados como input del usuario.
- **Fotos**: Procesadas automáticamente con visión IA (`analyze_telegram_image`).
- **Audio/Voz**: Transcritos automáticamente con Whisper (`transcribe_telegram_audio`).
- **Documentos**: Leídos y procesados según tipo (PDF, texto, etc.).
- **Ubicación**: Coordenadas GPS recibidas y disponibles.
- **Mensajes reenviados**: Contexto del mensaje original preservado.

## Mensajes proactivos
Puedes enviar mensajes al usuario sin que haya preguntado, útil para:
- ✅ Confirmaciones de tareas completadas
- 🔔 Alertas programadas (recordatorios, monitores)
- 📊 Resúmenes periódicos
- ⚠️ Notificaciones urgentes (sensores, alarmas, etc.)

## Botones interactivos
Usa `send_telegram_buttons` para ofrecer opciones rápidas:
```
Opciones de ejemplo:
[✅ Confirmar] [❌ Cancelar]
[📅 Ver agenda] [📧 Leer correos] [🏠 Estado casa]
```
- Cada botón tiene un `callback_data` que se envía como respuesta.
- Los botones tienen TTL limitado — no depender de botones antiguos.
- Máximo recomendado: 6-8 botones para usabilidad.

## Formato de mensajes
- Usa Markdown v2 de Telegram: **negrita**, _cursiva_, `código`, ```bloques```.
- Emojis para claridad visual (sin exceso).
- Mensajes largos: divide en párrafos con doble salto de línea.
- Para listas: usa guiones o emojis como viñetas.

## Reglas
- No envíes mensajes innecesarios — respeta la atención del usuario.
- Para tareas en background, envía un solo resumen al completar (no paso a paso).
- Si responder por chat o por Telegram, el trato es idéntico. No hagas distinciones.
- Los archivos multimedia se procesan automáticamente — no pidas al usuario que los reenvíe.
