---
id: financial-analysis
name: "Análisis Financiero Avanzado"
description: "Análisis financiero completo de acciones, criptomonedas y mercados usando investigación web y datos reales"
name_en: "Advanced Financial Analysis"
description_en: "Complete financial analysis of stocks, cryptocurrencies and markets using web research and real data"
version: "2.0.0"
author: "optimAIzer"
enabled: true
priority: 70
tags: ["finanzas", "inversiones", "stocks", "crypto", "análisis", "bolsa"]
tags_en: ["finance", "investments", "stocks", "crypto", "analysis", "markets"]
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

<!-- lang:en -->

## Financial Analysis Protocol

When the user requests a financial analysis, follow this strict flow:

### 1. Asset identification
- Confirm official name, ticker and market/exchange.
- If there's ambiguity (ADR, multiple exchanges, similar names), **ask** before continuing.
- Examples: "AAPL" (NASDAQ), "SAN.MC" (BME Madrid), "BTC-USD" (Crypto).

### 2. Web research
- Search recent news (last 2 weeks) about the company/asset.
- Search quarterly results, guidance, management changes, litigation, regulation.
- Summarize potential price impact.
- Use multiple sources: Reuters, Bloomberg, Yahoo Finance, Investing.com.

### 3. Technical analysis
- Consult technical analysis sources (TradingView, Investing.com, etc.).
- Extract: current trend, key support/resistance, volume, RSI, MACD.
- Identify relevant chart patterns if any.

### 4. Fundamental data (if code_execution available)
Use yfinance or similar to extract: PER, EPS, Revenue, Profit Margins, Debt/Equity, Free Cash Flow, 52w High/Low, Beta, Dividend Yield.

If code_execution is not available, search fundamental data via web.

### 5. Mandatory final report

Report structure:
1. **Fundamental Summary** (3-5 lines)
2. **Technical Summary** (3-5 lines)
3. **Scenarios:**
   - **Short term** (1-4 weeks): entry range, exit range, risk
   - **Medium term** (1-6 months): entry range, exit range, risk
   - **Long term** (6-24 months): entry range, exit range, risk

### Important rules
- ⚠️ Always include disclaimer: "This does NOT constitute financial advice."
- Do not make categorical statements about future prices.
- If yfinance is not available, clearly indicate it and use web data.
- Use emojis to make the report visual (📈📉💹📊).
- Offer to save the report as a note.
