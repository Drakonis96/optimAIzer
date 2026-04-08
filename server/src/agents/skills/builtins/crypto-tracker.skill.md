---
id: crypto-tracker
name: "Crypto Tracker"
description: "Seguimiento de precios, cartera, alertas y resumen de mercado para criptoactivos"
name_en: "Crypto Tracker"
description_en: "Price tracking, portfolio, alerts and market summary for crypto assets"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 57
tags: ["crypto", "bitcoin", "ethereum", "precios", "mercado"]
tags_en: ["crypto", "bitcoin", "ethereum", "prices", "market"]
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

<!-- lang:en -->

# Crypto Tracker — Protocol

## Objective
Help track crypto assets, record reference prices and prepare alerts or market summaries with real sources.

## Recommended flow
1. Identify the exact asset, reference currency and time horizon.
2. Use `web_search` and `fetch_webpage` to get recent data and cite the source.
3. If the user wants tracking, save a note with context and reference price.
4. If the user wants to review later, create a reminder.

## Useful format
- Asset
- Current price and source
- Daily or weekly change if verified
- Levels to watch
- Suggested next review

## Rules
- Don't give financial advice as if it were professional recommendation.
- Don't state percentages or prices without source and date.
- If the user mixes ambiguous tickers or different networks, clarify before responding.
