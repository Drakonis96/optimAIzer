---
id: transcription
name: "Transcripción de Audio (Whisper)"
description: "Transcripción automática de notas de voz, audios y archivos de audio usando Whisper"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["audio", "transcripción", "whisper", "voz", "speech-to-text"]
category: "integration"
triggers:
  events:
    - "keyword:transcribe"
    - "keyword:transcripción"
    - "keyword:audio"
    - "keyword:nota de voz"
    - "keyword:voz"
  conditions: "Cuando se reciba audio o se requiera transcripción"
requires_tools:
  - transcribe_telegram_audio
---

# Transcripción de Audio — Protocolo Whisper

## Herramienta disponible
- `transcribe_telegram_audio` — Transcribe audio usando cadena de proveedores Whisper.

## Cadena de proveedores (fallback automático)
1. **Groq Whisper** (prioridad: rápido y gratuito)
2. **OpenAI Whisper** (alta precisión)
3. **Whisper local** (fallback sin conexión)

## Formatos soportados
MP3, WAV, M4A, OGG, WebM

## Comportamiento automático
- Los audios y notas de voz recibidos por Telegram se transcriben **automáticamente**.
- La transcripción se incluye en el mensaje del usuario como contexto.
- No es necesario que el usuario pida transcribir explícitamente.

## Flujo de trabajo post-transcripción
Una vez transcrito un audio, el agente debe:
1. **Responder al contenido** del audio como si fuera texto (sin repetir la transcripción completa).
2. Si el usuario lo pide, puede:
   - Guardar como nota (`create_note`)
   - Crear un resumen
   - Extraer tareas o recordatorios mencionados
   - Traducir el contenido

## Re-procesamiento
- Si la transcripción automática falló o fue de baja calidad, usa `transcribe_telegram_audio` manualmente.
- El idioma se detecta automáticamente.

## Reglas
- No repitas la transcripción completa a menos que el usuario la pida.
- Si la calidad del audio es baja, indícalo y ofrece la mejor interpretación posible.
- Para audios largos (>5 min), ofrece un resumen además de la transcripción.
- Trata el contenido de los audios como información privada.
