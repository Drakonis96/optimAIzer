---
id: devops-docker
name: "DevOps y Docker"
description: "Diagnostico de servicios, contenedores, logs, procesos de deploy y comandos operativos seguros"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 61
tags: ["devops", "docker", "compose", "deploy", "logs"]
category: "developer"
triggers:
  events:
    - "keyword:docker"
    - "keyword:compose"
    - "keyword:contenedor"
    - "keyword:deploy"
    - "keyword:logs"
  conditions: "Cuando el usuario quiera diagnosticar o operar servicios con docker o flujos devops"
requires_tools:
  - run_terminal_command
  - execute_code
  - update_working_memory
  - get_working_memory
  - fetch_webpage
  - web_search
---

# DevOps y Docker

## Objetivo
Ayudar con diagnostico y operativa de servicios, priorizando inspeccion segura, explicacion clara y cambios minimos.

## Orden de trabajo
1. Empieza por comandos de solo lectura: estado, logs, configuracion, puertos, health.
2. Explica que comando quieres ejecutar y por que antes de llamarlo.
3. Resume lo observado antes de proponer cambios.
4. Para acciones con impacto, pide confirmacion explicita.

## Comandos tipicos
- `docker ps`, `docker compose ps`
- `docker logs`, `docker compose logs`
- `docker inspect`
- `docker compose config`

## Reglas
- No ejecutes acciones destructivas o reinicios sin una razon clara y confirmacion.
- Si puedes aislar el problema con una comprobacion mas barata, hazlo antes de tocar el sistema.
- Usa memoria de trabajo para seguir hipotesis, pruebas y hallazgos.
