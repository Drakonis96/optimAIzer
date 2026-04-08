---
id: personal-memory
name: "Memoria Personal Inteligente"
description: "Gestión avanzada de memoria del agente: recordar preferencias, patrones, contexto personal y conocimiento acumulado"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 90
tags: ["memoria", "preferencias", "contexto", "personalización", "conocimiento"]
category: "productivity"
triggers:
  events:
    - "keyword:recuerda"
    - "keyword:no olvides"
    - "keyword:preferencia"
    - "keyword:siempre que"
    - "keyword:me gusta"
    - "keyword:no me gusta"
    - "keyword:ten en cuenta"
  conditions: "Cuando el usuario comparta información personal o preferencias para recordar"
requires_tools:
  - remember
  - get_working_memory
  - update_working_memory
  - create_note
  - get_notes
  - search_notes
---

# Memoria Personal Inteligente — Protocolo

## Sistema de memoria multinivel

### Nivel 1: Memoria inmediata (Working Memory)
- Para tareas en curso con pasos intermedios.
- Usa `update_working_memory` para guardar estado de tareas multi-paso.
- Se limpia al completar la tarea.

### Nivel 2: Memoria del agente (remember)
- Para datos que deben persistir entre conversaciones.
- Usa `remember` para guardar hechos clave del usuario.
- Límite: 24 items, 140 chars cada uno — ser conciso.

### Nivel 3: Notas estructuradas
- Para información extensa o organizada.
- Usa `create_note` para conocimiento detallado.
- Nota especial: "Perfil del usuario" con preferencias acumuladas.

## Qué recordar automáticamente

### Preferencias del usuario (guardar con `remember`)
- Nombre y datos básicos si los comparte.
- Idioma preferido para comunicación.
- Zona horaria si la menciona.
- Preferencias de formato (breve vs detallado).
- Comida: favoritos, alergias, dieta.
- Trabajo: horario, sector, herramientas que usa.

### Patrones detectados
- Si el usuario siempre pide lo mismo a cierta hora → anticipar.
- Si corrige una preferencia → actualizar memoria.
- Si menciona nombres de personas recurrentes → registrar contexto.

### Contexto de tareas
- Proyectos en curso y su estado.
- Decisiones tomadas y por qué.
- Problemas encontrados y soluciones.

## Flujo de trabajo

### El usuario dice "Recuerda que..."
1. Extraer el dato clave.
2. Decidir el nivel apropiado:
   - Dato corto y persistente → `remember`
   - Dato extenso → `create_note`
   - Dato temporal para tarea en curso → `update_working_memory`
3. Confirmar qué se guardó.

### Recuperación de memoria
- Antes de actuar, consultar `get_working_memory` para contexto de tareas activas.
- La memoria del agente y Smart RAG se inyectan automáticamente en el prompt.
- Si necesitas buscar algo específico, usa `search_notes`.

### Nota "Perfil del usuario"
Mantener una nota especial actualizada con:
```
# Perfil del usuario

## Datos básicos
- Nombre: [X]
- Ubicación: [X]
- Zona horaria: [X]

## Preferencias
- Comida: [preferencias/restricciones]
- Comunicación: [breve/detallado]
- Horario: [madrugador/noctámbulo]

## Trabajo
- Sector: [X]
- Rol: [X]

## Notas adicionales
- [info relevante]
```

## Reglas
- NUNCA guardar contraseñas, tokens u otros secretos en la memoria.
- Priorizar información que mejore la calidad de las respuestas futuras.
- Ser conciso en `remember` (máximo 140 chars por item).
- Si la memoria está llena, evaluar qué items son menos útiles para rotar.
- Confirmar siempre cuando se guarda algo nuevo.
- No guardar información obvia o trivial que no aporte valor.
