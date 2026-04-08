---
id: language-translator
name: "Traducción e Idiomas"
description: "Traducción precisa entre idiomas, corrección gramatical, explicación de expresiones y aprendizaje de idiomas"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 50
tags: ["traducción", "idiomas", "inglés", "español", "lenguaje"]
category: "knowledge"
triggers:
  events:
    - "keyword:traduce"
    - "keyword:traducir"
    - "keyword:translate"
    - "keyword:traducción"
    - "keyword:traduccion"
    - "keyword:en inglés"
    - "keyword:en español"
    - "keyword:qué significa"
    - "keyword:que significa"
    - "keyword:corrige"
  conditions: "Cuando el usuario pida traducciones o ayuda con idiomas"
requires_tools:
  - web_search
  - create_note
---

# Traducción e Idiomas — Protocolo

## Traducción directa

### Formato de respuesta
```
🌐 **Traducción [Idioma origen] → [Idioma destino]**

**Original:** [texto original]
**Traducción:** [texto traducido]

💡 **Notas:**
- [Matices de traducción si los hay]
- [Alternativas válidas]
```

### Reglas de traducción
- Mantener el tono y registro del original (formal/informal).
- Si hay expresiones idiomáticas, dar equivalente natural (no literal).
- Para términos técnicos, incluir el original entre paréntesis.
- Si hay ambigüedad, ofrecer las distintas interpretaciones.

## Corrección gramatical

### "Corrige: [texto]"
```
✏️ **Corrección:**

**Original:** [texto con errores marcados]
**Corregido:** [texto correcto]

📝 **Errores encontrados:**
1. [Error] → [Corrección] — [Explicación breve]
2. [Error] → [Corrección] — [Explicación]
```

## Aprendizaje de idiomas

### Explicación de expresiones
- Significado literal y figurado.
- Ejemplos de uso en contexto.
- Expresiones equivalentes en el idioma del usuario.

### Vocabulario por tema
Si el usuario pide vocabulario de un tema:
```
📚 **Vocabulario: [Tema] en [Idioma]**

| [Idioma destino] | [Idioma usuario] | Ejemplo |
|-------------------|-------------------|---------|
| [palabra] | [traducción] | [frase] |
```

### Práctica
- Si el usuario quiere practicar, iniciar diálogos en el idioma objetivo.
- Corregir errores de forma constructiva.
- Adaptar nivel de dificultad.

## Idiomas soportados
- Alta calidad: Español, Inglés, Francés, Alemán, Italiano, Portugués
- Buena calidad: Japonés, Chino, Coreano, Ruso, Árabe, Neerlandés
- Aceptable: Otros idiomas (con disclaimer de posible menor precisión)

## Reglas
- Siempre indicar los idiomas de origen y destino.
- Para textos largos, mantener formato y estructura originales.
- No censurar ni modificar el significado del texto original.
- Si el texto contiene jerga técnica, traducir y explicar.
- Para documentos oficiales, recomendar traductor certificado.
