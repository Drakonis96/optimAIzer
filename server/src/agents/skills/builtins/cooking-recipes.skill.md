---
id: cooking-recipes
name: "Cocina y Recetas"
description: "Buscar recetas, planificar menús semanales, generar listas de compra y guiar paso a paso al cocinar"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 50
tags: ["cocina", "recetas", "comida", "menú", "ingredientes", "lista de compra"]
category: "lifestyle"
triggers:
  events:
    - "keyword:receta"
    - "keyword:cocinar"
    - "keyword:cocina"
    - "keyword:cena"
    - "keyword:almuerzo"
    - "keyword:desayuno"
    - "keyword:menú semanal"
    - "keyword:menu semanal"
    - "keyword:qué puedo hacer con"
    - "keyword:que puedo hacer con"
  conditions: "Cuando el usuario quiera cocinar o planificar comidas"
requires_tools:
  - web_search
  - fetch_webpage
  - create_note
  - create_list
  - set_reminder
---

# Cocina y Recetas — Protocolo

## Búsqueda de recetas

### "¿Qué puedo hacer con [ingredientes]?"
1. Busca recetas con esos ingredientes: `web_search` → "receta con [ingredientes]".
2. Presenta 3-5 opciones: nombre, tiempo, dificultad, ingredientes extra necesarios.
3. El usuario selecciona y muestras la receta completa.

### "Dame una receta de [plato]"
1. Busca la receta: `web_search` → "receta [plato]".
2. Si hay variantes regionales, pregunta preferencia.
3. Presenta receta completa con formato estándar (ver abajo).

### Formato de receta
```
🍳 **[Nombre del plato]**

⏱️ Tiempo: [preparación] + [cocción] = [total]
👥 Raciones: [número]
📊 Dificultad: [Fácil/Media/Difícil]

📝 **Ingredientes:**
- [cantidad] [ingrediente]
- [cantidad] [ingrediente]
...

👨‍🍳 **Preparación:**
1. [Paso 1]
2. [Paso 2]
...

💡 **Tips:**
- [consejo útil]
```

## Menú semanal

### Generación de menú
1. Preguntar: preferencias, restricciones (vegetariano, sin gluten, etc.), presupuesto, personas.
2. Generar menú de 7 días con: almuerzo + cena (opcionalmente desayuno).
3. Intentar reutilizar ingredientes entre recetas para minimizar desperdicio.

### Formato menú semanal
```
📋 **Menú semanal — [Semana]**

🟢 Lunes
  🍽️ Almuerzo: [plato] (30 min)
  🍽️ Cena: [plato] (20 min)

🟢 Martes
  🍽️ Almuerzo: [plato]
  🍽️ Cena: [plato]
...
```

### Lista de compra automática
1. Después de aprobar el menú, generar lista de compra consolidada.
2. Agrupar por sección del supermercado: frutas/verduras, carnes, lácteos, despensa.
3. Crear como lista con `create_list`.

```
🛒 **Lista de compra — Semana del [fecha]**

🥬 Frutas y verduras:
⬜ Tomates (1 kg)
⬜ Cebollas (500g)
...

🥩 Carnes y pescados:
⬜ Pechuga de pollo (600g)
...

🧀 Lácteos:
⬜ Leche (1L)
...

🏪 Despensa:
⬜ Arroz (500g)
...
```

## Si el usuario envía foto de comida/ingredientes
- Usar visión IA para identificar ingredientes o platos.
- Sugerir recetas basadas en lo identificado o evaluar el plato.

## Reglas
- Respetar restricciones alimentarias del usuario (alergias, dieta).
- Incluir tiempos reales de preparación.
- Para recetas complejas, ofrecer versiones simplificadas.
- Indicar alternativas para ingredientes difíciles de encontrar.
- Guardar recetas favoritas como notas si el usuario lo pide.
