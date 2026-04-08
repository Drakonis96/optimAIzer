---
id: language-translator
name: "Traducción e Idiomas"
description: "Traducción precisa entre idiomas, corrección gramatical, explicación de expresiones y aprendizaje de idiomas"
name_en: "Translation & Languages"
description_en: "Accurate translation between languages, grammar correction, expression explanation and language learning"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 50
tags: ["traducción", "idiomas", "inglés", "español", "lenguaje"]
tags_en: ["translation", "languages", "english", "spanish", "language"]
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

<!-- lang:en -->

# Translation & Languages — Protocol

## Direct translation

### Translation rules
- Maintain the tone and register of the original (formal/informal).
- For idiomatic expressions, provide natural equivalents (not literal).
- For technical terms, include the original in parentheses.
- If there's ambiguity, offer different interpretations.

## Grammar correction
- Mark errors in the original.
- Provide corrected version.
- Explain each correction briefly.

## Language learning

### Expression explanation
- Literal and figurative meaning.
- Usage examples in context.
- Equivalent expressions in the user's language.

### Vocabulary by topic
If the user asks for vocabulary on a topic, present a table with word, translation, and example sentence.

### Practice
- If the user wants to practice, start dialogues in the target language.
- Correct errors constructively.
- Adapt difficulty level.

## Supported languages
- High quality: Spanish, English, French, German, Italian, Portuguese
- Good quality: Japanese, Chinese, Korean, Russian, Arabic, Dutch
- Acceptable: Other languages (with disclaimer of possible lower accuracy)

## Rules
- Always indicate source and target languages.
- For long texts, maintain original format and structure.
- Do not censor or modify the meaning of the original text.
- If the text contains technical jargon, translate and explain.
- For official documents, recommend a certified translator.
