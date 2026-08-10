# Cutover de DNS y certificado wildcard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `arandano.app` y cualquier subdominio de tenant se sirvan con un certificado wildcard emitido y renovado solo, y que el gate del deploy detecte si eso deja de funcionar.

**Architecture:** Una imagen propia de Caddy —construida con `xcaddy` y el módulo `caddy-dns/hetzner/v2`, tageada por versión y no por SHA de git— reemplaza a `caddy:2-alpine`. Un site block nuevo para el dominio real emite `*.arandano.app` por DNS-01, escribiendo registros TXT en la zona de Hetzner con un token que sólo ese contenedor recibe. La primera emisión va contra el staging de Let's Encrypt para validar la cadena sin gastar intentos del límite real, y recién después entran los dos chequeos que hoy le faltan al gate.

**Tech Stack:** Caddy 2.11.4 con `xcaddy`, `caddy-dns/hetzner/v2` (el sufijo importa: v1 habla una API dada de baja), ACME DNS-01, Let's Encrypt (staging y producción), Docker Compose, bash.

**Spec:** `docs/superpowers/specs/2026-08-09-cutover-wildcard-design.md`

## EL BLOQUEO: las Tasks 3 a 6 no se pueden ni empezar sin el DNS delegado

Al escribir este plan, `dig arandano.app` no devuelve nada **y tampoco devuelve NS**. El dominio se compró en DonWeb y el DNS todavía no está delegado a Hetzner.

**Las Tasks 1 y 2 no dependen del DNS** y se pueden hacer ya. **Las Tasks 3 a 6 sí**, y no de forma parcial: Let's Encrypt no puede verificar una zona que no está delegada, así que intentarlo antes no falla con un error útil — falla y consume intentos.

El semáforo es un solo comando:

```bash
dig NS arandano.app
```

Cuando devuelva los nameservers de Hetzner, la delegación está hecha. Hasta entonces, la Task 3 se queda quieta.

## Global Constraints

- Todo comentario, mensaje de commit y texto de salida **en español**, explicando el **porqué** y no el qué.
- **La versión de Caddy vive en un solo lugar**: la constante de `scripts/build-caddy.sh`. Alimenta los dos `FROM` del Dockerfile vía `--build-arg` y el tag de salida.
- **Todo `docker build` de este host va con `--cgroup-parent=arandanobuild.slice --resource memory=2g --resource cpu-quota=100000`.** `nice`, `--cpuset-cpus` y `--memory` son **inertes** en `docker build` sobre esta máquina y no avisan que lo son — es el hallazgo que motivó el slice.
- **El site block `localhost:443` no se toca.** Es por donde el gate del deploy verifica producción.
- **El bloque `:80` sigue siendo `redir … 308`.** Sólo cambia su comentario.
- **`URL_SALUD` no cambia**: sigue en `https://localhost` con la CA interna.
- A Caddy se le pasa **una sola variable de entorno**, nunca el `env_file` de prod: ese archivo tiene la contraseña de Postgres.
- `verify-infra.sh` corre con `set -uo pipefail` **sin `-e`**: cuenta fallas en vez de abortar. Usar los helpers existentes (`ok`, `bad`, `check_cmd`, `check_eq`, `check_ne`, `check_ge`).
- **`|| var=99` y nunca `|| echo 99`** al capturar salidas de `curl`: el `echo` concatena con lo que `curl` ya escribió y el mensaje termina diciendo `099`. El archivo ya documenta ese error.
- Temporales en **`/var/tmp`, nunca `/tmp`** — acá `/tmp` es tmpfs.
- La copia de `docker/Caddyfile` a `/srv/arandano/prod/Caddyfile` es **manual**, y el paso 3 del preflight de `deploy.sh` la verifica. Cambiar el archivo del repo sin copiarlo deja producción indeployable, con el mensaje que lo dice.
- **No correr** `./scripts/verify-infra.sh` sin argumento, con `all` ni con `stress`: la suite `stress` frena el Postgres de producción.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `docker/Dockerfile.caddy` *(nuevo)* | Las dos etapas de `xcaddy`. Sólo eso; la versión llega por `--build-arg`. |
| `scripts/build-caddy.sh` *(nuevo)* | Dueño de la versión. Buildea dentro del slice, tagea, y **verifica que el módulo quedó adentro** antes de dar por buena la imagen. |
| `docker/compose.prod.yml` *(modificado)* | Referencia la imagen propia y pasa la única variable que Caddy necesita. |
| `docker/Caddyfile` *(modificado)* | El site block del dominio real, y el comentario del `:80` que hoy miente. |
| `scripts/verify-infra.sh` *(modificado)* | Tres checks: la imagen trae el módulo, el tag del compose coincide con el que produce el script, y el certificado del dominio real valida contra las CA públicas. |
| `scripts/deploy.sh` *(modificado)* | Un caso más en el paso 16: el dominio real responde con un certificado que un cliente aceptaría. |
| `/srv/arandano/prod/.env` *(fuera del repo)* | `HETZNER_DNS_TOKEN`, 0600. |
| `CLAUDE.md` y `docs/runbook-stacks.md` *(modificados)* | Cierre del bloqueante 1 del cutover y el procedimiento de rotación del token. |

---

### Task 1: La imagen de Caddy con el módulo

**No depende del DNS.** Se puede hacer ya.

**Files:**
- Create: `docker/Dockerfile.caddy`
- Create: `scripts/build-caddy.sh`

**Interfaces:**
- Produces: la imagen `arandano-caddy:2.11.4-hetzner` en el daemon local, y el script que la reconstruye.

- [ ] **Step 1: Escribir el Dockerfile**

Crear `docker/Dockerfile.caddy`:

```dockerfile
# syntax=docker/dockerfile:1

# La versión NO se escribe acá: llega por --build-arg desde
# scripts/build-caddy.sh, que es su único dueño. Repetirla en los dos lugares es
# la forma de que un día el tag diga 2.11.4 sobre un binario 2.12.0.
#
# Va antes del primer FROM porque las dos etapas la usan en su línea `FROM`, y
# un ARG global es lo único que se puede interpolar ahí.
ARG CADDY_VERSION

# La imagen oficial `-builder` trae xcaddy y la cadena de Go ya armadas. Es el
# patrón que documenta el propio proyecto de Caddy para compilar módulos.
FROM caddy:${CADDY_VERSION}-builder AS builder

# El `/v2` NO es opcional: sin sufijo, `caddy-dns/hetzner` resuelve a v1.0.0, que
# habla contra `dns.hetzner.com/api/v1` — la API vieja de Hetzner DNS, ya dada de
# baja (responde 301 hacia console.hetzner.com). La zona real y el token del
# dueño sólo existen contra la API nueva (`api.hetzner.cloud/v1`), que es la que
# habla el módulo v2. Con v1 adentro el build sale con 0 y el guard del Step 2
# sigue pasando —el ID del módulo no cambió entre las dos versiones—, así que el
# error recién aparece en el Step de emisión y parece un token mal configurado.
RUN xcaddy build --with github.com/caddy-dns/hetzner/v2

# El runtime tiene que ser la MISMA versión que el builder. Un binario compilado
# contra una y corriendo sobre otra arranca y falla de formas raras.
FROM caddy:${CADDY_VERSION}-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

- [ ] **Step 2: Escribir el script de build**

Crear `scripts/build-caddy.sh`:

```bash
#!/usr/bin/env bash
# Buildea la imagen propia de Caddy: la oficial no trae ningún módulo de DNS, y
# sin uno no se puede emitir un certificado wildcard — que es lo que hace que un
# tenant nuevo funcione sin esperar una emisión.
#
# Se tagea por VERSIÓN y no por SHA de git, y no la buildea deploy.sh: el proxy
# cambia en su propio ritmo, no en el del código de la app. Un deploy que
# rebuildeara Caddy pagaría un build de Go sobre 2 vCPU por algo que no cambió, y
# el tag quedaría diciendo un SHA que no tiene nada que ver con el proxy.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# EL ÚNICO LUGAR donde vive la versión. Alimenta los dos FROM del Dockerfile y
# el tag de salida.
readonly CADDY_VERSION=2.11.4
readonly IMAGEN="arandano-caddy:${CADDY_VERSION}-hetzner"

echo "buildeando $IMAGEN"

# Las banderas de recursos son las que efectivamente limitan en este host.
# `nice`, `--cpuset-cpus` y `--memory` son INERTES en `docker build` acá y no
# avisan que lo son — el hallazgo que motivó arandanobuild.slice. Ver
# docs/runbook-stacks.md.
docker build \
  --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --build-arg CADDY_VERSION="$CADDY_VERSION" \
  -f docker/Dockerfile.caddy \
  -t "$IMAGEN" .

# Que el build salga con 0 NO significa que el módulo haya quedado adentro: un
# `xcaddy build` que compila pero no registra el plugin produce una imagen que se
# ve idéntica a una buena. La diferencia se descubriría al renovar, o sea 60 días
# después y sin nadie mirando. Por eso se comprueba acá, contra el binario real.
if ! docker run --rm "$IMAGEN" caddy list-modules | grep -q '^dns.providers.hetzner$'; then
  echo "ERROR: $IMAGEN no trae dns.providers.hetzner; el wildcard no se va a poder emitir" >&2
  exit 1
fi

echo "listo: $IMAGEN, con dns.providers.hetzner"
```

```bash
chmod +x scripts/build-caddy.sh
```

- [ ] **Step 3: Buildear y verificar que el módulo está**

Run: `./scripts/build-caddy.sh`
Expected: termina en `listo: arandano-caddy:2.11.4-hetzner, con dns.providers.hetzner`. El build tarda unos minutos: compila Caddy desde fuente.

- [ ] **Step 4: Comprobar que el guard del script detecta una imagen sin el módulo**

Un check que no puede fallar no sirve. Probarlo contra la imagen oficial, que no tiene el módulo:

```bash
docker run --rm caddy:2.11.4-alpine caddy list-modules | grep -c '^dns.providers.hetzner$'
```

Expected: `0`. Confirma que el `grep` del script distingue una imagen buena de una que no lo es, y no matchea cualquier cosa.

- [ ] **Step 5: Comprobar que las dos versiones coinciden**

```bash
docker run --rm arandano-caddy:2.11.4-hetzner caddy version
```

Expected: empieza con `v2.11.4`. Si dijera otra versión, el `--build-arg` no llegó a alguno de los dos `FROM`.

- [ ] **Step 6: Commit**

```bash
git add docker/Dockerfile.caddy scripts/build-caddy.sh
git commit -m "feat(caddy): imagen propia con el módulo de DNS de Hetzner

La oficial no trae ningún dns.providers, y sin uno no hay wildcard: cada tenant
nuevo tendría que esperar una emisión por HTTP-01. El script verifica que el
módulo quedó adentro, porque un xcaddy que compila sin registrarlo produce una
imagen indistinguible de la buena hasta el día de la renovación."
```

---

### Task 2: El token, el compose y los checks de la imagen

**No depende del DNS.** El token tiene que existir, pero todavía no se usa.

**Files:**
- Modify: `/srv/arandano/prod/.env` *(fuera del repo, 0600)*
- Modify: `docker/compose.prod.yml`
- Modify: `scripts/verify-infra.sh` (ampliar `suite_network`)

**Interfaces:**
- Consumes: la imagen `arandano-caddy:2.11.4-hetzner` (Task 1).
- Produces: `HETZNER_DNS_TOKEN` disponible en el contenedor de Caddy; dos checks nuevos en la suite `network`.

- [ ] **Step 1: [HUMANO] Crear el token en Hetzner y ponerlo en el `.env`**

En la consola de Hetzner: **DNS** → la zona `arandano.app` → **API tokens** → crear uno con permiso de escritura sobre esa zona. DNS-01 crea y borra registros TXT en cada renovación, así que sólo lectura no alcanza.

```bash
umask 077
printf 'HETZNER_DNS_TOKEN=%s\n' '<el-token>' >> /srv/arandano/prod/.env
chmod 600 /srv/arandano/prod/.env
grep -c '^HETZNER_DNS_TOKEN=' /srv/arandano/prod/.env
```

Expected: imprime `1`. **No imprimir el valor**: queda en el historial de la shell.

- [ ] **Step 2: Cambiar el servicio `caddy` del compose**

En `docker/compose.prod.yml`, reemplazar `image: caddy:2-alpine` y agregar el bloque de entorno:

```yaml
  caddy:
    # Imagen propia: la oficial no trae dns.providers y sin eso no hay wildcard.
    # Tageada por VERSIÓN y no por SHA — la buildea scripts/build-caddy.sh, no
    # deploy.sh. Si este tag y el del script se desincronizan, el stack levanta
    # una imagen vieja sin que nada avise; suite_network lo comprueba.
    image: arandano-caddy:2.11.4-hetzner
    environment:
      # UNA sola variable, nunca el env_file de prod: ese archivo tiene la
      # contraseña de Postgres y el proxy no tiene ninguna razón para verla.
      # Compose la interpola desde el .env del directorio del proyecto.
      #
      # El `:?` hace que el stack se NIEGUE a levantar sin el token, en vez de
      # arrancar sano y fallar recién al renovar dentro de 60 días. Un misconfig
      # tiene que doler ahora, no en dos meses.
      HETZNER_DNS_TOKEN: ${HETZNER_DNS_TOKEN:?falta HETZNER_DNS_TOKEN en /srv/arandano/prod/.env}
    ports:
      - "80:80"
      - "443:443"
```

El resto del servicio (volúmenes, `cpu_shares`, `mem_limit`, `restart`, `depends_on`) **no cambia**.

- [ ] **Step 3: Escribir los checks que fallan**

Al final de `suite_network()` en `scripts/verify-infra.sh`:

```bash
  # La imagen propia tiene que existir Y traer el módulo. Lo segundo es lo que
  # vale: una imagen buildeada sin el plugin se ve idéntica a una buena, y la
  # diferencia recién aparece al renovar — 60 días después, sin nadie mirando.
  local imagen_caddy modulos
  imagen_caddy=$(grep -oE 'arandano-caddy:[0-9.]+-hetzner' docker/compose.prod.yml | head -1)
  check_ne "compose.prod.yml nombra la imagen propia de Caddy" "" "$imagen_caddy"

  modulos=0
  if [[ -n "$imagen_caddy" ]]; then
    modulos=$(docker run --rm "$imagen_caddy" caddy list-modules 2>/dev/null \
      | grep -c '^dns.providers.hetzner$') || modulos=0
  fi
  check_eq "la imagen de Caddy trae dns.providers.hetzner" "1" "$modulos"

  # El tag vive en dos archivos —el script que la buildea y el compose que la
  # corre— y no hay forma de derivar uno del otro sin parsear bash. Si se
  # desincronizan, producción levanta una imagen vieja y nada lo dice: el
  # síntoma sería una renovación que falla dentro de dos meses.
  local version_script tag_esperado
  version_script=$(grep -oE '^readonly CADDY_VERSION=[0-9.]+' scripts/build-caddy.sh | cut -d= -f2)
  tag_esperado="arandano-caddy:${version_script}-hetzner"
  check_eq "el tag del compose coincide con el que produce build-caddy.sh" \
    "$tag_esperado" "$imagen_caddy"
```

- [ ] **Step 4: Correr la suite y verificar que pasa**

Run: `./scripts/verify-infra.sh network`
Expected: los tres checks nuevos en verde. Si el de módulos da `0`, la imagen de la Task 1 no se buildeó o no quedó bien.

- [ ] **Step 5: Demostrar que el check del tag detecta el desfasaje**

> **No restaurar con `git checkout --`.** En este punto de la secuencia la
> edición del Step 2 todavía **no está commiteada** —el commit es el Step 8—, así
> que un `git checkout` revierte el archivo a HEAD y se lleva puesto el trabajo
> del Step 2 junto con la mutación de prueba. Hay que restaurar desde una copia.

```bash
cp docker/compose.prod.yml /var/tmp/compose-prod.respaldo
sed -i 's/arandano-caddy:2.11.4-hetzner/arandano-caddy:2.10.0-hetzner/' docker/compose.prod.yml
./scripts/verify-infra.sh network 2>&1 | grep -A1 'coincide con el que produce'
cp /var/tmp/compose-prod.respaldo docker/compose.prod.yml
rm -f /var/tmp/compose-prod.respaldo
diff <(git show :docker/compose.prod.yml 2>/dev/null || true) docker/compose.prod.yml >/dev/null && echo "restaurado" || echo "restaurado (con la edición del Step 2 todavía sin commitear, que es lo correcto acá)"
```

Expected: el check falla con `esperado: arandano-caddy:2.11.4-hetzner, obtenido: arandano-caddy:2.10.0-hetzner`, y el archivo queda con la edición del Step 2 intacta. `git status --porcelain docker/compose.prod.yml` **debe** mostrar ` M` — el Step 2 todavía no se commiteó. Sin esta prueba, no sabríamos si el check compara algo o siempre da verde.

- [ ] **Step 6: Copiar el compose a producción y recrear Caddy**

La copia a `/srv/arandano/prod/` es **manual**, igual que la del Caddyfile.

```bash
cp docker/compose.prod.yml /srv/arandano/prod/docker-compose.yml
( cd /srv/arandano/prod && docker compose up -d --no-deps caddy )
sleep 5
docker ps --filter name=arandano-prod-caddy-1 --format '{{.Image}}  {{.Status}}'
```

Expected: `arandano-caddy:2.11.4-hetzner  Up …`. Si dijera `caddy:2-alpine`, el `cp` no se hizo.

- [ ] **Step 7: Verificar que producción sigue sirviendo igual**

El Caddyfile no cambió todavía, así que el comportamiento tiene que ser idéntico:

```bash
CA=$(mktemp -p /var/tmp ca.XXXXXX)
( cd /srv/arandano/prod && docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt ) > "$CA"
curl -s --cacert "$CA" --max-time 5 https://localhost/api/health
echo
curl -s -o /dev/null -w ':80 -> %{http_code}\n' --max-time 5 http://127.0.0.1/api/health
rm -f "$CA"
./scripts/verify-infra.sh env 2>&1 | tail -1
```

Expected: `{"status":"ok"}`, `:80 -> 308`, y la suite `env` en `0 fallan` — que es la que compara el compose del repo contra el de `/srv`.

- [ ] **Step 8: Commit**

Sólo los archivos del repo. **Nada de `/srv` se versiona**: son credenciales.

```bash
git add docker/compose.prod.yml scripts/verify-infra.sh
git commit -m "feat(caddy): producción corre la imagen propia, con el token por una sola variable

El env_file entero le daría al proxy la contraseña de Postgres sin necesidad.
El :? hace que el stack se niegue a levantar sin el token, en vez de fallar
recién al renovar dentro de 60 días."
```

---

## ⛔ Semáforo: de acá en adelante hace falta el DNS delegado

**No empezar la Task 3 hasta que esto devuelva los nameservers de Hetzner:**

```bash
dig NS arandano.app
```

Si devuelve vacío, la delegación no está hecha y **Let's Encrypt no va a poder verificar nada** — ni siquiera en staging. Intentarlo igual no da un error útil: consume intentos y confunde el diagnóstico.

Y verificar también que los registros A estén:

```bash
dig +short A arandano.app
dig +short A canario.arandano.app
```

Expected: los dos `178.156.251.41`. El segundo prueba que el wildcard de la zona está.

---

### Task 3: El site block, contra el staging de Let's Encrypt

**Files:**
- Modify: `docker/Caddyfile`

**Interfaces:**
- Consumes: `HETZNER_DNS_TOKEN` en el contenedor (Task 2), la imagen con el módulo (Task 1), el DNS delegado.

- [ ] **Step 1: Corregir el comentario del `:80`, que hoy miente**

En `docker/Caddyfile`, el comentario del bloque `:80` dice que el puerto existe "para resolver el desafío HTTP de ACME". Con DNS-01 eso deja de ser cierto. Reemplazar esa frase por:

```
# Sólo redirección, nunca reverse_proxy. Este puerto existe únicamente para
# empujar a todo el mundo a TLS.
#
# Ya NO sirve para el desafío de ACME: desde el cutover, los certificados se
# emiten por DNS-01 —Caddy escribe un TXT en la zona de Hetzner— porque un
# wildcard no se puede emitir de otra forma. El :80 podría cerrarse por
# completo; se deja abierto porque un cliente que tipea el dominio sin "https"
# tiene que llegar igual.
```

- [ ] **Step 2: Agregar el site block del dominio real, apuntando a staging**

Al final de `docker/Caddyfile`, **después** del bloque `localhost:443` y **sin tocarlo**:

```
# El dominio real. Un site block NUEVO y no un reemplazo de localhost:443: ese
# otro es por donde el gate del deploy verifica producción, y pisarlo dejaría
# todo el tráfico de clientes rechazado con "no certificate available" — que del
# lado del cliente es indistinguible de un TLS roto.
#
# El wildcard cubre a todos los tenants: flor.arandano.app funciona sin emitir
# nada ni tocar el DNS por cada cliente nuevo, que es lo que sostiene la promesa
# del alta instantánea.
#
# ATENCIÓN: el acme_ca de abajo apunta al STAGING de Let's Encrypt. Emite
# certificados que ninguna CA pública firma, así que el navegador avisa — y es
# a propósito. Sirve para validar la cadena entera (módulo, token, permisos
# sobre la zona, propagación, este mismo bloque) sin gastar intentos del límite
# real, que es de 5 validaciones fallidas por hora. Se saca en la Task 4.
arandano.app, *.arandano.app {
	tls {
		dns hetzner {env.HETZNER_DNS_TOKEN}
		# 30s es el valor que documenta el propio módulo como arreglo de un
		# problema conocido: el DNS de Hetzner propaga los TXT con lentitud y
		# sin esto el primer intento falla. Se arranca acá y no más alto a
		# propósito — emitir contra staging existe justamente para que este
		# número se pueda ajustar sin que un fallo cueste nada.
		propagation_delay 30s
		acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
	}
	reverse_proxy app:3000
}
```

- [ ] **Step 3: Validar la sintaxis antes de tocar producción**

```bash
docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  arandano-caddy:2.11.4-hetzner caddy validate --config /etc/caddy/Caddyfile
```

Expected: `Valid configuration`. Corre contra **la imagen propia**, no la oficial: la oficial no conoce la directiva `dns hetzner` y rechazaría un archivo correcto.

- [ ] **Step 4: Copiar a producción y recargar**

```bash
cp docker/Caddyfile /srv/arandano/prod/Caddyfile
( cd /srv/arandano/prod && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile )
```

`reload` y no `restart`: recarga la configuración sin cortar conexiones en curso.

- [ ] **Step 5: Mirar la emisión en vivo**

La emisión es asincrónica: Caddy la arranca al recargar y puede tardar más de un minuto entre la propagación del TXT y la validación.

```bash
( cd /srv/arandano/prod && timeout 180 docker compose logs -f --tail=50 caddy )
```

`timeout` y no un `&` con `kill %1`: el control de jobs no funciona de forma
confiable en una shell no interactiva, y un `kill` que no mata deja el `logs -f`
colgado tomando la terminal.

Expected: líneas de `certificate obtained successfully` para `arandano.app` y `*.arandano.app`.

**Si falla**, el log dice por qué, y las causas son pocas y distinguibles:
- `unauthorized` o `403` de la API de Hetzner → el token no tiene permiso de escritura sobre la zona.
- timeout esperando la propagación → subir `propagation_delay` a `60s` y repetir desde el Step 4. Esto es exactamente lo que staging existe para permitir.
- `no such host` o NXDOMAIN → la delegación no terminó de propagar; volver al semáforo.
- El contenedor reiniciándose durante la emisión → es el `mem_limit: 128m`. El
  módulo sólo trabaja al emitir y al renovar, así que en régimen 128m alcanzan;
  si muriera acá, subirlo en `docker/compose.prod.yml` y volver al Step 4. Es el
  único momento del ciclo de vida de Caddy en que ese límite puede quedar corto.

**No pasar a la Task 4 hasta ver la emisión exitosa.**

- [ ] **Step 6: Confirmar que el certificado es de staging y que sirve la app**

```bash
echo | openssl s_client -connect 127.0.0.1:443 -servername arandano.app 2>/dev/null \
  | openssl x509 -noout -issuer -subject
curl -sk --resolve arandano.app:443:127.0.0.1 https://arandano.app/api/health
echo
curl -sk --resolve canario.arandano.app:443:127.0.0.1 -o /dev/null \
  -w 'subdominio de tenant -> %{http_code}\n' https://canario.arandano.app/
```

Expected: el `issuer` nombra a **STAGING** de Let's Encrypt; el healthcheck devuelve `{"status":"ok"}`; y el subdominio del canario devuelve `200`. El `-k` acá es correcto y temporal: el certificado de staging no lo firma una CA pública **a propósito**.

Ese último caso es el que prueba que el **wildcard** funciona, no sólo el apex.

- [ ] **Step 7: Commit**

```bash
git add docker/Caddyfile
git commit -m "feat(cutover): site block del dominio real, emitiendo contra el staging de LE

Contra staging primero porque Let's Encrypt limita a 5 validaciones fallidas por
hora y el módulo de Hetzner tiene reportes de propagación lenta: ir directo a
producción es quedarse sin intentos con el sitio caído."
```

---

### Task 4: Pasar al emisor de producción

**Files:**
- Modify: `docker/Caddyfile`

- [ ] **Step 1: Sacar el `acme_ca` de staging**

En el bloque `arandano.app, *.arandano.app`, borrar la línea del `acme_ca` y el párrafo `ATENCIÓN` que la explica. En su lugar, dejar escrito lo que queda cierto:

```
# El emisor es el de producción de Let's Encrypt (el default de Caddy). La
# primera emisión se hizo contra el staging para validar módulo, token,
# permisos y propagación sin gastar intentos del límite real; ese rodeo está
# documentado en el spec del cutover y conviene repetirlo ante cualquier cambio
# de esta configuración.
```

- [ ] **Step 2: Validar, copiar y recargar**

```bash
docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  arandano-caddy:2.11.4-hetzner caddy validate --config /etc/caddy/Caddyfile
cp docker/Caddyfile /srv/arandano/prod/Caddyfile
( cd /srv/arandano/prod && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile )
```

Expected: `Valid configuration` y el reload sin error.

- [ ] **Step 3: Esperar la emisión real y confirmar el emisor**

```bash
sleep 180
echo | openssl s_client -connect 127.0.0.1:443 -servername arandano.app 2>/dev/null \
  | openssl x509 -noout -issuer -dates
```

Expected: el `issuer` ya **no** dice STAGING, y las fechas cubren unos 90 días.

- [ ] **Step 4: Confirmar que valida SIN `-k`, que es lo único que importa**

```bash
curl -s --resolve arandano.app:443:127.0.0.1 \
  -o /dev/null -w 'apex     -> HTTP %{http_code}  ssl_verify=%{ssl_verify_result}\n' \
  https://arandano.app/api/health
curl -s --resolve canario.arandano.app:443:127.0.0.1 \
  -o /dev/null -w 'wildcard -> HTTP %{http_code}  ssl_verify=%{ssl_verify_result}\n' \
  https://canario.arandano.app/
```

Expected: los dos con `ssl_verify=0`, el apex en `200` y el wildcard en `200`. Sin `-k` y sin `--cacert`: valida contra las CA del sistema, que es lo que hace un navegador.

- [ ] **Step 5: Confirmar que el gate del deploy sigue sano**

El bloque `localhost:443` no se tocó, pero conviene comprobarlo antes de sumarle chequeos:

```bash
./scripts/verify-infra.sh network 2>&1 | sed -e 's/\x1b\[[0-9;]*m//g' | tail -8
```

Expected: `0 fallan`, incluidos el `:80 → 308` y el certificado interno de `localhost`.

- [ ] **Step 6: Commit**

```bash
git add docker/Caddyfile
git commit -m "feat(cutover): emisor de producción, con el wildcard ya emitido y validado"
```

---

### Task 5: Los dos chequeos que le faltan al gate

**Files:**
- Modify: `scripts/deploy.sh` (paso 16)
- Modify: `scripts/verify-infra.sh` (ampliar `suite_network`)

**Interfaces:**
- Consumes: el certificado real emitido y validando (Task 4).

- [ ] **Step 1: Sumar el caso del dominio real al paso 16 de `deploy.sh`**

En `scripts/deploy.sh`, **inmediatamente después** del bloque que verifica el `308` del `:80` y dentro del mismo `if [[ "$OBJETIVO" == prod ]]`:

```bash
  # El certificado que ven los clientes NO es el que valida el poll de arriba.
  # `URL_SALUD` entra por localhost:443 con la CA interna; este caso entra por el
  # hostname real con las CA públicas. Sin él, el wildcard puede no
  # aprovisionarse, el gate seguir en verde, y todo cliente recibir el
  # "no certificate available" que el Caddyfile describe como indistinguible de
  # un TLS roto.
  #
  # `--resolve` y no DNS real: lo que se prueba es que Caddy sirve ese hostname
  # con un certificado aceptable, que es cosa nuestra. Depender de la
  # propagación del DNS público metería una causa ajena adentro del gate.
  #
  # Sin `--cacert` a propósito: valida contra las CA del sistema, igual que un
  # navegador.
  local codigo_real
  codigo_real=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "arandano.app:443:127.0.0.1" \
    https://arandano.app/api/health 2>/dev/null) || codigo_real=000
  if [[ "$codigo_real" != 200 ]]; then
    rollback_y_salir "el dominio real devolvió $codigo_real por HTTPS: el certificado del wildcard no valida contra las CA públicas o Caddy no está sirviendo ese hostname — un cliente vería un TLS roto"
  fi
  log "  el dominio real responde con un certificado que un cliente acepta"
```

> **`local` sólo si ese tramo está dentro de una función.** Si el paso 16 es código de nivel superior, sacar el `local` — `bash` falla con "can only be used in a function".

- [ ] **Step 2: Sumar el check del certificado del wildcard a la suite**

Al final de `suite_network()` en `scripts/verify-infra.sh`:

```bash
  # El certificado del dominio real, validado contra las CA PÚBLICAS y no contra
  # la interna. Es el que cierra la trampa que el Caddyfile ya advierte: el check
  # de `localhost` de más arriba valida el certificado interno, y eso se acredita
  # como "el gate detecta un certificado sin emitir" — cierto antes del cutover y
  # falso justo cuando importa.
  local verifico_real
  verifico_real=$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 10 \
    --resolve "arandano.app:443:127.0.0.1" \
    https://arandano.app/api/health 2>/dev/null) || verifico_real=99
  check_eq "el certificado del dominio real valida contra las CA públicas" "0" "$verifico_real"

  # El wildcard, no el apex. Son el mismo certificado, pero un site block mal
  # escrito puede servir uno y no el otro — y el subdominio es el que usan los
  # clientes.
  local verifico_wildcard
  verifico_wildcard=$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 10 \
    --resolve "canario.arandano.app:443:127.0.0.1" \
    https://canario.arandano.app/ 2>/dev/null) || verifico_wildcard=99
  check_eq "el certificado cubre un subdominio de tenant" "0" "$verifico_wildcard"
```

> `|| var=99` y **nunca** `|| echo 99`: el `echo` concatena con lo que `curl` ya escribió y el mensaje termina diciendo `099`. Este archivo ya documenta ese error en los checks de más arriba.

- [ ] **Step 3: Correr la suite y verificar que pasa**

Run: `./scripts/verify-infra.sh network`
Expected: los dos checks nuevos en verde, con la suite entera en `0 fallan`.

- [ ] **Step 4: Demostrar que los checks nuevos no son vacíos**

Un `ssl_verify_result` de `0` tiene que venir de una validación real. Comprobarlo contra un hostname que el certificado **no** cubre:

```bash
curl -s -o /dev/null -w 'hostname ajeno -> ssl_verify=%{ssl_verify_result}\n' \
  --max-time 10 --resolve "otro-dominio.test:443:127.0.0.1" \
  https://otro-dominio.test/ 2>/dev/null || echo 'hostname ajeno -> falla el handshake'
```

Expected: falla, o devuelve un `ssl_verify_result` distinto de `0`. Si diera `0`, el check estaría midiendo nada.

- [ ] **Step 5: Verificar la sintaxis de los scripts**

```bash
bash -n scripts/deploy.sh && bash -n scripts/verify-infra.sh && echo "sintaxis ok"
```

Expected: `sintaxis ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/deploy.sh scripts/verify-infra.sh
git commit -m "feat(gate): verificar el certificado que ven los clientes, no sólo el interno

El poll del deploy entra por localhost:443 con la CA interna. Ese certificado
puede estar perfecto mientras el wildcard no se aprovisionó y ningún cliente
puede entrar. Los dos casos nuevos entran por el hostname real con las CA
públicas, e incluyen un subdominio porque un site block mal escrito puede servir
el apex y no el wildcard."
```

---

### Task 6: El deploy de punta a punta y la documentación

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/runbook-stacks.md`

- [ ] **Step 1: Deploy completo contra producción**

Es la única verificación del conjunto. **Ventana**: temprano a la mañana o de noche hora Argentina.

```bash
./scripts/deploy.sh
```

Expected: los 18 pasos en verde, incluidos los dos casos nuevos del paso 16, y un tag nuevo.

- [ ] **Step 2: Comprobar el sitio como lo ve un cliente**

```bash
curl -sI --resolve arandano.app:443:127.0.0.1 https://arandano.app/ | head -1
curl -s -o /dev/null -w 'http -> %{http_code} -> %{redirect_url}\n' \
  --resolve arandano.app:80:127.0.0.1 http://arandano.app/
```

Expected: el primero un `HTTP/2 200`; el segundo un `308` hacia `https://arandano.app/`.

- [ ] **Step 3: Cerrar el bloqueante 1 en `CLAUDE.md`**

En *Bloqueantes antes del cutover de DNS*, reemplazar el punto 1:

```markdown
1. ~~**Establecer el estado real del dominio.**~~ **Hecho** (2026-08-10). El
   dominio estaba registrado en DonWeb; el DNS se delegó a Hetzner porque el
   wildcard exige DNS-01 y sólo Hetzner tiene módulo de Caddy. `A @` y `A *`
   apuntan al servidor, el wildcard `*.arandano.app` se emite y renueva solo, y
   el gate verifica el certificado que ven los clientes además del interno. Ver
   `docs/superpowers/specs/2026-08-09-cutover-wildcard-design.md`.
```

Y en la advertencia de ese mismo punto sobre el certificado —la que dice que el gate deja de cubrir el certificado de los clientes— reemplazarla por una nota de que ya está cubierto, nombrando los dos checks.

- [ ] **Step 4: Documentar la rotación del token y el rebuild de la imagen**

Agregar a `docs/runbook-stacks.md`, en *Deploy y rollback*, dos procedimientos:

**Rotar el token de Hetzner DNS** — generar uno nuevo en la consola, reemplazar la línea en `/srv/arandano/prod/.env` con el mismo guard `grep -q` que ya usa la sección del token del healthcheck, recrear el contenedor de Caddy, y comprobar que la próxima renovación no falla forzándola con `caddy reload`. Incluir la advertencia de que el token viejo hay que borrarlo en la consola de Hetzner, no sólo del archivo.

**Rebuildear la imagen de Caddy** — cuándo (una versión nueva de Caddy, o del módulo), cómo (`scripts/build-caddy.sh` después de cambiar la constante), y que hay que actualizar el tag en `docker/compose.prod.yml` **en el mismo commit**, porque `suite_network` compara los dos y el deploy aborta si difieren.

- [ ] **Step 5: Correr la suite completa**

Run: `./scripts/verify-infra.sh network` y después `./scripts/verify-infra.sh env`
Expected: las dos en `0 fallan`. La de `env` es la que compara el compose y el Caddyfile del repo contra los de `/srv`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/runbook-stacks.md
git commit -m "docs: cerrar el bloqueante del dominio y documentar token e imagen de Caddy"
```

---

## Lo que este plan no hace

- **`www.arandano.app`.** El wildcard lo cubre; una redirección al apex es un site block de una línea si algún día hace falta.
- **Rate limiting sobre `/api/health`.** Sigue pendiente de la primera mitad del cutover y sigue necesitando un plugin de Caddy.
- **Registros CAA.** Recomendables, pero son una decisión de DNS aparte y no bloquean nada.
- **Cambiar `URL_SALUD`.** Decidido explícitamente que no: un gate que dependa del DNS público y de una CA pública se bloquea por causas ajenas al código, y el rollback automático usa ese mismo poll.
- **Backup del volumen `caddydata`.** Los certificados son reemplazables, a diferencia de los datos de un cliente. Pero conviene saber que un `docker compose down -v` sobre prod cuesta una reemisión, no sólo un reinicio — y ahí sí cuentan los límites de Let's Encrypt.
