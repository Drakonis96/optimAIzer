---
id: copywriting-content
name: "Copywriting y Contenido"
description: "Redaccion de posts, emails, landing copy, anuncios y variaciones de tono con revision iterativa"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 58
tags: ["copywriting", "contenido", "marketing", "posts", "redaccion"]
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
