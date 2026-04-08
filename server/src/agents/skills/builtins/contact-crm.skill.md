---
id: contact-crm
name: "CRM Personal y Contactos"
description: "Seguimiento ligero de personas, ultimas interacciones, follow-ups y contexto personal"
name_en: "Personal CRM & Contacts"
description_en: "Lightweight people tracking, last interactions, follow-ups and personal context"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 54
tags: ["contactos", "crm", "follow-up", "personas", "relaciones"]
tags_en: ["contacts", "crm", "people", "follow-up", "relationships"]
category: "productivity"
triggers:
  events:
    - "keyword:contacto"
    - "keyword:follow up"
    - "keyword:seguimiento"
    - "keyword:cliente"
    - "keyword:networking"
  conditions: "Cuando el usuario quiera recordar contexto sobre personas o programar seguimientos"
requires_tools:
  - create_note
  - search_notes
  - update_note
  - set_reminder
  - create_list
  - add_to_list
  - send_email
---

# CRM Personal y Contactos

## Objetivo
Guardar contexto util sobre personas y convertir relaciones olvidadas en seguimientos claros y accionables.

## Datos utiles por contacto
- Nombre y contexto
- Ultima interaccion
- Temas abiertos
- Proximo paso sugerido
- Preferencias o detalles que el usuario quiera recordar

## Flujo recomendado
1. Busca si ya existe una nota del contacto.
2. Si no existe, crea una ficha breve en nota.
3. Tras una reunion o conversacion, actualiza la nota con hechos concretos.
4. Si hay un siguiente paso, ofrece crear un recordatorio.

## Reglas
- No conviertas rumores o suposiciones en hechos de la ficha.
- Si el usuario quiere contactar a alguien, pide confirmacion antes de enviar correo.
- Mantener un tono profesional y sobrio; esta skill es para memoria operativa, no para escribir biografias largas.

<!-- lang:en -->

# Personal CRM & Contacts — Protocol

## Objective
A simple system to track important people, last interactions, follow-up dates and relevant personal context.

## Suggested structure
- One note per important contact with: name, context, last interaction, pending follow-ups.
- A list for pending follow-ups sorted by date.
- Reminders for important follow-up dates.

## Flow
1. When the user mentions someone, check if there's an existing note.
2. Update last interaction date and context.
3. If a follow-up is needed, add to the follow-up list and set a reminder.
4. In reviews, surface contacts that haven't been contacted in a while.

## Rules
- Don't store sensitive personal data without the user's explicit mention.
- Keep notes concise — focus on actionable information.
- Don't make assumptions about relationships; record what the user shares.
- Offer periodic follow-up reminders for important contacts.
