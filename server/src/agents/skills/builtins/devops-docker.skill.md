---
id: devops-docker
name: "DevOps y Docker"
description: "Diagnostico de servicios, contenedores, logs, procesos de deploy y comandos operativos seguros"
name_en: "DevOps & Docker"
description_en: "Service diagnostics, containers, logs, deploy processes and safe operational commands"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 61
tags: ["devops", "docker", "compose", "deploy", "logs"]
tags_en: ["devops", "docker", "compose", "deploy", "logs"]
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

<!-- lang:en -->

# DevOps & Docker — Protocol

## Objective
Help with diagnosing and operating services, prioritizing safe inspection, clear explanation and minimal changes.

## Work order
1. Start with read-only commands: status, logs, configuration, ports, health.
2. Explain what command you want to run and why before calling it.
3. Summarize observations before proposing changes.
4. For impactful actions, ask for explicit confirmation.

## Typical commands
- `docker ps`, `docker compose ps`
- `docker logs`, `docker compose logs`
- `docker inspect`
- `docker compose config`

## Rules
- Don't execute destructive actions or restarts without a clear reason and confirmation.
- If you can isolate the problem with a cheaper check, do it before touching the system.
- Use working memory to track hypotheses, tests and findings.
