---
id: data-analysis
name: "Análisis de Datos"
description: "Análisis y visualización de datos: estadísticas, tendencias, comparaciones y generación de informes"
name_en: "Data Analysis"
description_en: "Data analysis and visualization: statistics, trends, comparisons and report generation"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["datos", "análisis", "estadísticas", "informes", "python"]
tags_en: ["data", "analysis", "statistics", "reports", "python"]
category: "developer"
triggers:
  events:
    - "keyword:analiza datos"
    - "keyword:estadísticas"
    - "keyword:estadisticas"
    - "keyword:gráfico"
    - "keyword:grafico"
    - "keyword:tendencia"
    - "keyword:comparar"
    - "keyword:análisis"
    - "keyword:analisis"
  conditions: "Cuando se necesite análisis de datos o generación de informes"
requires_tools:
  - execute_code
  - create_note
  - web_search
---

# Análisis de Datos — Protocolo

## Capacidades
Este skill permite analizar datos usando Python y herramientas nativas:
- Análisis estadístico (media, mediana, desviación, correlaciones)
- Detección de tendencias y patrones
- Comparaciones entre conjuntos de datos
- Cálculos financieros y presupuestarios
- Generación de informes estructurados

## Flujo de trabajo

### 1. Recolección de datos
- Desde notas/listas del agente (`get_notes`, `get_lists`)
- Desde archivos enviados por el usuario (Telegram)
- Desde web (`web_search`, `fetch_webpage`)
- Datos proporcionados directamente en el chat

### 2. Análisis con Python (si code_execution habilitado)
```python
# Ejemplo: análisis de gastos
import json
from collections import defaultdict

# Datos del usuario
gastos = [
    {"fecha": "2024-01-15", "categoria": "comida", "monto": 45.50},
    {"fecha": "2024-01-16", "categoria": "transporte", "monto": 12.00},
    # ...
]

# Análisis
por_categoria = defaultdict(float)
for g in gastos:
    por_categoria[g["categoria"]] += g["monto"]

total = sum(g["monto"] for g in gastos)
promedio = total / len(gastos)

print(f"Total: {total:.2f}€")
print(f"Promedio por gasto: {promedio:.2f}€")
print("Por categoría:")
for cat, monto in sorted(por_categoria.items(), key=lambda x: -x[1]):
    print(f"  {cat}: {monto:.2f}€ ({monto/total*100:.1f}%)")
```

### 3. Análisis sin código
Si code_execution no está habilitado:
- Realizar cálculos mentalmente para conjuntos pequeños.
- Usar herramientas web para calculadoras online.
- Presentar datos en formato tabla Markdown.

### 4. Formato de informe

```
📊 **Informe: [Título]**

### Resumen ejecutivo
[2-3 líneas con conclusiones clave]

### Datos analizados
| Métrica | Valor |
|---------|-------|
| Total   | X€    |
| Media   | Y€    |
| Máximo  | Z€    |

### Distribución
[Desglose por categoría/período]

### Tendencias
[Observaciones sobre patrones]

### Recomendaciones
[Acciones sugeridas basadas en los datos]
```

## Reglas
- Si los datos son insuficientes para el análisis pedido, indícalo y sugiere qué datos faltan.
- Distingue entre correlación y causalidad.
- Usa unidades claras y consistentes.
- Para datos financieros, respeta la moneda del usuario.
- Ofrece guardar el informe como nota si el usuario lo desea.

<!-- lang:en -->

# Data Analysis — Protocol

## Capabilities
This skill allows analyzing data using Python and native tools:
- Statistical analysis (mean, median, deviation, correlations)
- Trend and pattern detection
- Comparisons between data sets
- Financial and budget calculations
- Structured report generation

## Workflow

### 1. Data collection
- From agent notes/lists (`get_notes`, `get_lists`)
- From user-sent files (Telegram)
- From web (`web_search`, `fetch_webpage`)
- Data provided directly in chat

### 2. Analysis with Python (if code_execution enabled)
Use pandas, numpy, collections for statistical analysis and data processing.

### 3. Analysis without code
If code_execution is not enabled:
- Perform mental calculations for small data sets.
- Use web tools for online calculators.
- Present data in Markdown table format.

## Rules
- If data is insufficient for the requested analysis, indicate it and suggest what data is missing.
- Distinguish between correlation and causation.
- Use clear and consistent units.
- For financial data, respect the user's currency.
- Offer to save the report as a note if desired.
