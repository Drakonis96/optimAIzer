---
id: price-monitor
name: "Monitor de Precios"
description: "Monitoriza precios de productos en tiendas online y alerta cuando bajan del umbral configurado"
name_en: "Price Monitor"
description_en: "Monitor product prices in online stores and alert when they drop below the configured threshold"
version: "2.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["compras", "precios", "alertas", "ahorro", "shopping"]
tags_en: ["shopping", "prices", "alerts", "savings", "monitoring"]
category: "finance"
triggers:
  events:
    - "keyword:monitor precio"
    - "keyword:avísame cuando baje"
    - "keyword:avisame cuando baje"
    - "keyword:alerta precio"
    - "keyword:seguir precio"
    - "keyword:baja de precio"
  conditions: "Cuando el usuario quiera monitorizar precios de productos"
requires_tools:
  - web_search
  - fetch_webpage
  - browse_website
  - subscribe_to_event
  - create_note
  - send_telegram_message
---

# Monitor de Precios — Protocolo

## Configuración

### Paso 1: Recolección de datos
1. Pide al usuario la **URL del producto** y el **precio objetivo** (umbral).
2. Opcionalmente: frecuencia de comprobación (por defecto cada hora).
3. Verifica que la URL es accesible con `fetch_webpage` o `browse_website`.
4. Extrae el precio actual como referencia.

### Paso 2: Crear suscripción
Usa `subscribe_to_event` para crear monitorización periódica:
- **type**: `poll`
- **poll_interval_minutes**: 60 (o lo que pida el usuario)
- **poll_target**: la URL del producto
- **instruction**: Compara precio actual con objetivo
- **conditions**: "Solo notificar si precio ≤ objetivo"

### Paso 3: Confirmación
```
📍 **Monitor de precio configurado**
🛍️ Producto: [nombre]
💰 Precio actual: [X]€
🎯 Precio objetivo: [Y]€
⏰ Revisión: cada [N] horas
🔗 [URL]
```

## Comprobación periódica
Cada vez que se active:
1. Accede a la URL con `fetch_webpage` o `browse_website`.
2. Extrae el precio actual.
3. Compara con el umbral.
4. **Si cumple** la condición:
   - Envía alerta por Telegram.
5. **Si no cumple**: registro silencioso (no enviar mensaje).

## Formato de alerta
```
🏷️ ¡Precio rebajado!

🛍️ Producto: {nombre}
💰 Precio actual: {precio}€
🎯 Tu objetivo: {precio_objetivo}€
📉 Ahorro: {diferencia}€ ({porcentaje}%)

🔗 {url}
```

## Consulta de seguimientos activos
Si el usuario pregunta qué precios está siguiendo:
1. Lista todos los monitores activos con `list_event_subscriptions`.
2. Muestra: producto, precio objetivo, precio actual, última comprobación.

## Reglas
- Verificar que la URL es accesible antes de crear el monitor.
- Si el precio no se puede extraer de forma fiable, avisar al usuario.
- No crear múltiples monitores para el mismo producto.
- Si el producto ya está por debajo del precio objetivo, avisar inmediatamente.

<!-- lang:en -->

# Price Monitor — Protocol

## Setup

### Step 1: Data collection
1. Ask the user for the **product URL** and **target price** (threshold).
2. Optionally: check frequency (default every hour).
3. Verify the URL is accessible with `fetch_webpage` or `browse_website`.
4. Extract current price as reference.

### Step 2: Create subscription
Use `subscribe_to_event` to create periodic monitoring:
- **type**: `poll`
- **poll_interval_minutes**: 60 (or as requested by user)
- **poll_target**: the product URL
- **instruction**: Compare current price with target
- **conditions**: "Only notify if price ≤ target"

### Step 3: Confirmation
Show configured monitor with product, current price, target, frequency and URL.

## Periodic check
Each time it activates:
1. Access the URL with `fetch_webpage` or `browse_website`.
2. Extract current price.
3. Compare with threshold.
4. **If met**: Send alert via Telegram.
5. **If not met**: Silent log (no message).

## Rules
- Verify the URL is accessible before creating the monitor.
- If the price cannot be reliably extracted, warn the user.
- Do not create multiple monitors for the same product.
- If the product is already below the target price, notify immediately.
