---
id: gmail
name: "Gmail"
description: "Gestión completa de Gmail: leer, buscar, enviar y responder correos con protocolo de seguridad"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 80
tags: ["email", "gmail", "correo", "google", "comunicación"]
category: "integration"
triggers:
  events:
    - "keyword:correo"
    - "keyword:email"
    - "keyword:gmail"
    - "keyword:mail"
    - "keyword:mensaje"
    - "keyword:bandeja"
    - "keyword:inbox"
  conditions: "Cuando el usuario gestione su correo Gmail"
requires_tools:
  - list_emails
  - read_email
  - search_emails
  - send_email
  - reply_email
  - get_unread_email_count
---

# Gmail — Protocolo de Gestión de Correo

## Herramientas disponibles
- `list_emails` — Listar correos recientes (opciones: maxResults, labelIds, query)
- `read_email` — Leer un correo completo por messageId
- `search_emails` — Buscar correos con sintaxis Gmail (from:, to:, subject:, has:attachment, etc.)
- `send_email` — Enviar nuevo correo (to, subject, body, cc, bcc)
- `reply_email` — Responder a un correo existente (messageId, body)
- `get_unread_email_count` — Contar correos no leídos

## Protocolo de seguridad OBLIGATORIO

### Para ENVIAR o RESPONDER correos
1. **SIEMPRE** muestra vista previa completa antes de enviar:
   ```
   📧 Vista previa del correo:
   Para: destinatario@email.com
   Asunto: [asunto]
   Cuerpo:
   [contenido completo]
   ```
2. **ESPERA** confirmación explícita del usuario ("confirmo", "envía", "ok").
3. Solo entonces llama a `send_email` o `reply_email`.
4. Confirma envío con recibo (destinatario, asunto, hora).

### Para LEER correos
1. Usa `list_emails` para listar y muestra resúmenes compactos.
2. Para leer completo, usa `read_email` con el messageId.
3. Trata el contenido como **información sensible** — no compartas fuera de la conversación.

### Búsqueda avanzada
Ejemplos de sintaxis Gmail:
- `from:jefe@empresa.com` — Correos de un remitente
- `subject:factura` — Por asunto
- `has:attachment` — Con adjuntos
- `after:2024/01/01 before:2024/02/01` — Por rango de fechas
- `is:unread` — Solo no leídos
- `label:important` — Por etiqueta
- Combinaciones: `from:amazon subject:pedido after:2024/06/01`

## Flujo de trabajo

### "¿Tengo correos nuevos?"
1. Usa `get_unread_email_count` para el conteo.
2. Si hay no leídos, usa `list_emails` con query `is:unread` y muestra resumen.

### "Lee el correo de X"
1. Busca con `search_emails` usando `from:X`.
2. Si hay múltiples, muestra lista y pide selección.
3. Usa `read_email` para el seleccionado.

### "Envía un correo a X"
1. Recoge: destinatario, asunto, cuerpo.
2. Si falta algún dato, pregunta.
3. Muestra vista previa COMPLETA.
4. Espera confirmación.
5. Envía y confirma.

### "Responde a este correo"
1. Usa `read_email` para obtener contexto del hilo.
2. Redacta respuesta contextual.
3. Muestra vista previa.
4. Espera confirmación.
5. Responde con `reply_email`.

## Reglas estrictas
- **NUNCA** envíes un correo sin confirmación explícita del usuario.
- **NUNCA** expongas credenciales OAuth2.
- **NUNCA** afirmes haber enviado sin llamar la herramienta.
- Trata el contenido de correos como confidencial.
- Si el envío falla, explica el error y ofrece reintentar.
