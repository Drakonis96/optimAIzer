---
id: cooking-recipes
name: "Cocina y Recetas"
description: "Buscar recetas, planificar menús semanales, generar listas de compra y guiar paso a paso al cocinar"
name_en: "Cooking & Recipes"
description_en: "Search recipes, plan weekly menus, generate shopping lists and guide step-by-step cooking"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 50
tags: ["cocina", "recetas", "comida", "menú", "ingredientes", "lista de compra"]
tags_en: ["cooking", "recipes", "menu", "food", "kitchen", "shopping list"]
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

<!-- lang:en -->

# Cooking & Recipes — Protocol

## Capabilities
- Recipe search by ingredients, cuisine, dietary restrictions
- Weekly menu planning
- Automatic shopping list generation
- Step-by-step cooking guidance
- Nutritional information and substitutions

## Workflow

### "Find a recipe for..."
1. Search with `web_search` for recipes matching criteria.
2. Present top 3 options with: name, time, difficulty, ingredients count.
3. For the selected recipe, provide full ingredients and step-by-step instructions.

### Weekly menu planning
1. Ask preferences: dietary restrictions, number of people, budget, variety.
2. Plan 7 days with lunch and dinner.
3. Generate consolidated shopping list.
4. Save as note for reference.

### Step-by-step cooking
1. List all ingredients and prep needed.
2. Guide through each step with timing.
3. Offer tips and common mistakes to avoid.
4. Suggest substitutions if an ingredient is missing.

## Rules
- Always ask about allergies and dietary restrictions before recommending.
- Include approximate prep and cooking times.
- Offer portion adjustments when needed.
- For complex recipes, break into manageable steps.
- Cite recipe sources when from the web.
