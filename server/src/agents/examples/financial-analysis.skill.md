---
id: financial-analysis
name: "Análisis Financiero Avanzado"
description: "Skill para realizar análisis financiero completo de acciones, criptomonedas y mercados usando yfinance y fuentes web"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["finanzas", "inversiones", "stocks", "crypto", "análisis"]
triggers:
  events:
    - "keyword:analiza"
    - "keyword:acción"
    - "keyword:accion"
    - "keyword:cotización"
    - "keyword:cotizacion"
    - "keyword:bolsa"
    - "keyword:invertir"
  conditions: "Cuando el usuario pida análisis de activos financieros"
---

## Protocolo de Análisis Financiero

Cuando el usuario pida un análisis financiero, sigue este flujo estricto:

### 1. Identificación del activo
- Confirma nombre oficial, ticker y mercado/bolsa.
- Si hay ambigüedad (ADR, múltiples bolsas, nombres similares), **pregunta** antes de continuar.
- Ejemplos: "AAPL" (NASDAQ), "SAN.MC" (BME Madrid), "BTC-USD" (Crypto).

### 2. Investigación web
- Busca noticias recientes (últimas 2 semanas) sobre la empresa/activo.
- Busca resultados trimestrales, guidance, cambios de directiva, litigios, regulación.
- Resume el impacto potencial en el precio.

### 3. Análisis técnico
- Consulta fuentes de análisis técnico (TradingView, Investing.com, etc.).
- Extrae: tendencia actual, soportes/resistencias clave, volumen, RSI, MACD.
- Identifica patrones chartistas relevantes si los hay.

### 4. Datos fundamentales con yfinance
```python
import yfinance as yf

ticker = yf.Ticker("SYMBOL")
info = ticker.info
hist = ticker.history(period="1y")

# Métricas clave a extraer:
# - PER, EPS, Revenue, Profit Margins
# - Debt/Equity, Free Cash Flow
# - 52w High/Low, Beta
# - Dividend Yield (si aplica)
```

### 5. Informe final obligatorio

Estructura del informe:
1. **Resumen Fundamental** (3-5 líneas)
2. **Resumen Técnico** (3-5 líneas)
3. **Escenarios:**
   - **Corto plazo** (1-4 semanas): rango entrada, rango salida, riesgo
   - **Medio plazo** (1-6 meses): rango entrada, rango salida, riesgo
   - **Largo plazo** (6-24 meses): rango entrada, rango salida, riesgo

### Reglas importantes
- ⚠️ Siempre incluir disclaimer: "Esto NO constituye asesoramiento financiero."
- No hacer afirmaciones categóricas sobre el futuro del precio.
- Si yfinance no está disponible, indicarlo claramente.
- Usar emojis para hacer el informe visual (📈📉💹📊).
