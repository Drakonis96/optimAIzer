---
id: personal-memory
name: "Memoria Personal Inteligente"
description: "Gestión avanzada de memoria del agente: recordar preferencias, patrones, contexto personal y conocimiento acumulado"
name_en: "Smart Personal Memory"
description_en: "Advanced agent memory management: remember preferences, patterns, personal context and accumulated knowledge"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 90
tags: ["memoria", "preferencias", "contexto", "personalización", "conocimiento"]
tags_en: ["memory", "preferences", "context", "personalization", "knowledge"]
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

<!-- lang:en -->

# Smart Personal Memory — Protocol

## Multi-level memory system

### Level 1: Immediate memory (Working Memory)
- For ongoing tasks with intermediate steps.
- Use `update_working_memory` to save state of multi-step tasks.
- Cleared when task is completed.

### Level 2: Agent memory (remember)
- For data that must persist between conversations.
- Use `remember` to store key facts about the user.
- Limit: 24 items, 140 chars each — be concise.

### Level 3: Structured notes
- For extensive or organized information.
- Use `create_note` for detailed knowledge.
- Special note: "User Profile" with accumulated preferences.

## What to remember automatically

### User preferences (save with `remember`)
- Name and basic info if shared.
- Preferred communication language.
- Timezone if mentioned.
- Format preferences (brief vs detailed).
- Food: favorites, allergies, diet.
- Work: schedule, sector, tools used.

### Detected patterns
- If the user always asks for the same thing at a certain time → anticipate.
- If they correct a preference → update memory.
- If they mention recurring people's names → register context.

### Task context
- Ongoing projects and their status.
- Decisions made and why.
- Problems encountered and solutions.

## Workflow

### User says "Remember that..."
1. Extract the key data.
2. Decide the appropriate level:
   - Short and persistent data → `remember`
   - Extensive data → `create_note`
   - Temporary data for ongoing task → `update_working_memory`
3. Confirm what was saved.

### Memory retrieval
- Before acting, check `get_working_memory` for active task context.
- Agent memory and Smart RAG are automatically injected into the prompt.
- If you need to search for something specific, use `search_notes`.

## Rules
- NEVER store passwords, tokens or other secrets in memory.
- Prioritize information that improves the quality of future responses.
- Be concise in `remember` (maximum 140 chars per item).
- If memory is full, evaluate which items are least useful to rotate.
- Always confirm when saving something new.
- Do not save obvious or trivial information that adds no value.
