---
id: data-analysis
name: "Análisis de Datos"
description: "Análisis y visualización de datos: estadísticas, tendencias, comparaciones y generación de informes"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 60
tags: ["datos", "análisis", "estadísticas", "informes", "python"]
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
