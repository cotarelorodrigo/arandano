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
# Explícito y no sólo vía el prebuild de package.json: si alguien cambia los
# scripts de npm, el build tiene que seguir fallando acá y no producir una
# imagen sin cliente generado.
RUN npx prisma generate
RUN npm run build

# Imagen de migración: el CLI de Prisma no está en la de runtime, que sale del
# output standalone y no lleva devDependencies. Se buildea del mismo SHA que la
# app, así que las migraciones que corren son exactamente las del código que se
# está promoviendo.
FROM node:24-alpine AS migrate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

ARG GIT_SHA
RUN test -n "$GIT_SHA" || { \
    echo "ERROR: falta --build-arg GIT_SHA=\$(git rev-parse --short HEAD)."; \
    exit 1; \
    }
ENV GIT_SHA=$GIT_SHA

# Sin CMD por defecto a propósito: quien la corre dice qué comando quiere
# (`migrate deploy`, `migrate status`, `migrate diff`), y así una corrida
# accidental sin argumentos no aplica nada.
ENTRYPOINT ["npx", "prisma"]

# runtime va ÚLTIMA, y no es cosmético: `docker build` sin `--target` buildea la
# ÚLTIMA etapa del archivo, así que el default tiene que ser lo que se promueve
# a producción. Cuando `migrate` quedó al final, un build sin `--target` etiquetó
# el CLI de Prisma como `arandano-app:<sha>` — 1,36 GB con ENTRYPOINT `npx
# prisma`, listo para promoverse. Los builds igual pasan `--target` explícito;
# esto es la segunda defensa, para que olvidarlo no sea catastrófico.
# Agregar etapas DESPUÉS de esta vuelve a abrir el mismo agujero.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Usuario no-root: si alguien escapa del proceso, no arranca como root.
RUN addgroup -g 1001 -S arandano && adduser -u 1001 -S arandano -G arandano

# Sólo el output standalone: sin código fuente ni devDependencies.
COPY --from=build --chown=arandano:arandano /app/.next/standalone ./
COPY --from=build --chown=arandano:arandano /app/.next/static ./.next/static
COPY --from=build --chown=arandano:arandano /app/public ./public

# GIT_SHA es obligatorio: sin default. Una imagen que no sabe qué código
# lleva y lo disimula con un valor tipo "dev" es peor que un build que falla
# — ese es justo el dato que alguien lee a las 11 de la noche para saber qué
# corre en producción.
ARG GIT_SHA
RUN test -n "$GIT_SHA" || { \
    echo "ERROR: falta --build-arg GIT_SHA=\$(git rev-parse --short HEAD)."; \
    echo "El build no continúa sin saber qué código está empaquetando."; \
    exit 1; \
    }
ENV GIT_SHA=$GIT_SHA

USER arandano
EXPOSE 3000
CMD ["node", "server.js"]
