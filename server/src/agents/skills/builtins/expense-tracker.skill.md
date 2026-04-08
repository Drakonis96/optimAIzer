---
id: expense-tracker
name: "Control de Gastos"
description: "Registro, análisis y seguimiento de gastos personales con categorización automática y alertas de presupuesto"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["finanzas", "gastos", "presupuesto", "ahorro", "dinero"]
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
