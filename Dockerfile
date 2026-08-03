# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Usuario no-root: si alguien escapa del proceso, no arranca como root.
RUN addgroup -g 1001 -S ngf && adduser -u 1001 -S ngf -G ngf

# Sólo el output standalone: sin código fuente ni devDependencies.
COPY --from=build --chown=ngf:ngf /app/.next/standalone ./
COPY --from=build --chown=ngf:ngf /app/.next/static ./.next/static
COPY --from=build --chown=ngf:ngf /app/public ./public

ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA

USER ngf
EXPOSE 3000
CMD ["node", "server.js"]
