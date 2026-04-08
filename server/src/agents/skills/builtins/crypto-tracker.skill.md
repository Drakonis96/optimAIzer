---
id: crypto-tracker
name: "Crypto Tracker"
description: "Seguimiento de precios, cartera, alertas y resumen de mercado para criptoactivos"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 57
tags: ["crypto", "bitcoin", "ethereum", "precios", "mercado"]
category: "finance"
triggers:
  events:
    - "keyword:crypto"
    - "keyword:bitcoin"
    - "keyword:ethereum"
    - "keyword:cartera"
    - "keyword:precio"
  conditions: "Cuando el usuario quiera seguir mercado cripto, cartera o alertas de precio"
requires_tools:
  - web_search
  - fetch_webpage
  - create_note
  - search_notes
  - update_note
  - set_reminder
---

# Crypto Tracker

## Objetivo
Ayudar a seguir activos cripto, registrar precios de referencia y preparar alertas o resumentes de mercado con fuentes reales.

## Flujo recomendado
1. Identifica el activo exacto, moneda de referencia y horizonte temporal.
2. Usa `web_search` y `fetch_webpage` para obtener datos recientes y cita la fuente.
3. Si el usuario quiere seguimiento, guarda una nota con el contexto y el precio de referencia.
4. Si el usuario quiere revisar mas tarde, crea un recordatorio.

## Formato util
- Activo
- Precio actual y fuente
- Cambio diario o semanal si se ha verificado
- Niveles a vigilar
- Proxima revision sugerida

## Reglas
- No des asesoramiento financiero como si fuera una recomendacion profesional.
- No afirmes porcentajes o precios sin fuente y fecha.
- Si el usuario mezcla ticker ambiguo o redes distintas, aclara antes de responder.
