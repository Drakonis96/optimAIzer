---
id: vision
name: "Análisis de Imágenes (Visión IA)"
description: "Analizar imágenes con IA: describir fotos, extraer texto (OCR), interpretar gráficos, documentos y capturas"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["visión", "imágenes", "ocr", "fotos", "análisis visual"]
category: "integration"
triggers:
  events:
    - "keyword:imagen"
    - "keyword:foto"
    - "keyword:captura"
    - "keyword:screenshot"
    - "keyword:analiza esta"
    - "keyword:qué ves"
    - "keyword:ocr"
  conditions: "Cuando se reciba o se necesite analizar una imagen"
requires_tools:
  - analyze_telegram_image
---

# Visión IA — Protocolo de Análisis de Imágenes

## Herramienta disponible
- `analyze_telegram_image` — Analiza una imagen usando modelos de visión con cadena de fallback automática.

## Cadena de proveedores (fallback automático)
1. Proveedor del agente (si soporta visión)
2. Google Gemini
3. OpenAI GPT-4o-mini
4. Anthropic Claude
5. Groq Llama Vision

## Capacidades
- **Descripción general**: Describir contenido, escena, personas, objetos.
- **OCR (extracción de texto)**: Leer texto en fotos de documentos, carteles, pantallas, menús.
- **Análisis de gráficos**: Interpretar datos de gráficos, tablas, dashboards.
- **Comparación**: Si se envían múltiples imágenes, comparar contenido.
- **Identificación**: Reconocer productos, lugares, platos de comida, plantas, etc.

## Flujo de trabajo

### Imagen recibida por Telegram
1. La imagen se procesa automáticamente al recibirla.
2. El agente responde con análisis contextual según la conversación.

### Solicitud explícita de análisis
1. Si el usuario pide analizar una imagen específica, usa `analyze_telegram_image` con un prompt descriptivo.
2. El `prompt` debe ser específico: "Extrae todo el texto visible" mejor que "Analiza esta imagen".

### Tipos de análisis optimizados
- **OCR**: Prompt → "Extrae TODO el texto visible en la imagen, respetando el formato original."
- **Descripción**: Prompt → "Describe detalladamente qué se ve en esta imagen."
- **Datos/Gráficos**: Prompt → "Interpreta los datos mostrados en este gráfico/tabla. Extrae valores clave."
- **Comparación**: Prompt → "Compara estas dos imágenes y lista las diferencias."
- **Comida**: Prompt → "Identifica los platos/alimentos visibles y estima calorías aproximadas."

## Reglas
- Siempre indica cuando un análisis es aproximado o puede tener errores.
- Si la imagen es borrosa o ilegible, indícalo en lugar de inventar contenido.
- Para OCR, intenta preservar el formato original (tablas, listas, etc.).
- No describas contenido sensible o inapropiado.
