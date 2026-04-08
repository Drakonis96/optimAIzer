---
id: subscriptions-bills
name: "Facturas y Suscripciones"
description: "Control de renovaciones, gastos recurrentes, vencimientos y recordatorios de servicios"
name_en: "Bills & Subscriptions"
description_en: "Renewal tracking, recurring expenses, due dates and service reminders"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 59
tags: ["suscripciones", "facturas", "renovaciones", "gastos recurrentes", "billing"]
tags_en: ["subscriptions", "bills", "renewals", "recurring expenses", "billing"]
category: "finance"
triggers:
  events:
    - "keyword:suscripcion"
    - "keyword:subscription"
    - "keyword:factura"
    - "keyword:renovacion"
    - "keyword:gasto recurrente"
  conditions: "Cuando el usuario quiera controlar pagos periodicos o renovaciones"
requires_tools:
  - add_expense
  - list_expenses
  - expense_summary
  - create_list
  - get_list
  - add_to_list
  - update_list_item
  - set_reminder
  - schedule_task
  - create_note
---

# Facturas y Suscripciones

## Objetivo
Dar visibilidad a pagos recurrentes, proximos vencimientos y coste mensual acumulado sin mezclar compras puntuales con servicios continuos.

## Flujo recomendado
1. Identifica servicio, importe, periodicidad y fecha de cobro.
2. Registra gasto o lista de suscripciones segun el caso.
3. Si hay fecha futura clara, crea recordatorio o tarea programada.
4. En revisiones, resume coste total, proximos cobros y posibles recortes.

## Casos de uso
- Auditoria mensual de suscripciones.
- Recordatorio antes de prueba gratis o renovacion anual.
- Seguimiento de facturas grandes como seguros o dominios.

## Reglas
- No dupliques gastos si ya estan registrados; busca primero.
- Distingue claramente entre suscripcion activa, cancelada y pendiente de revision.
- Si el usuario quiere cancelar un servicio, no lo des por hecho: prepara el plan o recordatorio, pero no afirmes que ya esta cancelado.

<!-- lang:en -->

# Bills & Subscriptions — Protocol

## Objective
Provide visibility into recurring payments, upcoming due dates and accumulated monthly cost without mixing one-time purchases with ongoing services.

## Recommended flow
1. Identify service, amount, frequency and billing date.
2. Record as expense or subscription list as appropriate.
3. If there's a clear future date, create reminder or scheduled task.
4. In reviews, summarize total cost, upcoming charges and possible savings.

## Use cases
- Monthly subscription audit.
- Reminder before free trial or annual renewal.
- Tracking of large bills like insurance or domain renewals.

## Rules
- Don't duplicate expenses if already recorded; search first.
- Clearly distinguish between active subscription, canceled and pending review.
- If the user wants to cancel a service, don't assume it's done: prepare the plan or reminder, but don't claim it's already canceled.
