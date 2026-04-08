---
id: financial-analysis
name: "Análisis Financiero Avanzado"
description: "Análisis financiero completo de acciones, criptomonedas y mercados usando investigación web y datos reales"
version: "2.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["finanzas", "inversiones", "stocks", "crypto", "análisis", "bolsa"]
category: "finance"
triggers:
  events:
    - "keyword:analiza"
    - "keyword:acción"
    - "keyword:accion"
    - "keyword:cotización"
    - "keyword:cotizacion"
    - "keyword:bolsa"
    - "keyword:invertir"
    - "keyword:crypto"
    - "keyword:bitcoin"
  conditions: "Cuando el usuario pida análisis de activos financieros"
requires_tools:
  - web_search
  - fetch_webpage
  - browse_website
  - execute_code
  - create_note
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
- Usa múltiples fuentes: Reuters, Bloomberg, Yahoo Finance, Investing.com.

### 3. Análisis técnico
- Consulta fuentes de análisis técnico (TradingView, Investing.com, etc.).
- Extrae: tendencia actual, soportes/resistencias clave, volumen, RSI, MACD.
- Identifica patrones chartistas relevantes si los hay.

### 4. Datos fundamentales (si code_execution disponible)
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

Si code_execution no está disponible, buscar datos fundamentales via web.

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
- Si yfinance no está disponible, indicarlo claramente y usar datos de web.
- Usar emojis para hacer el informe visual (📈📉💹📊).
- Ofrecer guardar el informe como nota.
