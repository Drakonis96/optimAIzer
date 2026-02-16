FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm ci \
  && npm --prefix server ci

FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .

RUN node ./node_modules/vite/bin/vite.js build \
  && node ./server/node_modules/typescript/bin/tsc -p ./server/tsconfig.json

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=7189
ENV CORS_ORIGIN=http://localhost:7189

COPY package*.json ./
COPY server/package*.json ./server/

RUN npm ci --omit=dev \
  && npm --prefix server ci --omit=dev \
  && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist

RUN mkdir -p /app/data

EXPOSE 7189

CMD ["node", "server/dist/index.js"]
