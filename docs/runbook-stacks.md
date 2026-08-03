# Runbook: los tres stacks

| Stack | Levantar | Escucha en |
|---|---|---|
| dev | `docker compose -f docker/compose.dev.yml up -d` | `http://100.64.81.63:3000` |
| stage | `IMAGE_TAG=<sha> docker compose -f docker/compose.stage.yml up -d` | `http://100.64.81.63:3001` |
| prod | `cd /srv/negociofacil/prod && docker compose up -d` | `https://<ip-pública>` (hoy sólo `https://localhost`, ver más abajo) |

## Reglas

- **Nunca** `docker compose down -v` sin `-p` explícito. El nombre del proyecto (`ngf-dev`, `ngf-stage`, `ngf-prod`) es lo que evita que un `down -v` corrido desde el directorio equivocado se lleve puesto un volumen que no es el que se pensaba tocar.
- Dev y stage no corren juntos: sus límites de CPU sumados pasan de un core (dev usa 0.75 + 0.25 del Postgres, stage usa 0.5 + 0.25). Frenar `ngf-dev` antes de levantar `ngf-stage`, y volver a levantar `ngf-dev` al terminar. `deploy.sh` todavía no existe (ver bloqueantes en `CLAUDE.md`); hasta que esté escrito, esta secuencia es manual.
- Producción no se edita: se corre una imagen. Nada de editores en `/srv/negociofacil/prod/` — ese directorio sólo tiene `docker-compose.yml`, `.env`, el `Caddyfile` y los volúmenes, sin código fuente.
- Buildear siempre con CPU limitada:
  `nice -n 15 docker build --cpuset-cpus=0 --memory=2g ...`

## `ngf-stage`: el Postgres es efímero por diseño

`ngf-stage` corre la imagen ya buildeada — nunca se rebuildea para esto — contra un Postgres propio en `tmpfs`, no contra la base de `ngf-dev`. Dos motivos:

- **Aislamiento**: la base de dev suele tener trabajo en curso; correr el smoke test ahí lo contaminaría (y viceversa).
- **Estado conocido**: cada corrida de stage arranca de una base vacía, que es justo lo que valida que una migración funcione de punta a punta, no que "funcione porque ya estaba parcialmente aplicada".

Se levanta pasando el tag de la imagen a probar — `IMAGE_TAG` es el SHA corto con el que se buildeó (no existe un tag `latest`: `IMAGE_TAG` es obligatorio, `compose.stage.yml` no arranca sin él). Por ejemplo, para probar la misma imagen que hoy corre en prod (`ngf-app:0acc47d`):

```bash
IMAGE_TAG=0acc47d docker compose -f docker/compose.stage.yml up -d
```

Y se tira abajo con `-v`, siempre — dejar el volumen vivo entre corridas contradice el propósito de arrancar de un estado conocido:

```bash
docker compose -f docker/compose.stage.yml -p ngf-stage down -v
```

Como el `tmpfs` vive en RAM, `down -v` no deja nada residual en disco; el estado desaparece apenas el contenedor se detiene.

## Buildear la imagen: `GIT_SHA` es obligatorio

La imagen se tagea con el SHA corto de git, y el Dockerfile falla el build si no se lo pasa — a propósito, no es un bug:

```bash
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t ngf-app:$(git rev-parse --short HEAD) .
```

Sin este argumento no hay forma de que `/api/health` reporte qué código está corriendo, y ese dato es el que distingue "la app respondió" de "la app que se esperaba respondió". `deploy.sh` también debe negarse a arrancar el build si el working tree está sucio (`git diff --quiet`): buildear con cambios sin commitear tagea la imagen con un SHA que no describe lo que realmente contiene.

## `scripts/setup-host.sh`: la receta de reproducción de la máquina

Es el script que deja el VPS en el estado que estos stacks asumen: swap, Docker instalado desde el repo oficial, rotación de logs a nivel del daemon y `live-restore`. Es **idempotente** — correrlo dos veces no rompe nada, cada paso chequea su propio estado antes de actuar — porque su razón de ser es poder reconstruir el servidor si se pierde, no sólo documentar cómo se armó una vez.

```bash
sudo scripts/setup-host.sh
```

## Verificar que la infra sigue sana

```bash
./scripts/verify-infra.sh all
```

Corre 32 checks en siete suites (host, app, network, limits, isolation, logs, stress). Correrlo después de cada deploy — es lo que detecta que alguien aflojó un límite; acordarse no es un mecanismo.

**Atención**: la suite de estrés **frena el Postgres de producción brevemente** para simular una caída y confirmar que dev no lo tumba por contención de recursos. Lo reinicia solo al terminar, y un `trap` cubre una interrupción a mitad de camino (Ctrl+C o `TERM`) para que Postgres no quede parado de forma indefinida. Aun así, quien lo corra tiene que saber que el script toca producción — no es sólo un chequeo de lectura, y no debería sorprender que `ngf-prod-postgres-1` aparezca detenido por unos segundos mientras corre.

**No correr dos instancias a la vez.** La suite de logs usa un contenedor de prueba con nombre fijo (`ngf-logspam`), sin sufijo aleatorio. Dos corridas simultáneas del script pisan ese contenedor entre sí y la suite de logs puede fallar con "no se pudo leer el LogPath del contenedor de prueba" — no es una falla de la infra, es una corrida concurrente del propio script.

## Certificado de producción, hoy

`negociofacil.com` todavía resuelve a IPs de parking de AWS, así que el `Caddyfile` de prod sirve únicamente el host `localhost` con `tls internal` (certificado interno, no público). Cuando el DNS del dominio real apunte al servidor, el cutover es agregar un site block nuevo para el dominio con DNS-01, dejando el de `localhost` intacto para diagnóstico local — no reemplazar el bloque existente.
