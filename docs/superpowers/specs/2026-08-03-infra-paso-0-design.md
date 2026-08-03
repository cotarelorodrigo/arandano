# Infra paso 0 — máquina base y stacks Compose

> **Nota (renombre posterior):** el proyecto se renombró de NegocioFácil a Arándano después de escrito este documento. Los identificadores que aparecen acá (`negociofacil`, `ngf-*`, `NGF_*`, `negociofacil.com`, etc.) reflejan los nombres en uso al momento de escribirlo y se conservan sin cambios como registro histórico.

**Fecha:** 2026-08-03
**Estado:** aprobado, pendiente de plan de implementación

## Objetivo

Dejar el VPS con la separación estructural entre desarrollo y producción que exige CLAUDE.md, y con algo real corriendo en ambos stacks. Al terminar este ciclo hay una app Next.js mínima con healthcheck de contenido real, containerizada, corriendo en tres stacks Compose aislados entre sí, con límites de recursos verificados por un script re-ejecutable.

Es el primero de tres sub-proyectos del paso 0 de infraestructura. Los otros dos —backups con restore verificado, y `deploy.sh`— son ciclos posteriores, en ese orden, porque `deploy.sh` depende de que los backups existan.

## Contexto

El servidor está vacío: sin Docker, sin swap, `/srv` sin contenido, y el repo tiene sólo `CLAUDE.md` y un `README.md`. El DNS de `negociofacil.com` sigue apuntando al parking de AWS.

CLAUDE.md ya cerró las decisiones de fondo: un solo VPS de 2 vCPU y 8 GB donde dev y producción conviven de forma permanente, producción como imagen tageada que se corre desde `/srv/negociofacil/prod/` sin código fuente, dev accesible sólo por Tailscale, y los límites de recursos como única defensa entre un build y un cliente caído.

## Decisiones tomadas en el brainstorming

**Alcance recortado a máquina + stacks corriendo.** El paso 0 completo son cuatro subsistemas, y los dos últimos (backups, `deploy.sh`) no se pueden probar sin una app. Se corta después de tener los stacks levantados con algo real adentro.

**El healthcheck arranca con dos checks y crece.** CLAUDE.md exige cuatro (app, Postgres, query filtrada por tenant, pg-boss), pero no existen ni el modelo `Tenant` ni pg-boss, y definir el schema del núcleo es su propio ciclo. Se escribe como lista extensible con app + Postgres reales, y completarla queda como requisito bloqueante antes del primer deploy real. Nada en este ciclo depende todavía de los cuatro checks, porque `deploy.sh` viene después.

**Tres stacks, no dos.** CLAUDE.md le da a `ngf-dev` dos roles: workspace con hot reload, y destino de los smoke tests de la imagen ya buildeada. Se separan: `ngf-stage` corre la imagen contra un Postgres efímero en tmpfs. El smoke test no pisa la base donde hay trabajo en curso, y empezar de un estado conocido es justamente lo que valida una migración.

**Prod gana CPU por peso, dev por cap duro.** Prod sin cap y con `cpu_shares` alto aprovecha los dos cores cuando dev está quieto —de noche, que es cuando se deploya— y el kernel se la da bajo contención. Dev, stage y los builds con cap duro. Memoria con límite duro en todos, sin excepción.

## Diseño

### 1. Preparación de la máquina

**Swap:** swapfile de 4 GB en `/swapfile`, persistido en `/etc/fstab`, con `vm.swappiness=10`. El valor bajo es deliberado: la swap absorbe el pico de un build, no habilita al kernel a paginar Postgres de forma proactiva.

**Docker:** desde el repositorio oficial de Docker, no el de Ubuntu (`docker-ce` + `docker-compose-plugin`).

`/etc/docker/daemon.json`:

- Rotación de logs como default global (`max-size: 10m`, `max-file: 3`). A nivel daemon, no sólo en cada compose: un contenedor levantado a mano tampoco puede llenar el disco.
- `live-restore: true`, para que reiniciar el daemon no tire los contenedores de producción.

### 2. Esqueleto de la app

Next.js App Router + TypeScript, lo mínimo para que haya algo real que containerizar.

**`app/api/health/route.ts`** es una lista de checks, no un endpoint monolítico. Cada entrada tiene nombre y una función con timeout propio. Hoy son dos:

- `app` — el handler ejecuta y devuelve el SHA de la imagen y el uptime del proceso. Verifica que la app arrancó de verdad, no sólo que hay algo escuchando en el puerto.
- `postgres` — `SELECT 1` con timeout de 2 s.

Devuelve 200 con el detalle de cada check, o 503 identificando cuál falló. `export const dynamic = 'force-dynamic'`: un healthcheck cacheado es un healthcheck que miente.

Sumar los checks de `tenant` y `pg-boss` cuando existan esas piezas es agregar dos entradas al array. Es el punto de extensión que le va a dar criterio al rollback automático.

**`Dockerfile`** multi-stage: deps → build (`next build` con `output: 'standalone'`) → runtime sobre `node:24-alpine`, usuario no-root, sin código fuente ni devDependencies en la imagen final.

**Página `/`** que muestra el nombre del stack y el SHA de la imagen. Es la verificación humana más barata para saber qué corre dónde.

### 3. Los tres stacks

| Stack | Proyecto | Servicios | Escucha en | Postgres |
|---|---|---|---|---|
| dev | `ngf-dev` | app (bind mount, `next dev`), postgres | `100.64.81.63:3000` | volumen `ngf-dev_pgdata` |
| stage | `ngf-stage` | app (imagen buildeada), postgres | `100.64.81.63:3001` | tmpfs, efímero |
| prod | `ngf-prod` | app (imagen), postgres, caddy | `0.0.0.0:80/443` | volumen `ngf-prod_pgdata` |

Proyectos Compose distintos, así que cada uno tiene su red y sus volúmenes prefijados por proyecto. Un `docker compose -p ngf-dev down -v` es estructuralmente incapaz de tocar `ngf-prod_pgdata`.

Los compose files viven en el repo (`docker/compose.{dev,stage,prod}.yml`). El de prod se copia a `/srv/negociofacil/prod/` junto con su `.env`, sin código fuente. En este ciclo esa copia es manual; la automatiza `deploy.sh` en el ciclo 3.

Los puertos de dev y stage se publican atados a `100.64.81.63`, no a `0.0.0.0`. Importa porque Docker escribe reglas de iptables que se saltean ufw: el bind explícito a la IP de Tailscale es la defensa real, no el firewall.

Caddy corre con certificado interno mientras el DNS siga en el parking de AWS. El wildcard por DNS-01 queda para cuando se apunte el dominio.

**Credenciales separadas desde el arranque.** Cada stack tiene su archivo de entorno con credenciales de Postgres distintas: `.env.dev` en el repo (gitignoreado, con un `.env.example` versionado al lado), y `.env.prod` únicamente en `/srv/negociofacil/prod/` con permisos `600`. Que las credenciales sean distintas desde el primer día evita que una cadena de conexión copiada por error apunte a la base equivocada — el tipo de accidente que en este ciclo es inocuo y con clientes adentro no lo es.

### 4. Presupuesto de recursos

| Contenedor | CPU | Memoria |
|---|---|---|
| prod app | sin cap, `cpu_shares: 1024` | 1.5 GB |
| prod postgres | sin cap, `cpu_shares: 1024`, `oom_score_adj: -500` | 1.5 GB |
| prod caddy | sin cap, `cpu_shares: 1024` | 128 MB |
| dev app | `cpus: 0.75`, `cpu_shares: 256` | 1.5 GB |
| dev postgres | `cpus: 0.25`, `cpu_shares: 256` | 768 MB |
| stage app | `cpus: 0.5`, `cpu_shares: 128` | 768 MB |
| stage postgres | `cpus: 0.25`, `cpu_shares: 128` | 512 MB |
| builds | `nice -n 15`, `--cpus=1 --memory=2g` | 2 GB |

Se usan las claves de Compose no-swarm (`cpus`, `cpu_shares`, `mem_limit`) y no `deploy.resources`, para que los límites apliquen sin depender del modo swarm.

**Dev y stage no corren juntos.** Sus caps sumados pasarían de un core, así que un deploy frena `ngf-dev` primero y stage hereda su presupuesto. Es natural —deployar y desarrollar no ocurren a la vez— y `deploy.sh` lo hará solo.

**La cuenta de memoria queda ajustada, y por eso la swap no es opcional.** Operación normal: 5.4 GB de contenedores más ~1.1 GB de sistema, 6.5 de 7.6 GB. Durante un deploy con build: ~7.5 GB. La swap es exactamente el margen de ese pico.

### 5. Manejo de errores

Cada check del healthcheck tiene timeout propio y falla aislado: que Postgres no responda da 503 con el detalle, no un cuelgue de 30 s.

Postgres arranca con `healthcheck` de Compose y la app depende de él con `condition: service_healthy`, así que un arranque no queda a medias.

`restart: unless-stopped` en prod. En dev no: un crash tiene que verse, no esconderse detrás de un reinicio.

## Verificación

CLAUDE.md dice que los límites son la única defensa y que "que sigan puestos es parte del checklist de deploy, no algo que se configura una vez y se olvida". Por eso la verificación es **`scripts/verify-infra.sh`, re-ejecutable**, no una checklist manual. Se escribe primero y falla; después se construye la infra hasta que pase. Queda como chequeo de regresión permanente.

| # | Chequeo | Falla que previene |
|---|---|---|
| 1 | `stress-ng` saturando dev, medir latencia de `/api/health` de prod: **p95 por debajo de 500 ms** durante la saturación | Que un build haga que un cliente vea timeouts |
| 2 | Contenedor de dev pidiendo más memoria que su límite: muere por el cgroup (exit 137) y `dmesg` no registra OOM del kernel | Que lo mate el OOM del kernel eligiendo víctima, en vez del cgroup |
| 3 | `docker compose -p ngf-dev down -v`, verificar que `ngf-prod_pgdata` sigue intacto | Borrar la base de un cliente creyendo que se limpia dev |
| 4 | `ss -ltnp` confirma que los puertos de dev y stage escuchan en `100.64.81.63` y no en `0.0.0.0`, y `curl` a la IP pública (`178.156.251.41:3000`) da connection refused | Exponer dev a internet vía las reglas de iptables de Docker |
| 5 | Generar 50 MB de logs en dev, verificar rotación a 3×10 MB | Que dev llene el disco |
| 6 | Matar Postgres de prod, verificar que `/api/health` devuelve 503 con el check en rojo | Un healthcheck que devuelve 200 pase lo que pase |

El chequeo 6 es el que más importa. Los otros cinco prueban que los límites existen; ése prueba que el healthcheck no miente, que es la premisa de todo el mecanismo de deploy que viene después.

## Fuera de alcance

Backups con restore verificado (ciclo 2), `deploy.sh` (ciclo 3), wildcard TLS por DNS-01 y apuntar el DNS, Sentry y el uptime check externo, Prisma y el schema del núcleo.

## Bloqueantes antes del primer tenant real

Se anotan acá para que no se pierdan al cerrar el ciclo:

1. Completar el healthcheck con los checks de tenant y pg-boss.
2. Backups con restore verificado.
3. `deploy.sh` con su gate completo.

## Cambios a hacer en CLAUDE.md al cerrar el ciclo

El diseño se desvía del documento en dos puntos, y un documento desactualizado es peor que no tenerlo:

1. Son tres stacks, no dos. `ngf-stage` con Postgres efímero es nuevo; el documento dice que el smoke test corre contra la base de dev.
2. Un deploy frena `ngf-dev` antes de levantar stage.
