# Runbook: los tres stacks

| Stack | Levantar | Escucha en |
|---|---|---|
| dev | `docker compose -f docker/compose.dev.yml up -d` | `http://100.64.81.63:3000` |
| stage | `IMAGE_TAG=<sha> docker compose -f docker/compose.stage.yml up -d` | `http://100.64.81.63:3001` |
| prod | `cd /srv/arandano/prod && docker compose up -d` | `https://<ip-pública>` (hoy sólo `https://localhost`, ver más abajo) |

## Reglas

- **Cuidado con `down -v` desde el workspace.** Los tres compose declaran `name:`, así que `-f` solo ya resuelve el proyecto correcto y `-p` es redundante. El riesgo real es otro: `docker compose -f docker/compose.prod.yml down -v`, tipeado desde `/root/arandano`, apunta a **los volúmenes de producción** — `arandano-prod_pgdata` incluido. Es un archivo de dev que borra datos de clientes. Antes de cualquier `down -v`, mirar **qué compose** dice el `-f`, no desde qué directorio se está corriendo.
- **`arandano-dev` se frena antes de que arranque el BUILD**, no antes de stage. La memoria no cierra de otra forma: prod (3200 MiB) + dev (2304) + el build (2048) + ~1.1 GB de sistema ≈ 8.5 GB sobre una caja de 7.6 GB. Con dev abajo el pico queda en ~7.5 GB, que es el número que documenta el presupuesto. Como el build es el primer paso del deploy y stage viene después, frenar dev al principio también cubre la regla vieja de que dev y stage no corren juntos (sus límites de CPU sumados pasan de un core: dev 0.75 + 0.25, stage 0.5 + 0.25). Se vuelve a levantar `arandano-dev` recién al terminar el deploy. `deploy.sh` todavía no existe (ver bloqueantes en `CLAUDE.md`); hasta que esté escrito, esta secuencia es manual.
- Producción no se edita: se corre una imagen. Nada de editores en `/srv/arandano/prod/` — ese directorio sólo tiene `docker-compose.yml`, `.env`, el `Caddyfile` y los volúmenes, sin código fuente.
- Buildear siempre con el presupuesto de recursos puesto (ver la sección de abajo — el comando importa, las banderas "obvias" no hacen nada):

  ```bash
  docker build \
    --cgroup-parent=arandanobuild.slice \
    --resource memory=2g --resource cpu-quota=100000 \
    --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
    -t arandano-app:$(git rev-parse --short HEAD) .
  ```

## `arandano-stage`: el Postgres es efímero por diseño

`arandano-stage` corre la imagen ya buildeada — nunca se rebuildea para esto — contra un Postgres propio en `tmpfs`, no contra la base de `arandano-dev`. Dos motivos:

- **Aislamiento**: la base de dev suele tener trabajo en curso; correr el smoke test ahí lo contaminaría (y viceversa).
- **Estado conocido**: cada corrida de stage arranca de una base vacía, que es justo lo que valida que una migración funcione de punta a punta, no que "funcione porque ya estaba parcialmente aplicada".

Se levanta pasando el tag de la imagen a probar — `IMAGE_TAG` es el SHA corto con el que se buildeó (no existe un tag `latest`: `IMAGE_TAG` es obligatorio, `compose.stage.yml` no arranca sin él). Por ejemplo, para probar la misma imagen que hoy corre en prod (`arandano-app:0acc47d`):

```bash
IMAGE_TAG=0acc47d docker compose -f docker/compose.stage.yml up -d
```

Y se tira abajo con `-v`, siempre — dejar el volumen vivo entre corridas contradice el propósito de arrancar de un estado conocido:

```bash
docker compose -f docker/compose.stage.yml -p arandano-stage down -v
```

Como el `tmpfs` vive en RAM, `down -v` no deja nada residual en disco; el estado desaparece apenas el contenedor se detiene.

## El presupuesto de recursos del build: qué anda y qué no

El build es el consumidor más grande del presupuesto (2 GiB y un core entero), corre en **cada deploy**, y compite con clientes reales sobre 2 vCPU. Las banderas que uno esperaría usar para capearlo **no hacen nada sobre esta máquina**, y lo peor es que fallan en silencio:

| Mecanismo | Qué pasa en realidad |
|---|---|
| `nice -n 15 docker build …` | Inerte. `nice` baja la prioridad del **cliente** de la CLI. El trabajo real lo corre BuildKit embebido dentro de `dockerd` (driver `docker`), así que los procesos del build heredan la prioridad de `dockerd`. |
| `docker build --cpuset-cpus=0 --memory=2g …` | Inerte. `docker build` hoy es `docker buildx build`, y su lista de banderas **no tiene** ni `--cpuset-cpus` ni `--memory`. Tampoco las rechaza: `docker build --cpuset-cpus=999 --memory=1 <ctx>` — 999 cores sobre una caja de 2, 1 byte de RAM — sale con **0** y sin un solo warning. |

Lo que sí ata, verificado leyendo el límite **desde adentro** de un build:

- `--resource memory=2g --resource cpu-quota=100000` fija el límite de cada contenedor de `RUN`.
- `--cgroup-parent=arandanobuild.slice` mete el árbol entero del build dentro del slice de systemd que crea `scripts/setup-host.sh`, que es el **techo agregado**: un multi-stage puede correr etapas en paralelo y, sin el slice, cada una se llevaría su propio `--resource` completo.

```
#5 [2/2] RUN echo "memory.max = $(cat /sys/fs/cgroup/memory.max)" && ...
#5 0.264 memory.max = 2147483648
#5 0.265 cpu.max    = 100000 100000
```

**El nombre del slice no lleva guiones a propósito.** systemd lee el guion como jerarquía: `arandano-build.slice` colgaría de `arandano.slice` y su cgroup real viviría en `/sys/fs/cgroup/arandano.slice/arandano-build.slice`, que **no** es la ruta que resuelve `--cgroup-parent=arandano-build.slice`. En ese caso Docker crea un cgroup crudo homónimo en el tope, sin ningún límite, y el build corre libre aparentando estar en el slice. Sin guion las dos rutas son la misma (`/sys/fs/cgroup/arandanobuild.slice`) y no hay ambigüedad posible.

Y por eso el slice va `enable`ado, no sólo `start`ado: si no está activo cuando arranca un build, Docker crea el cgroup igual y el build queda sin capar, sin avisar. `scripts/verify-infra.sh build` comprueba las dos mitades contra un build real, así que un slice caído se detecta en vez de suponerse.

## Buildear la imagen: `GIT_SHA` es obligatorio

La imagen se tagea con el SHA corto de git, y el Dockerfile falla el build si no se lo pasa — a propósito, no es un bug:

```bash
docker build \
  --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  -t arandano-app:$(git rev-parse --short HEAD) .
```

Sin este argumento no hay forma de que `/api/health` reporte qué código está corriendo, y ese dato es el que distingue "la app respondió" de "la app que se esperaba respondió". `deploy.sh` también debe negarse a arrancar el build si el working tree está sucio (`git diff --quiet`): buildear con cambios sin commitear tagea la imagen con un SHA que no describe lo que realmente contiene.

## `scripts/setup-host.sh`: la receta de reproducción de la máquina

Es el script que deja el VPS en el estado que estos stacks asumen: swap, Docker instalado desde el repo oficial, rotación de logs a nivel del daemon, `live-restore` y el slice `arandanobuild.slice` que capea los builds. Es **idempotente** — correrlo dos veces no rompe nada, cada paso chequea su propio estado antes de actuar — porque su razón de ser es poder reconstruir el servidor si se pierde, no sólo documentar cómo se armó una vez.

```bash
sudo scripts/setup-host.sh
```

## Verificar que la infra sigue sana

```bash
./scripts/verify-infra.sh all
```

Corre 54 checks en nueve suites (host, app, network, limits, build, isolation, env, logs, stress). Correrlo después de cada deploy — es lo que detecta que alguien aflojó un límite; acordarse no es un mecanismo.

Cada suite se puede correr sola pasándola por nombre (`./scripts/verify-infra.sh build`), que es lo práctico mientras se trabaja: `all` incluye la suite de estrés, y esa frena el Postgres de producción.

**Atención**: la suite de estrés **frena el Postgres de producción brevemente** para simular una caída y confirmar que dev no lo tumba por contención de recursos. Lo reinicia solo al terminar, y un `trap` cubre una interrupción a mitad de camino (Ctrl+C o `TERM`) para que Postgres no quede parado de forma indefinida. Aun así, quien lo corra tiene que saber que el script toca producción — no es sólo un chequeo de lectura, y no debería sorprender que `arandano-prod-postgres-1` aparezca detenido por unos segundos mientras corre.

**No correr dos instancias a la vez.** Los contenedores de prueba ya llevan nombre único por corrida (`arandano-logspam-$$`, `arandano-memhog-$$`, `arandano-cpuhog-$$`), así que dos corridas simultáneas ya no se pisan entre sí. Lo que sigue sin poder solaparse es la suite de estrés: **frena el Postgres de producción**, y dos corridas encimadas pueden dejar una parando la base justo cuando la otra da por sentado que está arriba.

## Certificado de producción, hoy

`arandano.app` todavía resuelve a IPs de parking de AWS, así que el `Caddyfile` de prod sirve únicamente el host `localhost` con `tls internal` (certificado interno, no público). Cuando el DNS del dominio real apunte al servidor, el cutover es agregar un site block nuevo para el dominio con DNS-01, dejando el de `localhost` intacto para diagnóstico local — no reemplazar el bloque existente.
