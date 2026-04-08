---
id: travel-planner
name: "Planificador de Viajes"
description: "Planificación completa de viajes: itinerarios, búsqueda de vuelos/hoteles, actividades y presupuesto"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 55
tags: ["viajes", "vacaciones", "vuelos", "hoteles", "itinerario", "turismo"]
category: "lifestyle"
triggers:
  events:
    - "keyword:viaje"
    - "keyword:vacaciones"
    - "keyword:vuelo"
    - "keyword:hotel"
    - "keyword:itinerario"
    - "keyword:visitar"
    - "keyword:escapada"
    - "keyword:travel"
  conditions: "Cuando el usuario planifique viajes o vacaciones"
requires_tools:
  - web_search
  - fetch_webpage
  - browse_website
  - create_note
  - create_list
  - create_calendar_event
  - set_reminder
---

# Planificador de Viajes — Protocolo

## Fase 1: Recolección de información
Preguntar al usuario:
1. **Destino(s)**: ¿Adónde quiere ir?
2. **Fechas**: ¿Cuándo? ¿Flexibilidad?
3. **Presupuesto**: ¿Rango aproximado?
4. **Viajeros**: ¿Cuántos? ¿Niños?
5. **Intereses**: cultura, playa, aventura, gastronomía, relax…
6. **Alojamiento**: hotel, Airbnb, hostel…

## Fase 2: Investigación

### Vuelos
1. Buscar en web: `web_search` → "vuelos [origen] [destino] [fechas] baratos"
2. Consultar comparadores: `browse_website` en Skyscanner, Google Flights, Kayak.
3. Presentar mejores opciones con: precio, horarios, escalas, aerolínea.

### Alojamiento
1. Buscar opciones de alojamiento según preferencias.
2. Filtrar por zona, precio, puntuación.
3. Presentar Top 3 con: nombre, precio/noche, ubicación, puntuación, link.

### Actividades y lugares
1. Investigar qué ver/hacer en destino.
2. Tiempo necesario por actividad.
3. Horarios de apertura, precios, reserva necesaria.
4. Tips locales (transporte, costumbres, seguridad).

## Fase 3: Itinerario

### Formato día a día
```
✈️ **Viaje a [Destino] — [Fechas]**

📅 **Día 1 — [Fecha]** (Llegada)
🛬 Llegada: [Hora] — [Aeropuerto]
🏨 Check-in: [Hotel] — [Zona]
🕐 16:00 — Paseo por [zona central]
🍽️ 20:00 — Cena: [restaurante recomendado]

📅 **Día 2 — [Fecha]**
🕐 09:00 — [Actividad 1] (2h, entrada: X€)
🕐 11:30 — [Actividad 2] (1.5h, gratis)
🍽️ 13:00 — Almuerzo: [zona/restaurante]
🕐 15:00 — [Actividad 3] (3h, entrada: X€)
🍽️ 20:30 — Cena: [sugerencia]

...

📅 **Día N — [Fecha]** (Vuelta)
🕐 [Hora] — Check-out
🛫 [Hora] — Vuelo de regreso
```

### Presupuesto estimado
```
💰 **Presupuesto estimado**

✈️ Vuelos: ~X€ (ida y vuelta x personas)
🏨 Alojamiento: ~X€ (N noches)
🎫 Entradas/Actividades: ~X€
🍽️ Comida: ~X€ (estimación N€/día/persona)
🚕 Transporte local: ~X€
🛍️ Extras/Shopping: ~X€

📊 **Total estimado: ~X€**
```

## Fase 4: Acciones
Una vez aprobado el plan:
1. Crear nota con el itinerario completo.
2. Crear eventos en el calendario para vuelos y actividades principales.
3. Crear lista de cosas que llevar (packing list).
4. Programar recordatorio para: reservar vuelos, hacer check-in online, hacer maleta.

## Reglas
- Los precios son estimaciones — indicar que pueden variar.
- Incluir alternativas para días de lluvia (actividades indoor).
- Respetar el presupuesto del usuario.
- No llenar cada minuto — dejar tiempo libre para espontaneidad.
- Incluir información práctica: moneda, enchufes, visado, idioma, emergencias.
- Links directos a fuentes de reserva cuando sea posible.
