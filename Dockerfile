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

# scripts/ y lib/ viajan en esta imagen para que el gate pueda correr el alta
# de tenant sobre la red de stage: el Postgres de ese stack no publica puerto,
# así que el script no se puede correr desde el host. `lib/` entra entero y no
# sólo el archivo que se importa: acotarlo obliga a acordarse de ampliarlo cada
# vez que el script comparta un módulo más, y ese olvido rompe el deploy en el
# paso 8 en vez de en el build.
COPY scripts ./scripts
COPY lib ./lib

# El cliente de Prisma generado. Esta etapa no lo tenía, y `.dockerignore`
# excluye `generated` a propósito (es artefacto del host, no del build), así
# que `definir-clave.mts` —que lo arrastra vía lib/db.ts— no podía correr acá
# adentro. El síntoma era el peor de esta familia: el comando funciona para
# quien escribe el código y no para quien opera el producto, incluido el
# tenant canario que el deploy crea en producción y que hay que verificar a
# mano después de cada deploy. Como el Postgres de prod no publica puertos,
# esta imagen es el ÚNICO lugar desde donde se le llega.
#
# Va después de COPY lib porque `prisma generate` escribe en /app/generated/
# (output del generador, ver prisma/schema.prisma) y no depende de scripts/ ni
# de lib/; el orden acá sólo decide qué capa se invalida primero. `generate` no
# se conecta a nada, así que no necesita MIGRATE_DATABASE_URL (ver
# prisma.config.ts).
RUN npx prisma generate

# `tsconfig.json` es lo que `tsx` (deploy.sh, pasos 8 y 14: `--entrypoint npx
# ... tsx scripts/crear-tenant.mts`) lee para resolver el alias `@/` — sin
# este archivo, `tsx` adentro de esta imagen resuelve los imports SIN
# extensión del cliente de Prisma generado (por eso funcionaría igual hoy,
# que `crear-tenant.mts` no usa `@/`) pero NO resuelve `@/` — la misma media
# solución que dejaba `node` pelado antes de Task 11, sólo que un `@/` nuevo
# recién se notaría en el deploy, no en `npm test`. Verificado buildeando
# esta etapa y corriendo el script adentro (ver `docs/runbook-stacks.md`).
COPY tsconfig.json ./

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
