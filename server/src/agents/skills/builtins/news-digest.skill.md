---
id: news-digest
name: "Resumen de Noticias"
description: "Búsqueda y resumen de noticias actuales por tema, región o interés personal con análisis y contexto"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 55
tags: ["noticias", "actualidad", "resumen", "news", "digest"]
category: "knowledge"
triggers:
  events:
    - "keyword:noticias"
    - "keyword:actualidad"
    - "keyword:qué ha pasado"
    - "keyword:que ha pasado"
    - "keyword:news"
    - "keyword:novedades"
    - "keyword:último de"
    - "keyword:ultimo de"
  conditions: "Cuando el usuario pida noticias o actualidad"
requires_tools:
  - web_search
  - fetch_webpage
  - create_note
  - send_telegram_message
  - schedule_task
---

# Resumen de Noticias — Protocolo

## Búsqueda de noticias por demanda

### "¿Qué ha pasado hoy?" / "Noticias de [tema]"
1. Realizar 3-4 búsquedas web con queries variadas:
   - Búsqueda general: "noticias hoy [tema]"
   - Fuentes específicas: "site:elpais.com [tema]" o "site:bbc.com [tema]"
   - Perspectiva internacional: misma búsqueda en inglés
2. Leer las 3-5 fuentes más relevantes con `fetch_webpage`.
3. Sintetizar con el formato de digest.

### Formato de resumen
```
📰 **Noticias — [Tema/Fecha]**

### 🔴 Principal
**[Titular]**
[Resumen en 2-3 líneas con contexto]
📎 [Fuente y URL]

### 📌 Destacadas
1. **[Titular]** — [Resumen en 1-2 líneas] (📎 [Fuente])
2. **[Titular]** — [Resumen] (📎 [Fuente])
3. **[Titular]** — [Resumen] (📎 [Fuente])

### 💡 Análisis rápido
[2-3 líneas de contexto: por qué importa, qué puede pasar, conexiones entre noticias]

📅 Última actualización: [hora]
```

## Digest automático (programado)
Si el usuario quiere recibir noticias periódicamente:
1. Configurar con `schedule_task`:
   - Frecuencia: diaria/semanal
   - Hora preferida (ej: "todos los días a las 8:00")
   - Temas de interés (ej: tecnología, finanzas, deportes)
2. En cada activación:
   - Buscar noticias de los temas configurados
   - Generar digest compacto
   - Enviar por Telegram con `send_telegram_message`

## Seguimiento de temas
- El usuario puede pedir seguir un tema específico (ej: "avísame de novedades sobre IA").
- Programar comprobación periódica.
- Solo notificar si hay noticias nuevas relevantes (no repetir lo ya informado).

## Reglas
- SIEMPRE citar fuentes con URLs.
- Distinguir entre hechos reportados y opiniones.
- Si hay versiones contradictorias, presentar ambas.
- No tomar partido político — presentar de forma neutral.
- Indicar la fecha de las noticias (evitar presentar noticias antiguas como nuevas).
- Para temas sensibles, usar lenguaje cuidadoso y factual.
