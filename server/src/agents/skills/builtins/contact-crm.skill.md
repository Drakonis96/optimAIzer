---
id: contact-crm
name: "CRM Personal y Contactos"
description: "Seguimiento ligero de personas, ultimas interacciones, follow-ups y contexto personal"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 54
tags: ["contactos", "crm", "follow-up", "personas", "relaciones"]
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
