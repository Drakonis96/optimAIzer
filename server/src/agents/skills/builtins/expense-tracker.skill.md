---
id: expense-tracker
name: "Control de Gastos"
description: "Registro, análisis y seguimiento de gastos personales con categorización automática y alertas de presupuesto"
name_en: "Expense Tracker"
description_en: "Personal expense recording, analysis and tracking with automatic categorization and budget alerts"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["finanzas", "gastos", "presupuesto", "ahorro", "dinero"]
tags_en: ["finance", "expenses", "budget", "savings", "money"]
category: "finance"
triggers:
  events:
    - "keyword:gasto"
    - "keyword:gasté"
    - "keyword:gaste"
    - "keyword:pagué"
    - "keyword:pague"
    - "keyword:compré"
    - "keyword:compre"
    - "keyword:presupuesto"
    - "keyword:cuánto llevo"
    - "keyword:cuanto llevo"
  conditions: "Cuando el usuario registre o consulte gastos"
requires_tools:
  - remember
  - create_note
  - get_notes
  - search_notes
  - create_list
  - get_lists
  - web_search
---

# Control de Gastos — Protocolo

## Registro de gastos

### Formato rápido
El usuario puede decir de forma natural:
- "Gasté 45€ en gasolina"
- "Compré comida por 23.50"
- "Pagué 120€ de luz"

### Proceso de registro
1. Extrae: **monto**, **concepto**, **categoría** (auto-detectar), **fecha** (hoy si no se especifica).
2. Categorías automáticas:
   - 🍔 **Comida**: restaurante, supermercado, delivery, café
   - 🚗 **Transporte**: gasolina, parking, taxi, metro, peajes
   - 🏠 **Hogar**: alquiler, luz, agua, gas, internet, seguro hogar
   - 🛒 **Compras**: ropa, electrónica, Amazon, suscripciones
   - 🏥 **Salud**: farmacia, médico, dentista, fisio
   - 🎉 **Ocio**: cine, viajes, deportes, conciertos
   - 📚 **Educación**: cursos, libros, formación
   - 💼 **Trabajo**: material oficina, software, coworking
   - 📱 **Servicios**: móvil, seguros, suscripciones digitales
   - 🔧 **Otros**: lo que no encaje en las anteriores
3. Confirma brevemente: "✅ Registrado: 45€ en 🚗 Transporte (gasolina)".
4. Guarda en nota de gastos del mes actual.

### Formato de almacenamiento
Nota titulada "Gastos [Mes] [Año]":
```
| Fecha | Categoría | Concepto | Monto |
|-------|-----------|----------|-------|
| 15/01 | 🍔 Comida | Supermercado | 67.30€ |
| 15/01 | 🚗 Transporte | Gasolina | 45.00€ |
```

## Consultas y análisis

### "¿Cuánto llevo este mes?"
1. Busca nota de gastos del mes con `search_notes`.
2. Suma total y desglose por categoría.
3. Compara con presupuesto si está definido.

### "¿Cuánto gasto en [categoría]?"
1. Filtra gastos por categoría.
2. Muestra total y evolución si hay datos de varios meses.

### Resumen mensual
```
📊 **Resumen de gastos — Enero 2025**

💰 Total: 1,234.56€
📊 Media diaria: 39.82€

Desglose:
🏠 Hogar: 450€ (36.4%)
🍔 Comida: 320€ (25.9%)
🚗 Transporte: 180€ (14.6%)
🛒 Compras: 150€ (12.1%)
🎉 Ocio: 134.56€ (10.9%)

📈 vs mes anterior: +5.2%
```

## Alertas de presupuesto
Si el usuario define un presupuesto:
- Al 50%: Aviso informativo
- Al 75%: Alerta moderada
- Al 90%: Alerta urgente
- Al 100%: Notificación de exceso

## Reglas
- Registra el gasto inmediatamente, sin pedir datos innecesarios.
- Si el monto es ambiguo ("unos 50"), registra la cantidad mencionada.
- Si falta la moneda, usa € por defecto (o la del usuario si se conoce).
- No juzgues los gastos del usuario.
- Ofrece guardar el informe como nota al hacer análisis.

<!-- lang:en -->

# Expense Tracker — Protocol

## Expense recording

### Quick format
The user can speak naturally:
- "I spent $45 on gas"
- "Bought groceries for $23.50"
- "Paid $120 for electricity"

### Recording process
1. Extract: **amount**, **concept**, **category** (auto-detect), **date** (today if not specified).
2. Automatic categories:
   - 🍔 **Food**: restaurant, supermarket, delivery, coffee
   - 🚗 **Transport**: gas, parking, taxi, metro, tolls
   - 🏠 **Home**: rent, electricity, water, gas, internet, home insurance
   - 🛒 **Shopping**: clothing, electronics, Amazon, subscriptions
   - 🏥 **Health**: pharmacy, doctor, dentist, physiotherapy
   - 🎉 **Leisure**: cinema, travel, sports, concerts
   - 📚 **Education**: courses, books, training
   - 💼 **Work**: office supplies, software, coworking
   - 📱 **Services**: mobile, insurance, digital subscriptions
   - 🔧 **Other**: anything that doesn't fit above
3. Confirm briefly: "✅ Recorded: $45 in 🚗 Transport (gas)".
4. Save in current month's expense note.

## Queries and analysis

### "How much have I spent this month?"
1. Search the month's expense note with `search_notes`.
2. Sum total and breakdown by category.
3. Compare with budget if defined.

### Monthly summary format
```
📊 **Expense summary — January 2025**

💰 Total: $1,234.56
📊 Daily average: $39.82

Breakdown:
🏠 Home: $450 (36.4%)
🍔 Food: $320 (25.9%)
🚗 Transport: $180 (14.6%)
🛒 Shopping: $150 (12.1%)
🎉 Leisure: $134.56 (10.9%)

📈 vs previous month: +5.2%
```

## Budget alerts
If the user defines a budget:
- At 50%: Informative notice
- At 75%: Moderate alert
- At 90%: Urgent alert
- At 100%: Excess notification

## Rules
- Record the expense immediately, without asking for unnecessary data.
- If the amount is ambiguous ("about 50"), record the mentioned amount.
- If the currency is missing, use the user's known currency or default.
- Do not judge the user's spending.
- Offer to save the report as a note when doing analysis.
