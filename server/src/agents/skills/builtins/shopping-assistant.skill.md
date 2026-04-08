---
id: shopping-assistant
name: "Asistente de Compras"
description: "Comparación de productos, búsqueda de ofertas, análisis de reseñas y recomendaciones de compra"
name_en: "Shopping Assistant"
description_en: "Product comparison, deal hunting, review analysis and purchase recommendations"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 50
tags: ["compras", "shopping", "comparar", "ofertas", "productos", "reseñas"]
tags_en: ["shopping", "compare", "deals", "products", "reviews"]
category: "finance"
triggers:
  events:
    - "keyword:comprar"
    - "keyword:comparar"
    - "keyword:mejor"
    - "keyword:recomienda"
    - "keyword:recomendación"
    - "keyword:reviews"
    - "keyword:reseñas"
    - "keyword:oferta"
    - "keyword:barato"
  conditions: "Cuando el usuario quiera comprar algo o comparar productos"
requires_tools:
  - web_search
  - fetch_webpage
  - browse_website
  - create_note
---

# Asistente de Compras — Protocolo

## Flujos principales

### "Quiero comprar [producto]" / "¿Cuál es el mejor [producto]?"
1. Definir necesidades: presupuesto, uso, características imprescindibles.
2. Investigar con múltiples búsquedas:
   - "mejor [producto] [año]"
   - "comparativa [producto] [año]"
   - "[producto] reviews reddit"
   - Sitios especializados según categoría.
3. Consultar 3-4 fuentes de reviews/comparativas.
4. Presentar Top 3-5 opciones.

### Formato de comparación
```
🛍️ **Comparativa: [Categoría de producto]**

Presupuesto: [rango]
Uso principal: [descripción]

### 🥇 [Producto 1] — [Precio]
✅ Pros: [lista]
❌ Contras: [lista]
⭐ Valoración: [X/5] ([fuente])
🔗 [Link]

### 🥈 [Producto 2] — [Precio]
✅ Pros: [lista]
❌ Contras: [lista]
⭐ Valoración: [X/5] ([fuente])
🔗 [Link]

### 🥉 [Producto 3] — [Precio]
...

### 💡 Recomendación
- **Mejor calidad-precio**: [Producto X]
- **Mejor premium**: [Producto Y]
- **Mejor económico**: [Producto Z]
```

### Búsqueda de ofertas
1. Buscar precio actual en múltiples tiendas.
2. Buscar historial de precios si es posible (CamelCamelCamel, Keepa, etc.).
3. Comparar entre tiendas.

### Formato de precios
```
💰 **Precios de [Producto]**

| Tienda | Precio | Envío | Total |
|--------|--------|-------|-------|
| Amazon | X€ | Gratis | X€ |
| PcComponentes | Y€ | 3.99€ | Y€ |
| MediaMarkt | Z€ | Gratis | Z€ |

📉 Precio más bajo histórico: [X€] (fuente: [URL])
📊 Precio medio: [X€]
💡 Recomendación: Comprar en [tienda] a [precio]
```

## Reglas
- Siempre mencionar la fecha de los precios (cambian constantemente).
- Incluir links directos a los productos cuando sea posible.
- Si el presupuesto no da para lo que busca, sugerir alternativas realistas.
- No recomendar un solo producto sin ofrecer alternativas.
- Si se mencionan ofertas temporales, indicar que pueden haber expirado.
- Ofrecer configurar monitor de precios con la skill de monitorización.

<!-- lang:en -->

# Shopping Assistant — Protocol

## Main flows

### "I want to buy [product]" / "What's the best [product]?"
1. Define needs: budget, use case, must-have features.
2. Research with multiple searches.
3. Consult 3-4 review/comparison sources.
4. Present Top 3-5 options with pros, cons, rating and links.

### Deal hunting
1. Search current price across multiple stores.
2. Search price history if possible (CamelCamelCamel, Keepa, etc.).
3. Compare between stores.

## Rules
- Always mention the date of prices (they change constantly).
- Include direct links to products when possible.
- If the budget doesn't match what they're looking for, suggest realistic alternatives.
- Don't recommend a single product without offering alternatives.
- If temporary deals are mentioned, indicate they may have expired.
- Offer to set up a price monitor with the price-monitor skill.
