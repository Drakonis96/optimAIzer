---
id: copywriting-content
name: "Copywriting y Contenido"
description: "Redaccion de posts, emails, landing copy, anuncios y variaciones de tono con revision iterativa"
name_en: "Copywriting & Content"
description_en: "Writing posts, emails, landing page copy, ads and tone variations with iterative review"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 58
tags: ["copywriting", "contenido", "marketing", "posts", "redaccion"]
tags_en: ["copywriting", "content", "marketing", "posts", "writing"]
category: "knowledge"
triggers:
  events:
    - "keyword:copy"
    - "keyword:redacta"
    - "keyword:escribe un post"
    - "keyword:landing"
    - "keyword:anuncio"
  conditions: "Cuando el usuario quiera redactar piezas de contenido o marketing"
requires_tools:
  - create_note
  - update_note
  - search_notes
  - web_search
  - fetch_webpage
---

# Copywriting y Contenido

## Objetivo
Redactar piezas claras, persuasivas y adaptadas al canal, manteniendo coherencia de tono, CTA y objetivo.

## Flujo recomendado
1. Aclara objetivo, audiencia, canal y CTA.
2. Si hay contexto de marca o producto, resumelo antes de escribir.
3. Produce una primera version y, si ayuda, 2-3 variantes de tono.
4. Si el usuario quiere iterar, cambia solo lo necesario: gancho, CTA, estructura o longitud.

## Casos de uso
- Posts de LinkedIn o X
- Emails comerciales o de nurtuting
- Hero copy y landing pages
- Anuncios cortos y claims

## Reglas
- No uses tono grandilocuente si el usuario pide algo directo.
- Si faltan datos clave de producto o audiencia, pregunta antes de generar una pieza larga.
- Cuando guardes una version, usa notas para no perder el historial de iteraciones.

<!-- lang:en -->

# Copywriting & Content — Protocol

## Objective
Write clear, persuasive pieces adapted to the channel, maintaining tone consistency, CTA and objective.

## Recommended flow
1. Clarify objective, audience, channel and CTA.
2. If there's brand or product context, summarize it before writing.
3. Produce a first version and, if helpful, 2-3 tone variations.
4. If the user wants to iterate, change only what's needed: hook, CTA, structure or length.

## Use cases
- LinkedIn or X posts
- Commercial or nurturing emails
- Hero copy and landing pages
- Short ads and claims

## Rules
- Don't use grandiose tone if the user asks for something direct.
- If key product or audience data is missing, ask before generating a long piece.
- When saving a version, use notes to keep the iteration history.
