# Smoke test autenticado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el gate del deploy abra cada pantalla autenticada de la aplicación con una sesión de verdad, contra `arandano-stage`, antes de promover la imagen a producción.

**Architecture:** La lista de pantallas se deriva del sistema de archivos (`app/(app)/**/page.tsx`) en una función de bash con tests propios; `deploy.sh` le define contraseña al canario de stage en el paso 8, inmediatamente después de crearlo; y `smoke.sh` hace un login real contra `/api/auth/sign-in/email`, se guarda la cookie, y pide cada ruta asertando `200` **más** el nombre del local en el cuerpo.

**Tech Stack:** bash 5 (`scripts/lib/*.sh`, `scripts/tests/test-*.sh`), curl, vitest + `react-dom/server` para el test del layout, Docker (imagen `arandano-migrate:$SHA` para correr `definir-clave.mts` sobre la red del stack).

**Spec:** `docs/superpowers/specs/2026-08-10-smoke-autenticado-design.md`

## Global Constraints

- **Nunca contra producción.** Todo lo de este plan corre contra `arandano-stage` (paso 8 y 9 de `deploy.sh`), que tiene un Postgres efímero en tmpfs que nace vacío en cada corrida. Un smoke autenticado escribe; contra prod eso sería una sesión real en la base de un cliente.
- **Nunca `./scripts/verify-infra.sh` sin argumento ni con `all`/`stress`**: la suite de stress frena el Postgres de producción.
- **Nunca editar en caliente `/srv/arandano/prod/`.** Un fix urgente sigue siendo un deploy y pasa el mismo gate.
- **Temporales en `/var/tmp`**, nunca en `/tmp`.
- Literales de credenciales versionados **sólo** para el stack de stage, y siempre con el comentario que nombra las dos condiciones que lo hacen aceptable: base efímera que nace vacía en cada corrida, y stack que sólo escucha en la IP de Tailscale (`100.64.81.63`).
- `npm test` = `scripts/tests/correr-todos.sh && vitest run`. Los tests de bash entran al gate por ahí; no hay que tocar nada para que corran.
- Comentarios y mensajes de commit en castellano rioplatense, como el resto del repo.

---

### Task 1: El marcador en el layout de `(app)`

El layout de `app/(app)/` renderiza el nombre del local en su encabezado pero **sin `data-testid`**. El de `/login` sí lo tiene, y es lo que `caso_tenant_resuelve` busca hoy. Sin este atributo, el smoke autenticado no tiene con qué distinguir una pantalla de verdad de un 200 vacío.

**Files:**
- Modify: `app/(app)/layout.tsx:18` (el `<span className="font-medium">`)
- Test: `app/(app)/layout.test.tsx` (crear)

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces: el atributo `data-testid="tenant-nombre"` en el encabezado de toda pantalla bajo `app/(app)/`. La Task 3 lo busca desde bash con `grep -F 'data-testid="tenant-nombre">'`.

- [ ] **Step 1: Write the failing test**

Crear `app/(app)/layout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo patrón que app/page.test.tsx: exigirSesion depende de headers(), de
// authParaTenant y de Postgres, que son detalle de otro módulo
// (lib/auth/sesion.test.ts). Acá sólo importa qué renderiza el layout con una
// sesión dada.
const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({
  exigirSesion: () => exigirSesion(),
}))

// La server action del botón "Salir" no se ejercita acá: es un archivo
// 'use server' y su contrato ya lo fija test/use-server.test.ts.
vi.mock('./acciones', () => ({ salir: vi.fn() }))

async function render() {
  const { default: LayoutApp } = await import('@/app/(app)/layout')
  const elemento = await LayoutApp({ children: <p>contenido</p> })
  return renderToStaticMarkup(elemento)
}

describe('layout de la aplicación', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirSesion.mockReset()
    exigirSesion.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'DUENO' },
      subdominio: 'prueba',
    })
  })

  // El marcador que usa el smoke autenticado (scripts/smoke.sh) para
  // distinguir una pantalla de verdad de un 200 cualquiera. Si esto se rompe,
  // TODOS los casos de pantalla del gate fallan a la vez.
  it('marca el nombre del local con data-testid, para el smoke autenticado', async () => {
    const html = await render()
    expect(html).toContain('data-testid="tenant-nombre">Local de prueba')
  })

  it('renderiza el contenido de adentro', async () => {
    const html = await render()
    expect(html).toContain('contenido')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run 'app/(app)/layout.test.tsx'`
Expected: el primer caso FALLA (el markup trae `<span class="font-medium">Local de prueba` sin el atributo); el segundo PASA. Si fallan los dos, el problema es el render y no el marcador — arreglarlo antes de seguir.

- [ ] **Step 3: Write minimal implementation**

En `app/(app)/layout.tsx`, reemplazar la línea del `<span>`:

```tsx
        {/* data-testid, y no una clase ni el texto suelto: es el marcador que
            scripts/smoke.sh busca en CADA pantalla autenticada para distinguir
            una página de verdad de un 200 vacío (Next devuelve 200 sirviendo un
            not-found). Borrarlo hace fallar todos los casos de pantalla del
            gate a la vez. El mismo atributo, con el mismo nombre, está en
            app/login/formulario.tsx. */}
        <span data-testid="tenant-nombre" className="font-medium">
          {sesion.tenant.nombre}
        </span>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run 'app/(app)/layout.test.tsx'`
Expected: 2 passed.

- [ ] **Step 5: Full gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde. En particular `test/rutas-con-guard.test.ts` y `test/use-server.test.ts` siguen pasando.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/layout.tsx" "app/(app)/layout.test.tsx"
git commit -m "feat(smoke): marcar el nombre del local en el layout de la app

El smoke autenticado necesita distinguir una pantalla de verdad de un 200
cualquiera: Next devuelve 200 sirviendo un not-found. El marcador es el
mismo data-testid que ya usa /login."
```

---

### Task 2: La derivación de rutas, con sus tests

La lista de pantallas sale del sistema de archivos, no de una lista a mano. Vive en `scripts/lib/` —y no adentro de `smoke.sh`— porque un archivo de test no puede sourcear `smoke.sh`: ese script ejecuta sus casos al sourcearse. Es el mismo reparto que ya tienen `scripts/lib/deploy-comun.sh` y `scripts/tests/test-deploy-comun.sh`.

**Files:**
- Create: `scripts/lib/rutas-comun.sh`
- Create: `scripts/tests/test-rutas-comun.sh`

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces:
  - `rutas_autenticadas <dir>` — imprime una ruta por línea (`/usuarios`), ordenadas. Devuelve 1 si el directorio no tiene ninguna `page.tsx`, o si aparece una ruta con segmento dinámico que no está declarada.
  - `RUTAS_SIN_SMOKE` — array asociativo, ruta → razón. Arranca vacío.

  La Task 3 los usa desde `scripts/smoke.sh` con `source scripts/lib/rutas-comun.sh`.

- [ ] **Step 1: Write the failing test**

Crear `scripts/tests/test-rutas-comun.sh`:

```bash
#!/usr/bin/env bash
# Tests de la derivación de rutas autenticadas.
#
# Contra directorios de FIXTURE y no contra app/ del repo: atar el test al
# árbol real lo convierte en una lista a mano por la puerta de atrás — cada
# pantalla nueva lo rompería, y la respuesta sería editar el test hasta que
# vuelva a pasar. Lo que se prueba acá es la derivación, no el contenido de
# app/.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/tests/lib-asserts.sh
source scripts/lib/rutas-comun.sh

# /var/tmp y no /tmp: regla del repo.
RAIZ="$(mktemp -d /var/tmp/arandano-rutas.XXXXXX)"
trap 'rm -rf "$RAIZ"' EXIT

# --- Fixture: la forma real de app/(app)/, más las dos que todavía no existen
# (un grupo anidado y una ruta con parámetro).
mkdir -p "$RAIZ/(app)/usuarios" \
         "$RAIZ/(app)/caja" \
         "$RAIZ/(app)/(reportes)/margen"
touch "$RAIZ/(app)/usuarios/page.tsx" \
      "$RAIZ/(app)/caja/page.tsx" \
      "$RAIZ/(app)/(reportes)/margen/page.tsx"
# Un archivo que NO es una página, para que el find no lo levante.
touch "$RAIZ/(app)/usuarios/formularios.tsx"

salida=$(rutas_autenticadas "$RAIZ/(app)")
check_eq "deriva una ruta por página, ordenadas" \
  $'/caja\n/margen\n/usuarios' "$salida"

check_true "el grupo anidado no aparece en la URL" \
  grep -qx '/margen' <<<"$salida"

check_false "un archivo que no es page.tsx no produce ruta" \
  grep -q 'formularios' <<<"$salida"

# --- Un directorio sin páginas falla, y no devuelve una lista vacía en verde.
# Es la mitad que hace que esto no sea decorativo: un barrido de cero rutas que
# reporta cero fallas es exactamente el modo de falla que este archivo existe
# para impedir.
VACIO="$(mktemp -d /var/tmp/arandano-rutas-vacio.XXXXXX)"
trap 'rm -rf "$RAIZ" "$VACIO"' EXIT
check_false "un directorio sin páginas falla" rutas_autenticadas "$VACIO"

# --- Una ruta con parámetro sin declarar falla.
mkdir -p "$RAIZ/(app)/ventas/[id]"
touch "$RAIZ/(app)/ventas/[id]/page.tsx"
check_false "una ruta con parámetro sin declarar falla" \
  rutas_autenticadas "$RAIZ/(app)"

# --- Declarada, se saltea y el resto sigue saliendo.
RUTAS_SIN_SMOKE['/ventas/[id]']='no hay de dónde sacar un id sin sembrar datos'
salida=$(rutas_autenticadas "$RAIZ/(app)")
check_eq "una ruta declarada se saltea, y las demás siguen" \
  $'/caja\n/margen\n/usuarios' "$salida"

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash scripts/tests/test-rutas-comun.sh`
Expected: FALLA en el `source scripts/lib/rutas-comun.sh` con "No such file or directory". Ése es el rojo correcto para este paso.

- [ ] **Step 3: Write minimal implementation**

Crear `scripts/lib/rutas-comun.sh`:

```bash
#!/usr/bin/env bash
# Las rutas autenticadas de la aplicación, derivadas del sistema de archivos.
#
# Existe para que smoke.sh no lleve una lista a mano: una pantalla nueva queda
# cubierta por el gate sin que nadie se acuerde de nada. Es el mismo criterio
# que test/rutas-con-guard.test.ts aplica al guard de sesión.
#
# Vive acá y no adentro de smoke.sh porque un archivo de test no puede sourcear
# smoke.sh: ese script ejecuta sus casos al sourcearse. Mismo reparto que
# scripts/lib/deploy-comun.sh y scripts/tests/test-deploy-comun.sh.
#
# Este archivo sólo define funciones y la lista blanca. No ejecuta nada.

# Rutas con segmento dinámico que el smoke NO pide, cada una con su razón.
#
# Escrita a mano a propósito: pedir /ventas/[id] a ciegas es imposible —no hay
# de dónde sacar un id válido sin sembrar datos, y sembrar datos convierte el
# smoke en una suite de fixtures—, así que la exención es legítima. Pero tiene
# que ser una decisión VISIBLE EN EL DIFF, no algo que el script deduzca solo.
# Mismo patrón que SIN_TENANT_ID en test/rls-cobertura.test.ts y
# FUERA_DEL_GRUPO en test/rutas-con-guard.test.ts.
#
# Arranca vacía: hoy no hay ninguna ruta con parámetro. Existe para que la
# primera sea una decisión y no un olvido.
declare -A RUTAS_SIN_SMOKE=()

# Imprime una ruta por línea, ordenadas.
#
# Falla —y no devuelve una lista vacía— si el directorio no tiene ninguna
# página: un barrido de cero rutas que reporta cero fallas es exactamente el
# modo de falla que esto existe para impedir. Falla también si aparece una ruta
# con parámetro que nadie declaró en RUTAS_SIN_SMOKE.
rutas_autenticadas() {
  local raiz="${1:?falta el directorio del grupo, p.ej. 'app/(app)'}"
  local archivo ruta parte
  local -a partes salida rutas=()
  local encontradas=0

  while IFS= read -r archivo; do
    encontradas=$((encontradas + 1))
    ruta="${archivo#"$raiz"}"
    ruta="${ruta%/page.tsx}"

    # Los segmentos entre paréntesis son grupos de rutas: organizan carpetas y
    # NO aparecen en la URL. Se sacan segmento por segmento porque puede haber
    # grupos anidados adentro del grupo raíz.
    salida=()
    IFS='/' read -ra partes <<<"$ruta"
    for parte in "${partes[@]}"; do
      [[ -z "$parte" ]] && continue
      [[ "$parte" == '('*')' ]] && continue
      salida+=("$parte")
    done
    if [[ "${#salida[@]}" -eq 0 ]]; then
      ruta='/'
    else
      ruta="/$(IFS=/; printf '%s' "${salida[*]}")"
    fi

    if [[ "$ruta" == *'['* ]]; then
      if [[ -z "${RUTAS_SIN_SMOKE[$ruta]+declarada}" ]]; then
        printf 'ruta con parámetro sin declarar: %s\n' "$ruta" >&2
        printf '  No se puede pedir a ciegas. Si es correcto no cubrirla, declarala en\n' >&2
        printf '  RUTAS_SIN_SMOKE (scripts/lib/rutas-comun.sh) con su razón escrita.\n' >&2
        return 1
      fi
      continue
    fi

    rutas+=("$ruta")
  done < <(find "$raiz" -name page.tsx | sort)

  if [[ "$encontradas" -eq 0 ]]; then
    printf 'no se encontró ninguna page.tsx bajo %s\n' "$raiz" >&2
    return 1
  fi

  if [[ "${#rutas[@]}" -gt 0 ]]; then
    printf '%s\n' "${rutas[@]}"
  fi
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash scripts/tests/test-rutas-comun.sh`
Expected: `6 ok, 0 fallan`.

- [ ] **Step 5: Verificar contra el árbol real**

Run: `bash -c 'source scripts/lib/rutas-comun.sh && rutas_autenticadas "app/(app)"'`
Expected: exactamente `/usuarios`. Si sale algo más, o nada, pará: la Task 3 depende de esta salida.

- [ ] **Step 6: Full gate**

Run: `npm test`
Expected: `correr-todos.sh` levanta el archivo nuevo por glob (no hay lista que tocar) y pasa, y vitest sigue verde.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/rutas-comun.sh scripts/tests/test-rutas-comun.sh
git commit -m "feat(smoke): derivar las rutas autenticadas del sistema de archivos

Una pantalla nueva queda cubierta por el gate sin que nadie se acuerde de
nada. Las rutas con parámetro no se pueden pedir a ciegas: van en una
lista blanca con su razón escrita, y sin declarar la derivación falla.
Un directorio sin páginas también falla — un barrido de cero rutas que
reporta cero fallas es el modo de falla que esto existe para impedir."
```

---

### Task 3: El login y el barrido, en el gate

La clave del canario de stage (paso 8 de `deploy.sh`) y los casos autenticados (`smoke.sh`, paso 9) van juntos: una clave que nadie usa no prueba nada, y un caso de login sin clave falla siempre. Un reviewer no puede aprobar uno sin el otro.

**Files:**
- Modify: `scripts/deploy.sh` (paso 8, después del `docker run … crear-tenant.mts` y antes del `up -d --wait app`)
- Modify: `scripts/smoke.sh`
- Modify: `docs/runbook-stacks.md` (sección *Deploy y rollback*)
- Modify: `CLAUDE.md` (el punto 3 de *Cómo se manejan los cambios una vez en producción*)

**Interfaces:**
- Consumes: `data-testid="tenant-nombre"` (Task 1); `rutas_autenticadas` y `RUTAS_SIN_SMOKE` (Task 2).
- Produces: el caso `caso_login_devuelve_sesion` y un caso `pantalla <ruta>` por cada ruta derivada, en el paso 9 del gate.

- [ ] **Step 1: La clave del canario, en `deploy.sh`**

Insertar **inmediatamente después** del bloque `docker run … tsx scripts/crear-tenant.mts … --duenio-nombre="Canario"` y **antes** del comentario de `--wait`:

```bash
# La contraseña del canario de stage. Sin esto, el smoke autenticado del paso 9
# no tiene con qué entrar: `crear-tenant.mts` crea al dueño pero no le define
# credencial —no puede, corre con `pg` pelado y el hash lo produce Better Auth,
# que es la regla que mantiene el algoritmo decidido en un solo lugar.
#
# DATABASE_URL y no MIGRATE_DATABASE_URL, a propósito: definir-clave.mts corre
# como `arandano_app`, así que todo pasa por la API de Better Auth y por lo
# tanto por RLS. Es exactamente el camino que va a recorrer el login del paso 9.
# El EXECUTE sobre resolver_tenant, que este script necesita, lo dejó puesto la
# segunda corrida de setup-db-roles.sh de unas líneas más arriba.
#
# EL ORDEN IMPORTA, igual que con el alta: va DESPUÉS de crear el canario
# (obvio) y ANTES de `up -d --wait app`. Es el último momento en que la base se
# toca antes de que el healthcheck del compose empiece a mirarla.
#
# El literal de la clave está DUPLICADO en scripts/smoke.sh, igual que
# efimero-salud y efimero-app, y es aceptable por lo mismo Y SÓLO POR LO MISMO:
# esta base es efímera, nace vacía en cada corrida y nunca ve datos de clientes,
# y el stack sólo escucha en la IP de Tailscale. Si alguna de esas dos
# condiciones deja de valer, esto deja de ser aceptable.
docker run --rm --network arandano-stage_default \
  -e DATABASE_URL="postgres://arandano_app:efimero-app@postgres:5432/arandano_stage" \
  -e DOMINIO_BASE="stage.arandano.app" \
  --entrypoint npx "arandano-migrate:$SHA" \
  tsx scripts/definir-clave.mts \
  --subdominio=canario \
  --email=canario@arandano.app \
  --clave=efimero-clave-canario
```

- [ ] **Step 2: El login y el barrido, en `smoke.sh`**

Sourcear la librería nueva junto a la que ya se sourcea, arriba del todo:

```bash
source scripts/lib/deploy-comun.sh
source scripts/lib/rutas-comun.sh
```

Después de la definición de `caso_tenant_no_cacheable` (el último caso actual), agregar:

```bash
# --- La aplicación, con una sesión de verdad -------------------------------
#
# Todo lo de arriba mira pantallas que se sirven SIN credenciales. Hasta acá,
# ninguna pantalla de la aplicación se abría nunca antes de que la abriera un
# cliente: el 2026-08-10 se promovió una imagen con /usuarios rota y las cuatro
# etapas del gate en verde, porque el defecto era de runtime y nadie pedía esa
# URL. Ver docs/superpowers/specs/2026-08-10-smoke-autenticado-design.md.

# La clave la define deploy.sh en el paso 8, con definir-clave.mts adentro de la
# imagen de migración. Literal duplicado ahí y acá, igual que efimero-salud:
# base efímera que nace vacía en cada corrida, y stack que sólo escucha en la IP
# de Tailscale. Si alguna de esas dos condiciones deja de valer, esto deja de
# ser aceptable.
CLAVE_CANARIO=efimero-clave-canario
MAIL_CANARIO=canario@arandano.app
HOST_CANARIO="${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}"

# Sin header Origin y sin Cookie, a propósito: el chequeo de origen de Better
# Auth se saltea cuando el request no trae Cookie (ver lib/auth/opciones.ts,
# donde eso está documentado como el agujero que disabledPaths vino a tapar).
# Mandar un Origin acá sólo agregaría una forma de equivocarse — tendría que ser
# EXACTAMENTE el que arma lib/auth/origen.ts para este stack, con PUERTO_PUBLICO
# incluido, y no el de la URL de la conexión.
#
# El login se hace UNA sola vez y la cookie se reusa: /sign-in/email tiene un
# rate limit de 5 por minuto (opciones.ts), así que un login por pantalla
# empezaría a dar 429 en cuanto haya seis pantallas — y esa falla se leería como
# una regresión de la aplicación.
COOKIE_SESION=$(curl -s -i --max-time 15 \
  -H "Host: ${HOST_CANARIO}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${MAIL_CANARIO}\",\"password\":\"${CLAVE_CANARIO}\"}" \
  "$URL_BASE/api/auth/sign-in/email" 2>/dev/null \
  | tr -d '\r' | grep -i '^set-cookie:' | head -1 \
  | sed 's/^[Ss]et-[Cc]ookie: *//' | cut -d';' -f1) || COOKIE_SESION=""

# Su propio caso, y no un chequeo silencioso adentro de los de abajo: si el
# login se rompe, esto tiene que decir "el login se rompió" una vez, y no
# hacer fallar N pantallas con un mensaje que habla de la pantalla equivocada.
caso_login_devuelve_sesion() {
  [[ -n "$COOKIE_SESION" ]]
}

# Cada pantalla de la aplicación, con la sesión de verdad.
#
# 200 NO alcanza: Next devuelve 200 sirviendo un not-found, y un error.tsx
# futuro también. El marcador es el nombre del local, que el layout de (app)
# renderiza en su encabezado (app/(app)/layout.tsx) — el mismo valor que el
# paso 8 acaba de escribir en la base, y el mismo argumento que ya usa
# caso_tenant_resuelve.
#
# NO se busca el texto del 404 en el cuerpo, y esto costó una tarde: Next
# incluye el boundary de "not found" en el payload de TODA página, incluidas
# las que funcionan. Un chequeo así da rojo siempre.
caso_pantalla() {
  local ruta="$1" respuesta codigo cuerpo
  [[ -n "$COOKIE_SESION" ]] || return 1
  respuesta=$(curl -s --max-time 15 -w $'\n%{http_code}' \
    -H "Host: ${HOST_CANARIO}" \
    -H "Cookie: ${COOKIE_SESION}" \
    "${URL_BASE}${ruta}" 2>/dev/null) || return 1
  codigo="${respuesta##*$'\n'}"
  cuerpo="${respuesta%$'\n'*}"
  [[ "$codigo" == "200" ]] || return 1
  grep -qF "data-testid=\"tenant-nombre\">${NOMBRE_CANARIO}" <<<"$cuerpo"
}

# La lista sale del sistema de archivos, no de acá: ver scripts/lib/rutas-comun.sh.
# Si la derivación falla —cero páginas, o una ruta con parámetro sin declarar—
# el smoke entero corta acá, antes de reportar ningún verde.
RUTAS_APP_CRUDAS=$(rutas_autenticadas 'app/(app)') || {
  printf '\n\033[31mno se pudo derivar la lista de rutas autenticadas\033[0m\n' >&2
  exit 1
}
# `/` primero, y a mano: no vive bajo (app) —el ápex llega por esa misma ruta y
# no tiene sesión— pero para un tenant es una pantalla autenticada, porque llama
# a exigirSesion() por su cuenta. Es la misma excepción, con la misma razón, que
# declara FUERA_DEL_GRUPO en test/rutas-con-guard.test.ts.
#
# El bucle y no `mapfile`: si TODAS las páginas del grupo estuvieran declaradas
# en RUTAS_SIN_SMOKE, la salida sería un string vacío y `mapfile` dejaría un
# elemento vacío que se pediría como "$URL_BASE" pelado — o sea `/` otra vez,
# reportado con un nombre que no dice nada.
RUTAS_APP=('/')
while IFS= read -r ruta_derivada; do
  [[ -n "$ruta_derivada" ]] && RUTAS_APP+=("$ruta_derivada")
done <<<"$RUTAS_APP_CRUDAS"
```

- [ ] **Step 3: Sumar los casos a la corrida**

Agregar `caso_login_devuelve_sesion` al final de la lista del `for caso in …` que ya existe, y **después** de ese bucle —antes del `printf` del resumen— agregar el barrido:

```bash
# Un caso por pantalla, con su ruta en el nombre: cuando esto falla, el renglón
# rojo ya dice cuál pantalla, sin abrir un log.
for ruta in "${RUTAS_APP[@]}"; do
  if caso_pantalla "$ruta"; then ok "pantalla ${ruta}"; else bad "pantalla ${ruta}"; fi
done
```

- [ ] **Step 4: Sintaxis, antes de gastar un ensayo**

Run: `bash -n scripts/smoke.sh && bash -n scripts/deploy.sh && npm test`
Expected: sin salida de `bash -n`, y `npm test` verde.

- [ ] **Step 5: El ensayo completo**

Run: `./scripts/deploy.sh --objetivo=ensayo`
Expected: el paso 9 imprime `✓ caso_login_devuelve_sesion`, `✓ pantalla /` y `✓ pantalla /usuarios` junto a los 12 casos que ya existían, y el deploy sigue hasta el final sin crear ni pushear tag.

Si `caso_login_devuelve_sesion` falla, mirá primero la salida del paso 8: `definir-clave.mts` imprime `contraseña definida para …` cuando funciona. Si imprimió eso y el login igual no devuelve cookie, el sospechoso es el chequeo de origen — probá el mismo `curl` a mano agregando `-H "Origin: http://canario.stage.arandano.app:3001"`.

- [ ] **Step 6: Documentar**

En `docs/runbook-stacks.md`, sección *Deploy y rollback*, sumar al paso 8 la corrida de `definir-clave.mts` y al paso 9 el barrido autenticado, nombrando: qué mail y qué clave usa el canario de stage, que la lista sale de `app/(app)/**/page.tsx`, y que una ruta con parámetro nueva hace fallar el gate hasta declararla en `RUTAS_SIN_SMOKE`.

En `CLAUDE.md`, punto 3 de *Cómo se manejan los cambios una vez en producción*, reemplazar la enumeración de smoke tests (que hoy termina en "y la home respondiendo") para que incluya el login real y el barrido de pantallas, y dejar la frase que ya está sobre los casos que llegan cuando exista ese código.

- [ ] **Step 7: Commit**

```bash
git add scripts/deploy.sh scripts/smoke.sh docs/runbook-stacks.md CLAUDE.md
git commit -m "feat(gate): abrir cada pantalla con sesión real antes de promover

El paso 8 le define contraseña al canario de stage con definir-clave.mts
—corriendo como arandano_app, o sea por RLS, igual que el login real— y el
paso 9 entra por /api/auth/sign-in/email y pide cada ruta derivada de
app/(app)/**/page.tsx, asertando 200 más el nombre del local en el cuerpo.

Un 200 solo no alcanza: Next lo devuelve sirviendo un not-found."
```

---

### Task 4: Probar que el gate atrapa el bug que lo motivó

Un smoke que corre y da verde no prueba que atrape nada. Esta task es la única que responde la pregunta que importa: **si vuelvo a romper una pantalla en runtime, ¿el deploy se frena?** Es un gate propio porque es exactamente lo que este proyecto viene fallando en verificar: forma en vez de efecto.

**Files:**
- Ninguno permanente. El defecto se introduce en una rama descartable y se revierte.

**Interfaces:**
- Consumes: todo lo de las Tasks 1–3.
- Produces: la evidencia. No hay código.

- [ ] **Step 1: Elegir un defecto que ningún chequeo estático agarre**

`export { INICIAL }` —el defecto real del 2026-08-10— **ya no sirve** para esta prueba: `test/use-server.test.ts` lo agarra en el paso 4 y el deploy nunca llega a stage, así que no diría nada sobre el smoke.

El defecto tiene que ser de runtime puro: un `throw` adentro del componente de servidor. `app/(app)/usuarios/page.tsx` tiene `dynamic = 'force-dynamic'` heredado del layout, así que `next build` no la prerenderiza y el build queda verde.

- [ ] **Step 2: Introducirlo en una rama descartable**

```bash
git switch -c prueba-del-smoke
```

En `app/(app)/usuarios/page.tsx`, como primera línea del cuerpo del componente:

```tsx
  throw new Error('defecto a propósito: probando que el smoke lo agarre')
```

```bash
git commit -am "test: defecto a propósito para probar el smoke (se revierte)"
```

El commit es obligatorio, no prolijidad: el paso 1 de `deploy.sh` rechaza un working tree sucio.

- [ ] **Step 3: Correr el gate y verificar que FRENA**

Run: `./scripts/deploy.sh --objetivo=ensayo`
Expected: el gate llega al **paso 9** y falla ahí con `✗ pantalla /usuarios`, mientras `✓ pantalla /` y `✓ caso_login_devuelve_sesion` siguen en verde. El deploy corta antes del paso 10, sin backup, sin `migrate deploy`, sin promoción y sin tag.

Si el gate frena **antes** del paso 9, este ensayo no probó nada sobre el smoke: anotá en qué paso frenó y elegí otro defecto que ese paso no vea.
Si el gate **pasa entero**, el smoke es decorativo. Pará, no revierta nada todavía, y diagnosticá — es exactamente el hallazgo que esta task existe para producir.

- [ ] **Step 4: Revertir**

```bash
git switch main
git branch -D prueba-del-smoke
git status --short
```
Expected: sin salida. Verificá además que `app/(app)/usuarios/page.tsx` no tenga el `throw`.

- [ ] **Step 5: Dejar la evidencia escrita**

En `docs/runbook-stacks.md`, sección *Deploy y rollback*, sumar un párrafo corto con: la fecha, el defecto usado, en qué paso frenó el gate y cuál fue el renglón rojo exacto. Un smoke sin esta prueba escrita es un smoke del que dentro de tres meses nadie va a saber si alguna vez atrapó algo.

- [ ] **Step 6: Commit**

```bash
git add docs/runbook-stacks.md
git commit -m "docs: dejar escrito que el smoke autenticado atrapa el defecto

Un smoke que corre y da verde no prueba que atrape nada. Se reintrodujo un
throw de runtime en /usuarios sobre una rama descartable y el gate frenó en
el paso 9, antes de tocar producción."
```

---

## Self-Review

**Cobertura del spec**

| Sección del spec | Task |
|---|---|
| Lista de pantallas por glob, `/` como excepción declarada | 2 (glob) + 3, Step 2 (el `/`) |
| Rutas con parámetro en lista blanca con razón | 2 |
| Falla si el glob no encuentra nada | 2, Step 1 (`check_false "un directorio sin páginas falla"`) |
| Contraseña del canario en el paso 8, con `definir-clave.mts`, como `arandano_app` | 3, Step 1 |
| Login por `/sign-in/email`, cookie extraída a mano | 3, Step 2 |
| `200` **más** el nombre del local | 3, Step 2 (`caso_pantalla`) |
| `data-testid` en el layout de `(app)` | 1 |
| No usar el texto del 404 como marcador | 3, Step 2 (comentario) |
| Frena el paso 9, antes de tocar producción | 4, Step 3 (verificado, no asumido) |
| Riesgo: el `data-testid` es load-bearing | 1, Step 3 (comentario en el layout) |
| Riesgo: la clave versionada | 3, Steps 1 y 2 (comentario con las dos condiciones) |
| Sólo contra stage | Global Constraints |

**Sin placeholders:** cada step trae el código o el comando exacto. Las dos ediciones de documentación (Task 3 Step 6, Task 4 Step 5) dicen qué tiene que decir el texto y en qué sección, que es lo que se puede especificar sin escribir la prosa por el implementador.

**Consistencia de nombres:** `rutas_autenticadas` y `RUTAS_SIN_SMOKE` se definen en la Task 2 y se usan con esos nombres exactos en la Task 3. `data-testid="tenant-nombre"` es el mismo string en la Task 1 (el layout y su test) y en la Task 3 (`grep -qF`). `efimero-clave-canario` y `canario@arandano.app` son los mismos literales en `deploy.sh` (Task 3 Step 1) y en `smoke.sh` (Task 3 Step 2) — duplicación deliberada y comentada en los dos lados, igual que `efimero-salud`.
