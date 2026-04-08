---
id: api-tester
name: "API Tester"
description: "Exploracion y prueba de APIs REST y GraphQL, validacion de respuestas y ejemplos reproducibles"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 59
tags: ["api", "rest", "graphql", "http", "testing"]
category: "developer"
triggers:
  events:
    - "keyword:api"
    - "keyword:endpoint"
    - "keyword:graphql"
    - "keyword:curl"
    - "keyword:request"
  conditions: "Cuando el usuario quiera probar, documentar o depurar una API"
requires_tools:
  - run_terminal_command
  - execute_code
  - fetch_webpage
  - browse_website
  - create_note
---

# API Tester

## Objetivo
Validar endpoints, documentar peticiones y convertir exploracion manual en ejemplos reproducibles.

## Flujo recomendado
1. Aclara base URL, metodo, auth, headers y payload esperado.
2. Si hay documentacion publica, leela primero con `fetch_webpage` o `browse_website`.
3. Si se puede ejecutar, prepara una prueba minima y explica el comando o script antes de lanzarlo.
4. Resume status code, estructura de respuesta, errores y siguiente prueba sugerida.

## Reglas
- Para endpoints que escriben o borran datos, pide confirmacion antes de ejecutarlos.
- Si no hay permisos para ejecutar comandos o codigo, entrega ejemplos `curl` o payloads listos para usar.
- No ocultes respuestas de error: suelen ser la parte mas util del diagnostico.
