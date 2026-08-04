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

Cada corrida de `scripts/backup.sh` sube **tres objetos** con el mismo
timestamp UTC (`TS`, formato `AAAA-MM-DDTHH-MM-SSZ`):

| Objeto | Contenido |
|---|---|
| `<prefijo>/db/<TS>-<motivo>.dump.age` | El dump de `pg_dump -Fc` de `arandano_prod`, cifrado con `age` |
| `<prefijo>/db/<TS>-<motivo>.manifest.json.age` | JSON `{tabla: {previo, posterior}}` — conteo de filas por tabla antes y después del dump, cifrado |
| `<prefijo>/secretos/<TS>.tar.age` | Tar de `.env` y `Caddyfile` de `/srv/arandano/prod`, cifrado |

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
borra nada nunca** — la credencial que vive en el servidor ni siquiera tiene
permiso de borrado, así que alguien que tome el VPS no puede vaciar el
histórico.

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

## 3. Restaurar a mano en una emergencia

Desde una **máquina limpia**, no el servidor — es exactamente el escenario
para el que existe la clave de custodia.

```bash
# 1. Instalar age y rclone
sudo apt-get update && sudo apt-get install -y age rclone   # Debian/Ubuntu
# brew install age rclone                                   # macOS

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

rclone copyto "hetzner:arandano/prod/db/$ULTIMO"                 ./dump.age
rclone copyto "hetzner:arandano/prod/db/$BASE.manifest.json.age" ./manifest.json.age
rclone copyto "hetzner:arandano/prod/secretos/$TS.tar.age"       ./secretos.tar.age

# 4. Descifrar con la clave de CUSTODIA (no la de verificación — esa
#    privada nunca sale del servidor y no sirve para esto)
age -d -i arandano-custodia.key -o dump          ./dump.age
age -d -i arandano-custodia.key -o manifest.json ./manifest.json.age
age -d -i arandano-custodia.key -o secretos.tar  ./secretos.tar.age

# 5. Restaurar la base. --no-owner --no-acl si el destino no tiene los
#    mismos roles que producción (por ejemplo, un Postgres descartable de
#    prueba); sin esas banderas si el destino sí los tiene y hace falta
#    preservarlos.
docker run -d --name restore-emergencia -e POSTGRES_PASSWORD=x postgres:17-alpine
docker cp dump restore-emergencia:/tmp/dump
docker exec -e PGPASSWORD=x restore-emergencia \
  pg_restore --no-owner --no-acl -U postgres -d postgres /tmp/dump

# 6. Recuperar .env y Caddyfile del tar de secretos
tar -xf secretos.tar .env Caddyfile
# quedan en el directorio actual; van a /srv/arandano/prod/ del servidor
# reconstruido.

# 7. Limpiar lo descifrado — no debe quedar en claro en disco
shred -u dump manifest.json secretos.tar dump.age manifest.json.age secretos.tar.age .env Caddyfile
```

El manifiesto sirve para chequear que la restauración trajo lo esperado: cada
tabla debe caer entre sus dos conteos (`previo` y `posterior`) — es la misma
comparación que hace `verify-backup.sh` cada domingo, ver
`scripts/lib/backup-comun.sh:conteo_en_banda()`.

## 4. Cuando el dead man's switch avisa

healthchecks.io tiene un check separado por script (`arandano-backup` y
`arandano-verify-backup`) — si uno se queda callado, revisar en este orden:

```bash
# 1. ¿El timer sigue armado y activo?
systemctl status arandano-backup.timer
systemctl status arandano-verify-backup.timer

# 2. ¿Qué dijo la última corrida?
journalctl -u arandano-backup.service -n 100
journalctl -u arandano-verify-backup.service -n 100

# 3. ¿Qué suite de infraestructura falla? (15 checks: herramientas, permisos,
#    destinatarios de age, alcance del bucket, timers, frescura, retención)
./scripts/verify-infra.sh backup

# 4. Correrlo a mano para ver el error completo, sin esperar al timer.
#    --motivo=test va al prefijo test/, no toca el histórico real.
./scripts/backup.sh --motivo=test
```

Si el que avisó fue el de verificación, el paso 4 equivalente es
`./scripts/verify-backup.sh` (sin `--motivo`; acepta `--prefijo=test` para
verificar contra el prefijo de prueba en vez del real).

Motivos típicos que esto suele revelar: el Postgres de producción no está
`healthy` (preflight de `backup.sh` aborta antes de tocar nada), el bucket no
responde (credencial rotada sin actualizar `/etc/arandano/backup.env`, ver
sección 5), o el flock (`/var/lock/arandano-backup.lock`) sigue tomado por
una corrida anterior que no terminó.

## 5. Rotar las credenciales del bucket

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

## 6. Qué NO cubre esto

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

# Descifrar con la clave de CUSTODIA, no con la de verificación
age -d -i arandano-custodia.key -o dump ./dump.age

# Restaurar en un Postgres descartable
docker run -d --name prueba-custodia -e POSTGRES_PASSWORD=x postgres:17-alpine
docker cp dump prueba-custodia:/tmp/dump
docker exec -e PGPASSWORD=x prueba-custodia \
  pg_restore --no-owner --no-acl -U postgres -d postgres /tmp/dump
docker exec -e PGPASSWORD=x prueba-custodia psql -U postgres -c '\dt'

# Limpiar
docker rm -f prueba-custodia
shred -u dump dump.age
```

Esperado: el `pg_restore` sale con 0.

**Fecha en que se hizo esta prueba: _____________** (completar acá cuando
se corra; no marcar este pendiente como resuelto en ningún otro lugar hasta
que esta línea tenga fecha).
