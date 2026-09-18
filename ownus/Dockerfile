# Multi-stage production build for Orion Next.js Web Frontend
FROM node:20-alpine AS builder

WORKDIR /app

COPY ownus/package*.json ./
RUN npm install

COPY ownus ./
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Production runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1

COPY ownus/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./

EXPOSE 3000

USER node

CMD ["npm", "start"]
