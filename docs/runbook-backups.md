# Runbook: backups

Sistema de backups de producción: `pg_dump` nocturno cifrado a Hetzner Object
Storage, y una verificación semanal que restaura lo guardado contra una base
descartable. El razonamiento de cada decisión (por qué este mecanismo y no
pgBackRest, por qué el destino queda en el mismo proveedor que el VPS, por qué
dos claves de cifrado, la aritmética de memoria) vive en
`docs/superpowers/specs/2026-08-04-backups-design.md` — este documento no lo
repite, sólo da los comandos.

## 1. Qué hay y dónde

Bucket **`arandano`** en Hetzner Object Storage, locación **hel1
(Helsinki)** — a propósito distinta de Ashburn, donde está el VPS: un
incidente de datacenter en Ashburn se lleva el servidor y no los backups.

Cada corrida de `scripts/backup.sh` sube **cuatro objetos** con el mismo
timestamp UTC (`TS`, formato `AAAA-MM-DDTHH-MM-SSZ`):

| Objeto | Contenido |
|---|---|
| `<prefijo>/db/<TS>-<motivo>.dump.age` | El dump de `pg_dump -Fc` de `arandano_prod`, cifrado con `age` |
| `<prefijo>/db/<TS>-<motivo>.globals.sql.age` | `pg_dumpall --globals-only`: los **roles del cluster** con sus contraseñas, cifrado |
| `<prefijo>/db/<TS>-<motivo>.manifest.json.age` | JSON `{tabla: {previo, posterior}}` — conteo de filas por tabla antes y después del dump, cifrado |
| `<prefijo>/secretos/<TS>.tar.age` | Tar de `.env` y `Caddyfile` de `/srv/arandano/prod`, cifrado |

**Por qué los roles van aparte:** `pg_dump` de una base **no los incluye** —
son objetos de cluster, no de base. Sin ese archivo, restaurar el dump en un
cluster limpio pierde los roles y sus contraseñas (que en esta arquitectura
son la frontera de aislamiento entre tenants), y cualquier `CREATE POLICY … TO
<rol>` de RLS falla con `role "…" does not exist`: `pg_restore` sale con 1 y la
policy no queda. Por eso el archivo de globals **se aplica siempre antes** del
`pg_restore`, en los dos procedimientos de abajo.

`motivo` ∈ `nocturno` (el timer diario) `| pre-migracion` (lo llama
`deploy.sh` antes de `prisma migrate deploy`) `| test` (corridas manuales de
prueba). El objeto de secretos no lleva `motivo` en el nombre, sólo `TS` —
mirar `scripts/lib/backup-comun.sh:nombre_objeto()` si hace falta el detalle
exacto.

Dos prefijos:

- **`prod/`** — el histórico real. Lo escriben `nocturno` y `pre-migracion`.
- **`test/`** — corridas de prueba (`--motivo=test`, y la suite `backup` de
  `verify-infra.sh`). Nunca entra en el histórico real.

Los nombres son ordenables alfabéticamente == cronológicamente, así que
`rclone lsf ... | sort | tail -1` alcanza para encontrar el más reciente.

**Retención por regla de ciclo de vida del bucket, no por el script:**
`prod/` 30 días, `test/` 2 días, multipart abortados 7 días. **`backup.sh` no
borra nada nunca**, y ése es el punto: la regla vive en el bucket para que el
script no NECESITE permiso de borrado, y así un backup que falla todas las
noches no pueda ir comiéndose el histórico un día por vez.

**Lo que eso no significa.** La credencial que vive en
`/etc/arandano/backup.env` **sí puede borrar** (comprobado contra el bucket
real), el bucket **no tiene versionado ni object lock**, y **no hay bucket
policy** que restrinja nada. Alguien con root en el VPS lee ese archivo y
vacía los 30 días de histórico sin dejar nada que recuperar. Este sistema
resiste **perder** el servidor; no resiste que alguien lo **tome**.

**Mitigación posible, hoy NO implementada** — es una decisión del dueño, no
del script: activar versionado en el bucket y hacer que la regla de ciclo de
vida expire las *versiones no actuales* (un borrado deja la versión anterior
recuperable durante la ventana de retención), o darle al servidor una
credencial sin `DeleteObject`, dejando el borrado exclusivamente en manos de
la regla. Cualquiera de las dos cierra el agujero; mientras ninguna esté
puesta, este documento no debe decir que el histórico está protegido de un
compromiso de root.

## 2. Las dos claves

Cada backup se cifra con `age` para dos destinatarios. Sin la que falta, el
backup **no se puede leer** — no hay una tercera vía.

| Clave | Pública | Privada | Quién la usa |
|---|---|---|---|
| **Custodia** | `/etc/arandano/age-recipients.txt` (0644) | **Fuera del servidor**, en poder del dueño: gestor de contraseñas + copia offline | Sólo una restauración real de emergencia (sección 3) |
| **Verificación** | `/etc/arandano/age-recipients.txt` (0644) | `/etc/arandano/age-verify.key` (0600), **en el servidor** | `scripts/verify-backup.sh`, automático, todos los domingos |

**Perder la privada de custodia es irreversible.** No hay forma de recuperar
el contenido de un backup sin ella si además se pierde el acceso al
servidor (que tiene la de verificación, pero verificación sola no alcanza
para leer nada sin la de custodia — ver el spec, sección *Cifrado y
custodia de claves*, para por qué son dos y no una). Por eso vive en dos
lugares que no fallen juntos, y nunca en el VPS.

## 3. Verificar a mano que un backup sirve

Esto es una **comprobación**, no una reconstrucción: baja el backup, lo
restaura en un contenedor descartable y compara los conteos. Sirve para
responder "¿este backup está entero?" y para probar la clave de custodia. Si lo
que hace falta es **volver a tener servicio**, saltar a la sección 4 — este
procedimiento no deja nada levantado.

Desde una **máquina limpia**, no el servidor — es exactamente el escenario
para el que existe la clave de custodia.

```bash
# 1. Instalar age, rclone, jq (Paso 6 la usa) y Docker (Pasos 5-6 restauran
#    adentro de un contenedor)
sudo apt-get update && sudo apt-get install -y age rclone jq docker.io   # Debian/Ubuntu
# brew install age rclone jq --cask docker                                # macOS (o Docker Desktop)

# 2. Configurar el remoto "hetzner" por variables de entorno, con una
#    credencial de sólo lectura del bucket (Hetzner Cloud Console →
#    Object Storage → arandano → credenciales).
export RCLONE_CONFIG_HETZNER_TYPE=s3
export RCLONE_CONFIG_HETZNER_PROVIDER=Other
export RCLONE_CONFIG_HETZNER_ENDPOINT=https://hel1.your-objectstorage.com
export RCLONE_CONFIG_HETZNER_REGION=hel1
# OBLIGATORIO. Hetzner Object Storage sólo acepta direccionamiento
# virtual-hosted. Sin esto (o en `true`), TODA operación de bucket —listar,
# bajar, HEAD— da 403 y se lee como "credencial sin permisos". No lo es: es
# esta variable. La trampa que más tiempo hace perder de todo este sistema.
export RCLONE_CONFIG_HETZNER_FORCE_PATH_STYLE=false
export RCLONE_CONFIG_HETZNER_ACCESS_KEY_ID=<access-key-de-sólo-lectura>
export RCLONE_CONFIG_HETZNER_SECRET_ACCESS_KEY=<secret-key-de-sólo-lectura>

# 3. Encontrar y bajar el backup más reciente (o uno puntual del listado)
rclone lsf "hetzner:arandano/prod/db/" --include '*.dump.age' | sort | tail -1

ULTIMO=$(rclone lsf "hetzner:arandano/prod/db/" --include '*.dump.age' | sort | tail -1)
BASE="${ULTIMO%.dump.age}"                      # <TS>-<motivo>
TS="$BASE"; for m in nocturno pre-migracion test; do TS="${TS%-$m}"; done

rclone copyto "hetzner:arandano/prod/db/$ULTIMO"                  ./dump.age
rclone copyto "hetzner:arandano/prod/db/$BASE.globals.sql.age"   ./globals.sql.age
rclone copyto "hetzner:arandano/prod/db/$BASE.manifest.json.age" ./manifest.json.age
rclone copyto "hetzner:arandano/prod/secretos/$TS.tar.age"       ./secretos.tar.age

# 4. Descifrar con la clave de CUSTODIA (no la de verificación — esa
#    privada nunca sale del servidor y no sirve para esto)
age -d -i arandano-custodia.key -o dump          ./dump.age
age -d -i arandano-custodia.key -o globals.sql   ./globals.sql.age
age -d -i arandano-custodia.key -o manifest.json ./manifest.json.age
age -d -i arandano-custodia.key -o secretos.tar  ./secretos.tar.age

# 5. Levantar el destino y ESPERAR al servidor DEFINITIVO antes de restaurar.
#    postgres:17-alpine arranca un servidor temporal para correr los scripts
#    de init, lo apaga, y recién ahí levanta el definitivo. pg_isready
#    contesta igual contra los dos, así que hay que contar la SEGUNDA
#    aparición del log de arranque — reproducido en este repo: la misma
#    secuencia sin esperar cayó una vez en la ventana del apagado, con
#    pg_restore fallando "the database system is shutting down".
docker run -d --name restore-emergencia -e POSTGRES_PASSWORD=x postgres:17-alpine
for _ in $(seq 1 60); do
  n=$(docker logs restore-emergencia 2>&1 | grep -c 'database system is ready to accept connections')
  [[ "$n" -ge 2 ]] && break
  sleep 1
done
[[ "$n" -ge 2 ]] || { echo "no levantó en 60s" >&2; exit 1; }

# 6. Aplicar los ROLES antes del dump. Sin esto, un dump con policies de RLS
#    atadas a un rol de aplicación falla al crear la policy, pg_restore sale
#    con 1 y la policy no queda. El "role already exists" del superusuario del
#    cluster de origen es esperado y se ignora; cualquier otro ERROR no.
docker cp globals.sql restore-emergencia:/tmp/globals.sql
docker exec restore-emergencia psql -U postgres -f /tmp/globals.sql 2>&1 \
  | grep 'ERROR:' | grep -v 'already exists' || echo "globals ok"

docker cp dump restore-emergencia:/tmp/dump
# --no-owner --no-acl SÓLO acá: esto es una verificación sobre un cluster
# ajeno, donde los dueños y los permisos del original no aportan nada y sí
# suman modos de falla. En la reconstrucción real (sección 4) NO van.
docker exec -e PGPASSWORD=x restore-emergencia \
  pg_restore --no-owner --no-acl -U postgres -d postgres /tmp/dump

# 7. Verificar contra el manifiesto: cada tabla restaurada tiene que caer
#    entre sus dos conteos (previo/posterior) — mismo chequeo que hace
#    verify-backup.sh cada domingo.
while IFS=$'\t' read -r tabla previo posterior; do
  n=$(docker exec -e PGPASSWORD=x restore-emergencia \
    psql -tAq -U postgres -d postgres -c "SELECT count(*) FROM public.\"$tabla\";")
  echo "$tabla: restaurado=$n banda=$previo..$posterior"
done < <(jq -r '.tablas | to_entries[] | "\(.key)\t\(.value.previo)\t\(.value.posterior)"' manifest.json)

# 8. Limpiar TODO lo que se bajó y descifró. Esta sección es sólo una
#    comprobación: no deja nada que conservar, así que acá sí se destruye
#    todo, incluidos .env y Caddyfile si se llegaron a extraer.
docker rm -f restore-emergencia
shred -u dump globals.sql manifest.json secretos.tar \
      dump.age globals.sql.age manifest.json.age secretos.tar.age
```

## 4. Reconstruir el servicio desde cero

Otro objetivo, otro procedimiento: acá el resultado esperado es **un stack de
producción levantado y sirviendo**, no un `pg_restore` que salió 0. Corre sobre
el servidor nuevo, ya con Docker y con el repo clonado en `/root/arandano`.

Los pasos 1 a 4 de la sección 3 son los mismos (instalar herramientas,
configurar el remoto, bajar los cuatro objetos, descifrar con la clave de
custodia). Desde ahí:

```bash
# 5. Recuperar los secretos y ponerlos donde van. Esto es lo PRIMERO que se
#    hace con ellos, y no se destruyen: sin el .env la base restaurada no se
#    puede abrir y el stack no arranca; sin el Caddyfile no hay TLS.
sudo install -d -m 0755 /srv/arandano/prod
tar -xf secretos.tar .env Caddyfile
sudo install -m 0600 .env      /srv/arandano/prod/.env
sudo install -m 0644 Caddyfile /srv/arandano/prod/Caddyfile
sudo install -m 0644 /root/arandano/docker/compose.prod.yml \
                     /srv/arandano/prod/docker-compose.yml

# 6. Levantar SÓLO Postgres, con las credenciales del .env recuperado. El
#    entrypoint crea el cluster y el rol/base que nombra ese archivo.
cd /srv/arandano/prod
docker compose -p arandano-prod up -d postgres
until docker exec arandano-prod-postgres-1 pg_isready -q; do sleep 1; done

# 7. Los roles del cluster, ANTES de los datos. `psql` local por socket, sin
#    contraseña. El "role already exists" del rol que el entrypoint acaba de
#    crear desde el .env es esperado; cualquier OTRO ERROR hay que mirarlo.
set -a; . /srv/arandano/prod/.env; set +a
docker cp globals.sql arandano-prod-postgres-1:/tmp/globals.sql
docker exec arandano-prod-postgres-1 \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/globals.sql 2>&1 \
  | grep 'ERROR:' | grep -v 'already exists' || echo "globals ok"

# 8. Restaurar los datos CON dueño y permisos. Acá NO van --no-owner ni
#    --no-acl: los roles ya existen (paso 7) y lo que se quiere es la base tal
#    cual estaba, con cada objeto perteneciendo a quien pertenecía y con los
#    GRANT puestos. Restaurar sin ellos deja todo con dueño equivocado y sin
#    permisos: las policies de RLS quedan colgando de roles que no mandan
#    sobre nada, y el aislamiento entre tenants deja de existir en silencio.
#
#    --clean --if-exists porque el entrypoint ya creó la base vacía; sin eso,
#    un objeto preexistente (el schema public) hace ruido en el restore.
docker cp dump arandano-prod-postgres-1:/tmp/dump
docker exec arandano-prod-postgres-1 \
  pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/dump

# 9. Verificar contra el manifiesto (mismo bucle que la sección 3, paso 7,
#    contra esta base) y recién ahí levantar el resto del stack.
docker compose -p arandano-prod up -d
curl -sk https://localhost/api/health | jq .

# 10. Limpiar SÓLO lo que no hace falta conservar. `.env` y `Caddyfile` ya
#     están instalados en /srv/arandano/prod/ (paso 5) con sus permisos; lo
#     que se destruye son las COPIAS del directorio de trabajo y los archivos
#     descifrados de la base. Ojo con `shred`: borrar de más acá deja el stack
#     sin poder arrancar.
docker exec arandano-prod-postgres-1 rm -f /tmp/dump /tmp/globals.sql
shred -u dump globals.sql manifest.json secretos.tar \
      dump.age globals.sql.age manifest.json.age secretos.tar.age \
      ./.env ./Caddyfile          # las copias locales, NO las de /srv/arandano/prod/
```

## 5. Cuando el dead man's switch avisa

healthchecks.io tiene un check separado por script (`arandano-backup` y
`arandano-verify-backup`) — si uno se queda callado, revisar en este orden:

```bash
# 1. ¿El timer sigue armado y activo?
systemctl status arandano-backup.timer
systemctl status arandano-verify-backup.timer

# 2. ¿Qué dijo la última corrida?
journalctl -u arandano-backup.service -n 100
journalctl -u arandano-verify-backup.service -n 100

# 3. ¿Qué suite de infraestructura falla? (16 checks: herramientas, permisos,
#    destinatarios de age, alcance del bucket, timers, frescura, retención y
#    profundidad del histórico)
./scripts/verify-infra.sh backup

# 4. Correrlo a mano para ver el error completo, sin esperar al timer.
#    --motivo=test va al prefijo test/: no toca el histórico real y NO pinga
#    el dead man's switch. Eso último es a propósito — si pingara, este paso
#    de diagnóstico apagaría la alarma que lo convocó y prod/db/ se quedaría
#    sin backups nuevos sin que nada volviera a avisar.
./scripts/backup.sh --motivo=test
```

Si el que avisó fue el de verificación, el paso 4 equivalente es
`./scripts/verify-backup.sh` (sin `--motivo`; acepta `--prefijo=test` para
verificar contra el prefijo de prueba en vez del real, y con ese prefijo
tampoco pinga, por lo mismo).

Motivos típicos que esto suele revelar: el Postgres de producción no está
`healthy` (preflight de `backup.sh` aborta antes de tocar nada), el bucket no
responde (credencial rotada sin actualizar `/etc/arandano/backup.env`, ver
sección 6), o alguno de los dos flocks
(`/var/lock/arandano-backup.lock`, `/var/lock/arandano-verify-backup.lock`)
sigue tomado por una corrida anterior que no terminó.

## 6. Rotar las credenciales del bucket

No hace falta reiniciar nada: los dos scripts leen `/etc/arandano/backup.env`
en cada corrida, no lo cachean.

```bash
sudo -e /etc/arandano/backup.env
# Editar RCLONE_CONFIG_HETZNER_ACCESS_KEY_ID y
# RCLONE_CONFIG_HETZNER_SECRET_ACCESS_KEY. El archivo ya es 0600 — no hace
# falta volver a correr chmod si sólo se edita el contenido.

./scripts/verify-infra.sh backup
# "el bucket responde con la credencial del host" tiene que dar ok. Si no,
# la credencial nueva todavía no tiene permisos sobre el bucket, o
# RCLONE_CONFIG_HETZNER_FORCE_PATH_STYLE se perdió en la edición (ver la
# trampa de la sección 3).
```

## 7. Qué NO cubre esto

Explícito, para que no se confunda con un olvido:

- **No hay PITR (recuperación a un punto en el tiempo).** El grano es el
  día: lo que se pierde entre el último backup y el incidente, se pierde.
- **No hay réplica en un segundo proveedor.** Los backups viven en la misma
  cuenta de Hetzner que el VPS — riesgo asumido a conciencia, no un
  descuido. Ver el spec, sección *Riesgo asumido a conciencia: destino en el
  mismo proveedor*, para el razonamiento y la salida (Backblaze B2) si algún
  día deja de ser aceptable.
- Tampoco cubre backups de `arandano-dev` ni `arandano-stage` — dev es seed
  sintético y stage es efímero por diseño, no hay nada que perder ahí.

Detalle completo de lo que queda fuera de alcance:
`docs/superpowers/specs/2026-08-04-backups-design.md`, sección *Fuera de
alcance*.

## Pendiente: prueba de la clave de custodia

**Esto todavía NO se hizo.** Es un requisito del spec, no un nice-to-have:
"la clave privada de custodia se prueba una vez, a mano, antes del primer
tenant" (spec, sección *Requisitos de custodia*). Una clave de custodia que
nunca se usó tiene exactamente el mismo problema que un backup que nunca se
restauró.

No se puede hacer desde este workspace ni desde este servidor: hace falta la
clave privada de custodia, que por diseño no está en el VPS y no debe
estarlo nunca. Tiene que correrla una persona, en su laptop, con el archivo
de la clave a mano.

Comandos exactos, listos para copiar (usan una credencial de **sólo
lectura** del bucket — no la que vive en `/etc/arandano/backup.env`):

```bash
# Bajar el último backup real con una credencial de sólo lectura
ULT=$(rclone lsf "hetzner:arandano/prod/db/" --include '*.dump.age' | sort | tail -1)
rclone copyto "hetzner:arandano/prod/db/$ULT" ./dump.age
rclone copyto "hetzner:arandano/prod/db/${ULT%.dump.age}.globals.sql.age" ./globals.sql.age

# Descifrar con la clave de CUSTODIA, no con la de verificación
age -d -i arandano-custodia.key -o dump        ./dump.age
age -d -i arandano-custodia.key -o globals.sql ./globals.sql.age

# Restaurar en un Postgres descartable. ESPERAR al servidor DEFINITIVO antes
# de restaurar (postgres:17-alpine apaga un servidor temporal de init antes
# de levantar el real; pg_isready no distingue uno de otro — ver sección 3,
# Paso 5, para el porqué completo).
docker run -d --name prueba-custodia -e POSTGRES_PASSWORD=x postgres:17-alpine
for _ in $(seq 1 60); do
  n=$(docker logs prueba-custodia 2>&1 | grep -c 'database system is ready to accept connections')
  [[ "$n" -ge 2 ]] && break
  sleep 1
done
[[ "$n" -ge 2 ]] || { echo "no levantó en 60s" >&2; exit 1; }

# Los roles primero, por lo mismo que en las secciones 3 y 4
docker cp globals.sql prueba-custodia:/tmp/globals.sql
docker exec prueba-custodia psql -U postgres -f /tmp/globals.sql 2>&1 \
  | grep 'ERROR:' | grep -v 'already exists' || echo "globals ok"

docker cp dump prueba-custodia:/tmp/dump
docker exec -e PGPASSWORD=x prueba-custodia \
  pg_restore --no-owner --no-acl -U postgres -d postgres /tmp/dump
docker exec -e PGPASSWORD=x prueba-custodia psql -U postgres -c '\dt'

# Limpiar
docker rm -f prueba-custodia
shred -u dump globals.sql dump.age globals.sql.age
```

Esperado: el `pg_restore` sale con 0.

**Fecha en que se hizo esta prueba: _____________** (completar acá cuando
se corra; no marcar este pendiente como resuelto en ningún otro lugar hasta
que esta línea tenga fecha).
