---
id: price-monitor
name: "Monitor de Precios"
description: "Monitoriza precios de productos en tiendas online y alerta cuando bajan del umbral configurado"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["compras", "precios", "alertas", "ahorro"]
triggers:
  events:
    - "keyword:monitor precio"
    - "keyword:avísame cuando baje"
    - "keyword:alerta precio"
---

## Monitor de Precios - Instrucciones

Cuando el usuario quiera monitorizar el precio de un producto:

### Configuración
1. Pide al usuario la **URL del producto** y el **precio objetivo** (umbral).
2. Crea una suscripción de eventos tipo `poll` usando `subscribe_event`:
   - **type**: `poll`
   - **poll_interval_minutes**: 60 (cada hora, o lo que pida el usuario)
   - **poll_target**: la URL del producto
   - **instruction**: "Visita {url}, extrae el precio actual y compáralo con {precio_objetivo}€. Si el precio es igual o inferior, envía una alerta por Telegram con: nombre del producto, precio actual, precio objetivo, diferencia y enlace directo."
   - **conditions**: "Solo notificar si el precio es ≤ {precio_objetivo}€"

### Comprobación periódica
Cada vez que se active la comprobación:
1. Usa `fetch_webpage` o `browse_website` para acceder a la URL.
2. Extrae el precio actual del producto.
3. Compara con el umbral.
4. Si cumple la condición:
   - Envía alerta por Telegram con emoji 🏷️
   - Incluye enlace directo al producto
5. Si no cumple, no enviar mensaje (registro silencioso).

### Formato de alerta
```
🏷️ ¡Precio rebajado!

Producto: {nombre}
💰 Precio actual: {precio}€
🎯 Tu objetivo: {precio_objetivo}€
📉 Ahorro: {diferencia}€ ({porcentaje}%)

🔗 {url}
```
