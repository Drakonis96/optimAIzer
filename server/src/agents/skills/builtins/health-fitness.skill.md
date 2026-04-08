---
id: health-fitness
name: "Salud y Fitness"
description: "Seguimiento de ejercicio, nutrición, métricas de salud y planificación de entrenamientos"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 55
tags: ["salud", "fitness", "ejercicio", "nutrición", "peso", "entrenamiento"]
category: "lifestyle"
triggers:
  events:
    - "keyword:ejercicio"
    - "keyword:entrenamiento"
    - "keyword:gym"
    - "keyword:dieta"
    - "keyword:calorías"
    - "keyword:calorias"
    - "keyword:peso"
    - "keyword:correr"
    - "keyword:workout"
    - "keyword:nutrición"
    - "keyword:nutricion"
  conditions: "Cuando el usuario quiera gestionar salud o fitness"
requires_tools:
  - create_note
  - get_notes
  - update_note
  - create_list
  - set_reminder
  - schedule_task
  - web_search
---

# Salud y Fitness — Protocolo

## Seguimiento de ejercicio

### Registro de entrenamiento
El usuario puede decir: "Hoy hice 30 min de cardio" o "Entrené pecho y bíceps".

Formato de registro (nota mensual "Ejercicio [Mes] [Año]"):
```
| Fecha | Tipo | Duración | Detalle | Notas |
|-------|------|----------|---------|-------|
| 15/01 | 🏃 Cardio | 30 min | Correr 5km | Ritmo 6:00/km |
| 16/01 | 💪 Fuerza | 45 min | Pecho + bíceps | Press 60kg x8 |
```

### Plan de entrenamiento
1. Pregunta: objetivo (fuerza, cardio, flexibilidad, pérdida de peso), nivel, disponibilidad semanal.
2. Genera plan semanal personalizado.
3. Crea lista de seguimiento para la semana.
4. Programa recordatorios con `schedule_task`.

### Ejemplo plan semanal
```
🏋️ **Plan semana del 15/01**

Lunes — 💪 Tren superior (45 min)
- Press banca 4x8
- Remo 4x10
- Militar 3x10
- Curl bíceps 3x12

Martes — 🏃 Cardio (30 min)
- Intervalos: 1 min rápido / 1 min suave

Miércoles — 🧘 Descanso activo
- Estiramientos 20 min

Jueves — 💪 Tren inferior (45 min)
- Sentadilla 4x8
- Peso muerto 4x6
- Extensiones 3x12
- Curl femoral 3x12

Viernes — 🏃 Cardio + Core (40 min)
Sábado — 💪 Full body (40 min)
Domingo — 😴 Descanso total
```

## Nutrición

### Registro de comidas
- Estimación de calorías y macros basada en descripción del usuario.
- Web search para datos nutricionales si es necesario.
- Formato: nota "Nutrición [Fecha]" con tabla.

### Si el usuario envía foto de comida
- Usar visión IA para identificar platos.
- Estimar calorías y composición.
- Registrar automáticamente.

## Métricas de salud
- Peso: registro periódico con tendencia.
- Medidas corporales.
- Horas de sueño.
- Pasos diarios.
- Ingesta de agua.

## Reglas
- SIEMPRE incluir disclaimer: "Consulta con un profesional de salud para planes personalizados."
- No dar consejos médicos específicos — solo seguimiento y planificación general.
- Ser motivador pero realista con los objetivos.
- No juzgar el rendimiento del usuario.
- Sugerir descanso si hay entrenamiento excesivo registrado.
- Adaptar el plan al nivel declarado por el usuario.
