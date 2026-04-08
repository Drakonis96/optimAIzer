---
id: transcription
name: "Transcripción de Audio (Whisper)"
description: "Transcripción automática de notas de voz, audios y archivos de audio usando Whisper"
name_en: "Audio Transcription (Whisper)"
description_en: "Automatic transcription of voice notes, audio and audio files using Whisper"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["audio", "transcripción", "whisper", "voz", "speech-to-text"]
tags_en: ["audio", "transcription", "whisper", "voice", "speech-to-text"]
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

<!-- lang:en -->

# Audio Transcription — Whisper Protocol

## Available tool
- `transcribe_telegram_audio` — Transcribes audio using Whisper provider chain.

## Provider chain (automatic fallback)
1. **Groq Whisper** (priority: fast and free)
2. **OpenAI Whisper** (high accuracy)
3. **Local Whisper** (offline fallback)

## Supported formats
MP3, WAV, M4A, OGG, WebM

## Automatic behavior
- Audio and voice notes received via Telegram are transcribed **automatically**.
- The transcription is included in the user's message as context.
- The user does not need to explicitly request transcription.

## Post-transcription workflow
Once audio is transcribed, the agent should:
1. **Respond to the content** of the audio as if it were text (without repeating the full transcription).
2. If the user requests, it can:
   - Save as a note (`create_note`)
   - Create a summary
   - Extract mentioned tasks or reminders
   - Translate the content

## Re-processing
- If automatic transcription failed or was low quality, use `transcribe_telegram_audio` manually.
- Language is detected automatically.

## Rules
- Do not repeat the full transcription unless the user asks for it.
- If audio quality is low, indicate it and offer the best possible interpretation.
- For long audio (>5 min), offer a summary in addition to the transcription.
- Treat audio content as private information.
