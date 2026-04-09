---
id: excel-spreadsheets
name: "Hojas de Cálculo Excel"
description: "Lectura, creación y edición de archivos Excel (.xlsx): hojas, fórmulas, formato, filtros y análisis de datos tabulares"
name_en: "Excel Spreadsheets"
description_en: "Read, create and edit Excel files (.xlsx): sheets, formulas, formatting, filters and tabular data analysis"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["excel", "xlsx", "hoja de cálculo", "datos", "fórmulas", "tabla"]
tags_en: ["excel", "xlsx", "spreadsheet", "data", "formulas", "table"]
category: "productivity"
triggers:
  events:
    - "keyword:excel"
    - "keyword:xlsx"
    - "keyword:hoja de cálculo"
    - "keyword:spreadsheet"
    - "keyword:tabla excel"
    - "keyword:fórmula"
    - "keyword:formula"
  conditions: "Cuando el usuario necesite trabajar con archivos Excel"
requires_tools:
  - read_excel
  - create_excel
  - edit_excel
  - web_search
---

# Hojas de Cálculo Excel — Protocolo

## Capacidades
Este skill permite trabajar con archivos Excel (.xlsx):
- **Lectura**: Leer hojas, encabezados, datos, filas y columnas de archivos existentes
- **Creación**: Generar archivos Excel con múltiples hojas, encabezados formateados, datos, fórmulas y autofiltro
- **Edición**: Modificar celdas, añadir/eliminar filas, aplicar fórmulas, añadir/renombrar hojas
- **Análisis**: Analizar datos, calcular estadísticas, identificar patrones
- **Formato**: Encabezados con estilo (negrita, colores), anchos de columna, filtros automáticos

## Flujo de trabajo

### Leer un Excel
1. El usuario envía un archivo .xlsx
2. Usar `read_excel` con la ruta del archivo
3. Se extrae: nombre de hojas, encabezados, datos (hasta 500 filas por hoja)
4. Presentar un resumen de los datos encontrados
5. Ofrecer análisis, filtrado o transformación según necesite el usuario

### Crear un Excel
1. **PLAN DE ACTUACIÓN**: Antes de crear el archivo, generar un plan paso a paso visible para el usuario que incluya:
   - Objetivo del archivo Excel
   - Hojas planificadas (nombre y propósito de cada una)
   - Estructura de datos: columnas, tipos de datos, fórmulas
   - Formato y estilo a aplicar (colores, anchos de columna)
2. Determinar la estructura de datos necesaria
3. Para cada hoja, definir:
   - `name`: Nombre de la hoja
   - `headers`: Array de encabezados de columna
   - `rows`: Array de arrays con los datos
   - `columnWidths`: Anchos de columna (opcional)
   - `headerStyle`: Estilo de encabezados (bold, backgroundColor, fontColor)
   - `formulas`: Fórmulas de Excel (ej: SUM, AVERAGE, VLOOKUP)
4. Llamar a `create_excel` con el array de hojas
5. Informar la ruta del archivo generado

### Editar un Excel existente
1. Leer el Excel con `read_excel` para entender su estructura
2. Determinar las operaciones necesarias:
   - `set_cell`: Modificar una celda específica (ej: A1, B5)
   - `add_row`: Añadir una fila al final
   - `delete_row`: Eliminar una fila por índice
   - `set_formula`: Aplicar una fórmula a una celda
   - `add_sheet`: Añadir una nueva hoja
   - `rename_sheet`: Renombrar una hoja existente
3. Llamar a `edit_excel` con el array de operaciones
4. Informar el archivo resultante

### Ejemplo de creación JSON
```json
[
  {
    "name": "Ventas Q1",
    "headers": ["Mes", "Producto", "Unidades", "Precio", "Total"],
    "rows": [
      ["Enero", "Producto A", 150, 29.99, null],
      ["Enero", "Producto B", 80, 49.99, null],
      ["Febrero", "Producto A", 175, 29.99, null],
      ["Febrero", "Producto B", 95, 49.99, null]
    ],
    "columnWidths": [12, 20, 12, 12, 15],
    "headerStyle": {"bold": true, "backgroundColor": "4472C4", "fontColor": "FFFFFF"},
    "formulas": [
      {"cell": "E2", "formula": "C2*D2"},
      {"cell": "E3", "formula": "C3*D3"},
      {"cell": "E4", "formula": "C4*D4"},
      {"cell": "E5", "formula": "C5*D5"}
    ]
  },
  {
    "name": "Resumen",
    "headers": ["Métrica", "Valor"],
    "rows": [
      ["Total Unidades", null],
      ["Ingreso Total", null],
      ["Promedio por venta", null]
    ],
    "formulas": [
      {"cell": "B2", "formula": "SUM('Ventas Q1'!C2:C5)"},
      {"cell": "B3", "formula": "SUM('Ventas Q1'!E2:E5)"},
      {"cell": "B4", "formula": "B3/B2"}
    ]
  }
]
```

### Ejemplo de edición JSON
```json
[
  {"sheet": "Ventas Q1", "type": "set_cell", "cell": "A6", "value": "Marzo"},
  {"sheet": "Ventas Q1", "type": "add_row", "row": ["Marzo", "Producto C", 200, 19.99]},
  {"sheet": "Ventas Q1", "type": "set_formula", "cell": "E6", "formula": "C6*D6"},
  {"type": "add_sheet", "sheetName": "Notas"},
  {"sheet": "Notas", "type": "set_cell", "cell": "A1", "value": "Datos actualizados el 15/03/2025"}
]
```

## Fórmulas comunes
| Fórmula | Uso |
|---------|-----|
| `SUM(A1:A10)` | Suma de rango |
| `AVERAGE(A1:A10)` | Promedio |
| `COUNT(A1:A10)` | Contar celdas con números |
| `MAX(A1:A10)` / `MIN(A1:A10)` | Máximo / mínimo |
| `IF(A1>100,"Alto","Bajo")` | Condicional |
| `VLOOKUP(valor,rango,col,0)` | Búsqueda vertical |
| `CONCATENATE(A1," ",B1)` | Concatenar texto |
| `ROUND(A1,2)` | Redondear |

## Notación de celdas
- Columnas: A, B, C... Z, AA, AB...
- Filas: 1, 2, 3... (1 = encabezados si existen)
- Rango: A1:B10 (desde A1 hasta B10)
- Hoja cruzada: `'Nombre Hoja'!A1`

## Reglas
- Al leer un Excel, mostrar primero un resumen (hojas, filas, columnas) antes de volcar todos los datos.
- Si hay muchas filas (>50), mostrar solo las primeras 10 y ofrecer análisis.
- Incluir siempre encabezados descriptivos al crear archivos nuevos.
- Aplicar formato de encabezados por defecto (negrita, color azul, texto blanco).
- Para cálculos recurrentes, usar fórmulas en vez de valores hardcodeados.
- Ofrecer siempre el archivo generado para descarga.

<!-- lang:en -->

# Excel Spreadsheets — Protocol

## Capabilities
This skill allows working with Excel files (.xlsx):
- **Reading**: Read sheets, headers, data, rows and columns from existing files
- **Creation**: Generate Excel files with multiple sheets, formatted headers, data, formulas and auto-filters
- **Editing**: Modify cells, add/delete rows, apply formulas, add/rename sheets
- **Analysis**: Analyze data, calculate statistics, identify patterns
- **Formatting**: Styled headers (bold, colors), column widths, auto-filters

## Workflow

### Read an Excel file
1. User sends an .xlsx file
2. Use `read_excel` with the file path
3. Extract: sheet names, headers, data (up to 500 rows per sheet)
4. Present a data summary
5. Offer analysis, filtering or transformation as needed

### Create an Excel file
1. **ACTION PLAN**: Before creating the file, generate a visible step-by-step plan for the user including:
   - File objective
   - Planned sheets (name and purpose of each)
   - Data structure: columns, data types, formulas
   - Formatting and style (colors, column widths)
2. Determine the data structure needed
3. For each sheet, define: name, headers, rows, columnWidths, headerStyle, formulas
4. Call `create_excel` with the sheets array
5. Report the generated file path

### Edit an existing Excel
1. Read with `read_excel` to understand its structure
2. Determine needed operations (set_cell, add_row, delete_row, set_formula, add_sheet, rename_sheet)
3. Call `edit_excel` with the operations array
4. Report the resulting file

## Rules
- When reading, show a summary first (sheets, rows, columns) before dumping all data.
- If many rows (>50), show only first 10 and offer analysis.
- Always include descriptive headers when creating new files.
- Apply default header formatting (bold, blue background, white text).
- For recurring calculations, use formulas instead of hardcoded values.
- Always offer the generated file for download.
