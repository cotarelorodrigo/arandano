# Cierre de los bloqueantes del cutover de DNS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el bloque `:80` deje de servir la app en texto plano, que `/api/health` deje de entregar sus internals a cualquiera, y que el gate del deploy siga verificando producción por el mismo camino que hacen los clientes.

**Architecture:** `/api/health` gana un segundo nivel de respuesta: sin credencial devuelve sólo el veredicto, con un header secreto devuelve lo de hoy. La autorización vive en un módulo propio y se compara en tiempo constante. `:80` pasa a redirección pura, y `deploy.sh`/`rollback.sh` migran a `https://localhost` validando contra la CA interna de Caddy — lo que además les suma detección de un certificado sin emitir.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Vitest 4, Node `crypto` (`timingSafeEqual`, `createHash`), Caddy 2, bash, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-09-cutover-dns-design.md`

## El orden importa, y hay una trampa

Leer esto antes de la Task 1. El sistema tiene dos acoplamientos que, mal ordenados, tiran producción:

1. **`ARANDANO_SALUD_TOKEN` tiene que estar en `/srv/arandano/prod/.env` ANTES de que se promueva la imagen nueva.** Si no está, la app nueva responde anónimo, `health_ok` la rechaza —exige `.checks | length > 0`— y el deploy dispara el rollback sin que haya nada roto. Por eso la Task 3 (poner el token) va antes de la Task 6 (deployar), y no al revés.
2. **El Caddyfile del repo no es el que corre.** `/srv/arandano/prod/Caddyfile` se copia **a mano**; `suite_env` de `verify-infra.sh` verifica que no hayan derivado. Cambiar `docker/Caddyfile` no cambia producción hasta que alguien copie y recargue Caddy.

Lo que hace que esto sea seguro: **`https://localhost/api/health` ya funciona hoy**, antes de tocar el Caddyfile, porque el site block `localhost:443` ya existe. Así que el cambio de `URL_SALUD` puede aterrizar y deployarse mientras `:80` sigue siendo un `reverse_proxy`, y recién después se cambia el Caddyfile. En ningún momento hay un estado donde el gate no pueda consultar el healthcheck.

## Global Constraints

- Todo comentario, mensaje de commit y texto de salida **en español**, explicando el **porqué** y no el qué.
- El veredicto anónimo usa `'ok' | 'degraded'` — los valores que ya define `HealthReport` en `lib/health/types.ts`. **No inventar `'error'`.**
- Header exacto: `X-Arandano-Salud`. Variable exacta: `ARANDANO_SALUD_TOKEN`.
- La comparación del token es en **tiempo constante** y **sin filtrar la longitud**: se comparan digests SHA-256, que siempre miden 32 bytes.
- **Falla cerrado**: sin la variable, o con token incorrecto, la respuesta es la anónima. Nunca un 401 — confirmar que existe un modo autenticado es decirle a quien prueba que vale la pena insistir.
- El veredicto (`status` y el código HTTP) sale de **todos** los checks en los dos niveles. Lo único que cambia es cuánto detalle se devuelve.
- Temporales en **`/var/tmp`, nunca `/tmp`** — en este host `/tmp` es tmpfs y compite contra la memoria de producción.
- `verify-infra.sh` corre con `set -uo pipefail` **sin `-e`**: cuenta fallas en vez de abortar. Usar los helpers existentes (`ok`, `bad`, `check_cmd`, `check_eq`, `check_ne`).
- `deploy.sh` y `rollback.sh` corren con `set -euo pipefail`.
- **No correr** `./scripts/verify-infra.sh` sin argumento, con `all` ni con `stress`: la suite `stress` frena el Postgres de producción.
- Producción sólo se lee, salvo los pasos explícitamente marcados en la Task 3 y la Task 6.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/health/autorizacion.ts` *(nuevo)* | Decide si una request puede ver el detalle. Es la única lógica pura de este plan, y por eso la única testeable sin nada más. |
| `lib/health/autorizacion.test.ts` *(nuevo)* | Sus tests. |
| `app/api/health/route.ts` *(modificado)* | Elige el nivel de respuesta. No decide autorización: pregunta. |
| `app/api/health/route.test.ts` *(modificado)* | Los cuatro caminos del endpoint. |
| `lib/health/types.ts` *(modificado)* | Suma el tipo de la respuesta anónima. |
| `docker/Caddyfile` *(modificado)* | `:80` pasa a redirección pura. |
| `scripts/lib/deploy-comun.sh` *(modificado)* | Suma `consultar_salud`, `extraer_ca_caddy` y `token_salud`, que `deploy.sh` y `rollback.sh` comparten. |
| `scripts/deploy.sh` *(modificado)* | `URL_SALUD` de prod, el header, la CA, y el token para `smoke.sh`. |
| `scripts/rollback.sh` *(modificado)* | Lo mismo, para que hable el mismo dialecto. |
| `scripts/smoke.sh` *(modificado)* | Manda el header; recibe el token por entorno. |
| `scripts/verify-infra.sh` *(modificado)* | Dos checks: que `:80` redirija y que la CA valide. |
| `docker/compose.stage.yml` *(modificado)* | El token del stack efímero, inline. |

Las tres funciones nuevas van a `scripts/lib/deploy-comun.sh` y no duplicadas en cada script por una razón concreta: si `deploy.sh` manda el header y `rollback.sh` no, el rollback ve la respuesta anónima —sin `checks`—, `health_ok` la rechaza, y un rollback que levantó perfecto reporta que no verificó. Los dos tienen que hablar exactamente el mismo dialecto.

---

### Task 1: La autorización, en un módulo propio

**Files:**
- Create: `lib/health/autorizacion.ts`
- Test: `lib/health/autorizacion.test.ts`

**Interfaces:**
- Produces:
  - `HEADER_SALUD: string` — la constante `'x-arandano-salud'`, en minúscula porque así llegan los headers en la API `Headers` de Node.
  - `detalleAutorizado(recibido: string | null): boolean` — `true` sólo si `ARANDANO_SALUD_TOKEN` está seteada y `recibido` coincide.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `lib/health/autorizacion.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { detalleAutorizado, HEADER_SALUD } from './autorizacion'

describe('detalleAutorizado', () => {
  const original = process.env.ARANDANO_SALUD_TOKEN

  beforeEach(() => {
    process.env.ARANDANO_SALUD_TOKEN = 'un-token-secreto-largo'
  })
  afterEach(() => {
    if (original === undefined) delete process.env.ARANDANO_SALUD_TOKEN
    else process.env.ARANDANO_SALUD_TOKEN = original
  })

  it('autoriza con el token exacto', () => {
    expect(detalleAutorizado('un-token-secreto-largo')).toBe(true)
  })

  it('rechaza un token distinto', () => {
    expect(detalleAutorizado('otro-token-cualquiera')).toBe(false)
  })

  // Sin igualar longitudes: la comparación es sobre digests SHA-256, que
  // siempre miden 32 bytes, así que ni el largo del token se filtra.
  it('rechaza un token de otra longitud sin romperse', () => {
    expect(detalleAutorizado('x')).toBe(false)
    expect(detalleAutorizado('x'.repeat(500))).toBe(false)
  })

  it('rechaza cuando no viene el header', () => {
    expect(detalleAutorizado(null)).toBe(false)
  })

  it('rechaza el string vacío', () => {
    expect(detalleAutorizado('')).toBe(false)
  })

  // Falla cerrado: una configuración incompleta no puede entregar detalle.
  // Es lo que hace que un misconfig se detecte en el deploy en vez de
  // producir un sistema que parece sano.
  it('rechaza si ARANDANO_SALUD_TOKEN no está seteada', () => {
    delete process.env.ARANDANO_SALUD_TOKEN
    expect(detalleAutorizado('un-token-secreto-largo')).toBe(false)
  })

  it('rechaza si ARANDANO_SALUD_TOKEN está vacía', () => {
    process.env.ARANDANO_SALUD_TOKEN = ''
    expect(detalleAutorizado('')).toBe(false)
  })

  it('expone el header en minúscula, que es como llega', () => {
    expect(HEADER_SALUD).toBe('x-arandano-salud')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/health/autorizacion.test.ts`
Expected: FAIL — `Failed to resolve import "./autorizacion"`.

- [ ] **Step 3: Escribir el módulo**

Crear `lib/health/autorizacion.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * El header que habilita el nivel detallado de /api/health.
 *
 * En minúscula porque la API `Headers` de Node normaliza los nombres al
 * leerlos: `request.headers.get('X-Arandano-Salud')` y
 * `.get('x-arandano-salud')` devuelven lo mismo, pero tener la constante en
 * minúscula evita que alguien la compare a mano contra una clave cruda.
 */
export const HEADER_SALUD = 'x-arandano-salud'

/**
 * Se comparan los DIGESTS y no los tokens.
 *
 * `timingSafeEqual` exige que los dos buffers midan lo mismo, así que la forma
 * ingenua es chequear el largo antes — y ese chequeo filtra la longitud del
 * token a quien mida los tiempos de respuesta. Hasheando primero, los dos lados
 * siempre miden 32 bytes: no hay early return que observar, y la comparación
 * nunca lanza.
 */
function huella(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest()
}

/**
 * ¿Esta request puede ver el detalle del healthcheck?
 *
 * Falla cerrado: sin la variable configurada, o sin header, la respuesta es la
 * anónima. Nunca un 401 — devolver "no autorizado" confirmaría que existe un
 * modo autenticado y que vale la pena insistir. El anónimo no confirma nada.
 *
 * Que la ausencia de configuración se comporte igual que un token incorrecto
 * es deliberado: un `.env` incompleto en producción tiene que producir un
 * deploy que aborta —el gate no recibe `info.sha` y no puede comparar—, no un
 * sistema que parece sano.
 */
export function detalleAutorizado(recibido: string | null): boolean {
  const esperado = process.env.ARANDANO_SALUD_TOKEN
  if (!esperado || !recibido) return false
  return timingSafeEqual(huella(recibido), huella(esperado))
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/health/autorizacion.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/health/autorizacion.ts lib/health/autorizacion.test.ts
git commit -m "feat(salud): autorización del detalle del healthcheck en tiempo constante"
```

---

### Task 2: La ruta en dos niveles

**Files:**
- Modify: `lib/health/types.ts` (agregar un tipo al final)
- Modify: `app/api/health/route.ts` (reescribir el `GET`)
- Test: `app/api/health/route.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `detalleAutorizado(recibido: string | null): boolean` y `HEADER_SALUD: string` de la Task 1.
- Produces: `GET(request: Request)` — la firma cambia, porque ahora necesita leer un header. `HealthResponsePublica` en `lib/health/types.ts`.

- [ ] **Step 1: Agregar el tipo de la respuesta anónima**

Al final de `lib/health/types.ts`:

```ts
/** Lo que ve quien no manda el token: el veredicto y nada más. El `status`
 *  sigue saliendo de TODOS los checks — se recorta el detalle, no la
 *  evaluación—, así que un uptime check externo conserva toda su capacidad de
 *  detección con sólo mirar el código HTTP. */
export type HealthResponsePublica = Pick<HealthReport, 'status'>
```

- [ ] **Step 2: Escribir los tests que fallan**

Agregar a `app/api/health/route.test.ts`, dentro del `describe('GET /api/health')` existente. Los tests actuales no pasan `request`, así que hay que darles uno — y ese es justamente el cambio de firma.

```ts
  // Helper local: una request con o sin el header, para no repetir el
  // constructor en cada caso.
  const pedir = (token?: string) =>
    new Request('http://localhost/api/health', {
      headers: token ? { 'X-Arandano-Salud': token } : {},
    })

  // Los tres checks en verde, para que el veredicto sea 'ok' y lo único que
  // varíe entre casos sea el nivel de detalle.
  //
  // OJO: el cuerpo de este helper NO se inventa. Los mocks de `query` y
  // `clienteQuery` tienen que salir del caso que YA existe en este archivo y
  // que hoy da 200 con los tres checks sanos ("devuelve 200 y reporta el SHA
  // como info, no como check"): copiar sus `mockImplementation` acá y
  // extraerlos a este helper. Si se aproximan de memoria, los checks fallan
  // por el mock y no por el código, y los cinco casos nuevos miden otra cosa.
  const todoSano = () => {
    // ← los dos mockImplementation del caso existente, movidos acá tal cual
  }

  describe('niveles de respuesta', () => {
    beforeEach(() => {
      process.env.ARANDANO_SALUD_TOKEN = 'token-de-prueba'
      process.env.GIT_SHA = 'abc1234'
      todoSano()
    })

    it('sin header devuelve sólo el veredicto', async () => {
      const { GET } = await import('./route')
      const res = await GET(pedir())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ status: 'ok' })
      // Lo que este endpoint filtraba a internet: nombre de base, nombre de
      // rol, subdominio de un tenant real, y el commit exacto corriendo.
      expect(body.checks).toBeUndefined()
      expect(body.info).toBeUndefined()
    })

    it('con el token devuelve los checks y el sha', async () => {
      const { GET } = await import('./route')
      const res = await GET(pedir('token-de-prueba'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.status).toBe('ok')
      expect(body.checks.length).toBeGreaterThan(0)
      expect(body.info.sha).toBe('abc1234')
    })

    // Un 401 confirmaría que existe un modo autenticado. El anónimo no
    // confirma nada, que es el punto.
    it('con un token incorrecto responde como anónimo, no 401', async () => {
      const { GET } = await import('./route')
      const res = await GET(pedir('token-equivocado'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ status: 'ok' })
    })

    it('sin ARANDANO_SALUD_TOKEN configurada responde como anónimo', async () => {
      delete process.env.ARANDANO_SALUD_TOKEN
      const { GET } = await import('./route')
      const res = await GET(pedir('token-de-prueba'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ status: 'ok' })
    })

    // El veredicto sale de todos los checks también en el nivel anónimo: es
    // lo que le permite al uptime check externo seguir detectando una base
    // caída sin ver un solo detalle.
    it('un check caído da 503 y degraded también sin token', async () => {
      query.mockImplementation(() => {
        throw new Error('postgres no responde')
      })
      const { GET } = await import('./route')
      const res = await GET(pedir())
      const body = await res.json()

      expect(res.status).toBe(503)
      expect(body).toEqual({ status: 'degraded' })
    })
  })
```

También hay que darle una `Request` a los tests que ya existían: reemplazar cada `await GET()` por `await GET(pedir('token-de-prueba'))`, y agregar `process.env.ARANDANO_SALUD_TOKEN = 'token-de-prueba'` al `beforeEach` de afuera, porque esos casos verifican el detalle.

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run app/api/health/route.test.ts`
Expected: FAIL — los casos nuevos fallan porque `GET` todavía ignora el header y devuelve siempre la respuesta completa.

- [ ] **Step 4: Reescribir la ruta**

Reemplazar el contenido de `app/api/health/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { runChecks } from '@/lib/health/runChecks'
import { checks } from '@/lib/health/checks'
import { healthInfo } from '@/lib/health/info'
import { detalleAutorizado, HEADER_SALUD } from '@/lib/health/autorizacion'
import type { HealthResponse, HealthResponsePublica } from '@/lib/health/types'

// Un healthcheck cacheado es un healthcheck que miente.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // El veredicto sale SÓLO de los checks. `info` viaja al lado, como
  // contexto: no puede fallar, así que no vota.
  //
  // Los checks corren SIEMPRE, con o sin token: el `status` y el código HTTP
  // son iguales en los dos niveles. Lo único que cambia es cuánto se cuenta.
  // De eso depende que un uptime check externo, que nunca manda el token,
  // siga detectando una base caída.
  const report = await runChecks(checks)
  const status = report.status === 'ok' ? 200 : 503

  if (!detalleAutorizado(request.headers.get(HEADER_SALUD))) {
    // Sin el detalle, este endpoint deja de entregar el nombre de la base, el
    // del rol de conexión, el subdominio de un tenant real y el commit exacto
    // que está corriendo. Era reconocimiento servido a cualquiera que
    // supiera la URL.
    const publica: HealthResponsePublica = { status: report.status }
    return NextResponse.json(publica, { status })
  }

  const respuesta: HealthResponse = { ...report, info: healthInfo() }
  return NextResponse.json(respuesta, { status })
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run app/api/health/route.test.ts`
Expected: PASS, incluidos los cinco casos nuevos.

- [ ] **Step 6: Correr la suite entera, que es donde aparecen las regresiones**

Run: `npm test`
Expected: todo en verde. Si algún test de otro archivo llamaba a `GET()` sin argumento, falla acá y hay que darle una `Request`.

- [ ] **Step 7: Commit**

```bash
git add lib/health/types.ts app/api/health/route.ts app/api/health/route.test.ts
git commit -m "feat(salud): /api/health responde el veredicto a todos y el detalle sólo con token"
```

---

### Task 3: El token en los tres stacks

Tarea de operación: toca archivos fuera del repo. **Va antes de la Task 6 y no al revés** — si la imagen nueva se promueve sin el token en `/srv/arandano/prod/.env`, la app responde anónimo, `health_ok` la rechaza por no tener `checks`, y el deploy rollbackea sin que haya nada roto.

**Files:**
- Modify: `/srv/arandano/prod/.env` *(fuera del repo, 0600)*
- Modify: `/srv/arandano/ensayo/.env` *(fuera del repo)*
- Modify: `docker/compose.stage.yml`

**Interfaces:**
- Produces: `ARANDANO_SALUD_TOKEN` disponible en el entorno de la app de los tres stacks. Para stage, el valor literal `efimero-salud`, que la Task 4 vuelve a usar en `deploy.sh`.

- [ ] **Step 1: Generar el token de producción y ponerlo en su `.env`**

```bash
TOKEN=$(openssl rand -hex 32)
printf 'ARANDANO_SALUD_TOKEN=%s\n' "$TOKEN" >> /srv/arandano/prod/.env
chmod 600 /srv/arandano/prod/.env
grep -c '^ARANDANO_SALUD_TOKEN=' /srv/arandano/prod/.env
unset TOKEN
```

Expected: imprime `1`. **No imprimir el valor**: queda en el historial de la shell y en el log de la sesión.

- [ ] **Step 2: Lo mismo para ensayo**

```bash
printf 'ARANDANO_SALUD_TOKEN=%s\n' "$(openssl rand -hex 32)" >> /srv/arandano/ensayo/.env
grep -c '^ARANDANO_SALUD_TOKEN=' /srv/arandano/ensayo/.env
```

Expected: `1`. Distinto del de prod a propósito: un token por stack, como las credenciales de sus bases.

- [ ] **Step 3: El de stage, inline en el compose**

En `docker/compose.stage.yml`, dentro de `environment:` del servicio `app`, después de `TENANT_CANARIO_SUBDOMINIO`:

```yaml
      # Token en claro en un archivo versionado, por el mismo motivo que las
      # credenciales de este stack unas líneas más arriba: la base es efímera,
      # nace vacía en cada corrida, nunca ve datos de clientes, y el stack sólo
      # escucha en la IP de Tailscale. No hay secreto que proteger.
      # OJO: este literal está DUPLICADO en scripts/deploy.sh, que se lo pasa a
      # smoke.sh. Si cambia acá, cambia allá — igual que efimero-app y
      # efimero-owner, que ya viven así.
      ARANDANO_SALUD_TOKEN: efimero-salud
```

- [ ] **Step 4: Verificar que la app de prod recibe la variable**

El contenedor todavía corre la imagen vieja, que ignora la variable — lo que se comprueba acá es que `env_file` la propaga.

```bash
( cd /srv/arandano/prod && docker compose up -d --no-deps app )
docker exec arandano-prod-app-1 sh -c 'test -n "$ARANDANO_SALUD_TOKEN" && echo "la variable llegó"'
```

Expected: `la variable llegó`.

- [ ] **Step 5: Verificar que el healthcheck del contenedor sigue sano**

`compose.prod.yml` chequea con `wget --spider http://127.0.0.1:3000/api/health`, que sólo mira el código HTTP. Con la respuesta anónima el código sigue siendo 200, así que **no hay que tocarlo**. Este paso existe para que quede comprobado y nadie lo "arregle".

```bash
sleep 45
docker ps --filter name=arandano-prod-app-1 --format '{{.Status}}'
```

Expected: `Up ... (healthy)`.

- [ ] **Step 6: Commit**

Sólo el compose. **Nada de `/srv` se versiona**: son credenciales.

```bash
git add docker/compose.stage.yml
git commit -m "feat(salud): token del healthcheck en el stack efímero de stage"
```

---

### Task 4: El acoplamiento, en un solo commit

Caddyfile, los dos scripts del gate y el smoke test cambian juntos. El spec explica por qué: separarlos deja un estado en el que cada deploy sano dispara el rollback, y `--objetivo=ensayo` no puede atraparlo porque pega directo al puerto de la app.

**Files:**
- Modify: `docker/Caddyfile:61-63`
- Modify: `scripts/lib/deploy-comun.sh` (tres funciones nuevas)
- Modify: `scripts/deploy.sh` (el `case` del objetivo, el poll del paso 16, la invocación de `smoke.sh`)
- Modify: `scripts/rollback.sh` (el `case` del objetivo, el poll)
- Modify: `scripts/smoke.sh` (el `curl` del healthcheck)

**Interfaces:**
- Consumes: `health_ok(json)` y `sha_del_health(json)`, que ya existen en `scripts/lib/deploy-comun.sh` y **no cambian**.
- Produces, en `scripts/lib/deploy-comun.sh`:
  - `token_salud <dir>` → imprime el `ARANDANO_SALUD_TOKEN` del `.env` de ese directorio; sale ≠0 si falta.
  - `extraer_ca_caddy <dir> <destino>` → escribe la raíz de la CA interna en `<destino>`; sale ≠0 si sale vacía.
  - `consultar_salud <url> <token> [cacert]` → imprime el cuerpo del healthcheck.

- [ ] **Step 1: Agregar las tres funciones a `scripts/lib/deploy-comun.sh`**

Después de `sha_del_health`:

```bash
# El token del objetivo, leído de su .env.
#
# En un subshell a propósito: ese archivo también tiene las credenciales de la
# base, y sourcearlo en el proceso principal las dejaría en el entorno de todo
# lo que el script ejecute después.
token_salud() {
  local dir="$1" token
  token=$(
    set -a
    # shellcheck disable=SC1091
    . "$dir/.env" 2>/dev/null || true
    set +a
    printf '%s' "${ARANDANO_SALUD_TOKEN:-}"
  )
  if [[ -z "$token" ]]; then
    error "falta ARANDANO_SALUD_TOKEN en $dir/.env — sin él el healthcheck responde anónimo, sin checks ni sha, y el gate lo rechaza"
    return 1
  fi
  printf '%s' "$token"
}

# La raíz de la CA interna de Caddy, del volumen del stack.
#
# Se valida el certificado en vez de usar `curl -k` porque es lo único que hace
# que el gate detecte que Caddy no logró aprovisionar el certificado — el modo
# de falla que el Caddyfile marca como indistinguible de un TLS roto del lado
# del cliente. Con -k, un deploy pasaría en verde con el sitio inaccesible para
# cualquier navegador.
extraer_ca_caddy() {
  local dir="$1" destino="$2"
  ( cd "$dir" && docker compose exec -T caddy \
      cat /data/caddy/pki/authorities/local/root.crt ) > "$destino" 2>/dev/null || true
  if [[ ! -s "$destino" ]]; then
    error "no se pudo extraer la raíz de la CA interna de Caddy desde $dir"
    return 1
  fi
}

# El cuerpo del healthcheck del objetivo, autenticado.
#
# Vive acá y no duplicada en deploy.sh y rollback.sh porque los dos tienen que
# hablar EXACTAMENTE el mismo dialecto: si uno manda el header y el otro no, el
# que no lo manda recibe la respuesta anónima —sin `checks`—, `health_ok` la
# rechaza, y un rollback que levantó perfecto reporta que no verificó.
consultar_salud() {
  local url="$1" token="$2" cacert="${3:-}"
  local args=(-sS --max-time 5 -H "X-Arandano-Salud: $token")
  [[ -n "$cacert" ]] && args+=(--cacert "$cacert")
  curl "${args[@]}" "$url/api/health" 2>/dev/null
}
```

- [ ] **Step 2: Cambiar el `case` del objetivo en `deploy.sh`**

Reemplazar el comentario largo de `deploy.sh:71-88` (el que empieza con `# ATENCIÓN, futuro cutover de DNS:`) y la línea de `prod` del `case`:

```bash
# El URL_SALUD de `prod` entra por el site block `localhost:443` del Caddyfile,
# NO por el `:80`, que desde el cutover es sólo `redir https://{host}{uri}`.
#
# Se valida el certificado contra la raíz de la CA interna de Caddy (ver
# extraer_ca_caddy): así el poll detecta también que Caddy no haya podido
# aprovisionar el certificado, que antes pasaba desapercibido.
#
# `ensayo` sigue pegando directo al puerto de la app: ese stack no tiene Caddy
# (compose.ensayo.yml define sólo postgres y app), así que el ensayo del gate
# NO ejercita ni el proxy ni el TLS. Es un punto ciego real y conocido; la
# única verificación de esa parte es un deploy contra producción.
#
# DOMINIO_BASE_CANARIO y NOMBRE_CANARIO alimentan el paso 14 (alta del
# canario contra el objetivo): mismo dominio que ARANDANO_DB_ESPERADA usa
# para identificar el stack, uno por rama del case, para que la URL que
# imprime crear-tenant.mts sea la real del objetivo y no la de stage.
case "$OBJETIVO" in
  prod)   DIR=/srv/arandano/prod;   URL_SALUD=https://localhost;         TAGEA=true;  DOMINIO_BASE_CANARIO=arandano.app;       NOMBRE_CANARIO="Canario" ;;
  ensayo) DIR=/srv/arandano/ensayo; URL_SALUD=http://100.64.81.63:3002;  TAGEA=false; DOMINIO_BASE_CANARIO=stage.arandano.app; NOMBRE_CANARIO="Canario de ensayo" ;;
  *) error "objetivo inválido: $OBJETIVO"; uso ;;
esac

# El token y la CA del objetivo. Se resuelven una vez, temprano: si falta el
# token, es mejor abortar antes de buildear que después de promover.
TOKEN_SALUD=$(token_salud "$DIR")
CA_SALUD=""
if [[ "$URL_SALUD" == https://* ]]; then
  CA_SALUD=$(mktemp -p /var/tmp arandano-ca.XXXXXXXX)
  extraer_ca_caddy "$DIR" "$CA_SALUD"
fi
```

El borrado del temporal NO va acá: va dentro de `limpiar`, por lo que explica
el recuadro de abajo.

> `/var/tmp` y no `/tmp`: en este host `/tmp` es tmpfs y compite contra la memoria de producción.

> **NO agregar un `trap … EXIT` en `deploy.sh`.** Ya tiene uno —
> `trap limpiar EXIT` en la línea 204— y **un segundo `trap … EXIT` reemplaza al
> primero en silencio**, no se acumulan. `limpiar` baja la shadow database,
> baja `arandano-stage` y vuelve a levantar `arandano-dev`; perderla deja
> ~1,28 GB de tmpfs reservados y dev abajo, con un síntoma que no apunta para
> nada a este cambio.
>
> El borrado de la CA va **dentro de `limpiar`**, y **después** de su
> `local codigo=$?` — esa primera línea captura el código de salida original y
> cualquier comando antes de ella lo pisa:
>
> ```bash
> limpiar() {
>   local codigo=$? rc=0 fallo_limpieza=false
>   set +e
>   # La raíz de la CA es un temporal en claro; se va pase lo que pase.
>   rm -f "${CA_SALUD:-}"
>   # … el resto de la función, sin cambios
> ```
>
> `${CA_SALUD:-}` y no `$CA_SALUD`: bajo `set -u`, si el script muere antes de
> que el `case` asigne la variable, `limpiar` tiene que poder evaluarse igual.
>
> En `rollback.sh` la situación es la contraria: tiene `trap 'exit 130' INT` y
> `trap 'exit 143' TERM`, pero **ningún `EXIT`**, así que ahí sí se agrega uno
> nuevo tal como está escrito arriba.

- [ ] **Step 3: Cambiar el poll del paso 16 en `deploy.sh`**

Reemplazar la línea `deploy.sh:1022`:

```bash
  salud=$(consultar_salud "$URL_SALUD" "$TOKEN_SALUD" "$CA_SALUD") || salud=""
```

El resto del bloque (`health_ok`, `sha_del_health`, el `break`, el `rollback_y_salir`) **no cambia**: la forma del cuerpo autenticado es idéntica a la de hoy.

- [ ] **Step 4: Pasarle el token a `smoke.sh`**

Reemplazar `deploy.sh:603`:

```bash
# Por entorno y no por argumento: un argumento queda visible en `ps` para
# cualquier proceso del host. El valor está DUPLICADO en
# docker/compose.stage.yml, igual que efimero-app y efimero-owner — es un
# stack efímero que nunca ve datos de clientes.
ARANDANO_SALUD_TOKEN=efimero-salud \
  scripts/smoke.sh "http://${url_stage}" "$SHA" "stage.arandano.app" "canario" "$NOMBRE_CANARIO_STAGE"
```

- [ ] **Step 5: Los mismos dos cambios en `rollback.sh`**

Reemplazar el comentario de `rollback.sh:59-68` y la línea de `prod` del `case`:

```bash
# El URL_SALUD de `prod` es el mismo de deploy.sh y entra por el site block
# `localhost:443`, no por el `:80`, que desde el cutover es sólo redirección.
# Los dos scripts tienen que hablar el mismo dialecto: si uno manda el header
# del healthcheck y el otro no, el que no lo manda recibe la respuesta anónima
# —sin `checks`—, health_ok la rechaza, y un rollback que levantó perfecto
# reporta "NO VERIFICÓ EN 90s". Como deploy.sh usa este script como su rollback
# automático, eso se convierte en su salida 3 sin que nada esté roto.
case "$OBJETIVO" in
  prod)   DIR=/srv/arandano/prod;   URL_SALUD=https://localhost ;;
  ensayo) DIR=/srv/arandano/ensayo; URL_SALUD=http://100.64.81.63:3002 ;;
  *) error "objetivo inválido: $OBJETIVO"; uso ;;
esac

TOKEN_SALUD=$(token_salud "$DIR")
CA_SALUD=""
if [[ "$URL_SALUD" == https://* ]]; then
  CA_SALUD=$(mktemp -p /var/tmp arandano-ca.XXXXXXXX)
  trap 'rm -f "$CA_SALUD"' EXIT
  extraer_ca_caddy "$DIR" "$CA_SALUD"
fi
```

Y reemplazar `rollback.sh:260`:

```bash
  salud=$(consultar_salud "$URL_SALUD" "$TOKEN_SALUD" "$CA_SALUD") || salud=""
```

> **Ojo con el `trap`:** `rollback.sh` ya tiene un `trap` de `INT`. Los de `EXIT` e `INT` son independientes y no se pisan. Si el archivo ya tuviera un `trap ... EXIT`, hay que **componer** las dos acciones en un solo `trap`, no agregar un segundo, porque el segundo reemplaza al primero en silencio.

- [ ] **Step 6: Que `smoke.sh` mande el header**

Reemplazar `scripts/smoke.sh:53`:

```bash
# El token llega por entorno, no por argumento: un argumento queda visible en
# `ps`. Sin él, /api/health devuelve sólo el veredicto y los casos que miran
# .checks[] y el sha fallan — que es lo correcto: significa que el smoke test
# no está probando lo que cree.
SALUD=$(curl -fsS --max-time 10 \
  -H "X-Arandano-Salud: ${ARANDANO_SALUD_TOKEN:?falta ARANDANO_SALUD_TOKEN}" \
  "$URL_BASE/api/health" 2>/dev/null) || SALUD=""
```

- [ ] **Step 7: El bloque `:80` del Caddyfile**

Reemplazar `docker/Caddyfile:28-63` — el comentario largo de ATENCIÓN y el bloque — por:

```
# Sólo redirección, nunca reverse_proxy. Este puerto existe para resolver el
# desafío HTTP de ACME y para empujar a todo el mundo a TLS; no para servir la
# app.
#
# 308 y no el 302 que Caddy usa por default: es permanente y preserva el
# método, así que un POST a http:// no se degrada en silencio a GET.
#
# CONSECUENCIA BUSCADA: la app deja de ser alcanzable por IP. `{host}` es el
# Host de la request, así que quien entre por http://178.156.251.41/ recibe un
# 308 hacia https://178.156.251.41/, cuyo SNI es la IP y no matchea ningún site
# block — el TLS falla y no hay respuesta. La app se sirve por nombre. No es
# una regresión: es el motivo del cambio.
#
# El gate del deploy NO entra por acá: deploy.sh y rollback.sh consultan
# https://localhost/api/health, o sea el site block de arriba, validando contra
# la raíz de la CA interna. Cambiar esa URL y este bloque en commits separados
# es lo que rompía producción — ver el spec del cutover.
:80 {
	redir https://{host}{uri} 308
}
```

- [ ] **Step 8: Verificar que los scripts parsean y que la config de Caddy es válida**

```bash
bash -n scripts/deploy.sh && bash -n scripts/rollback.sh && \
  bash -n scripts/smoke.sh && bash -n scripts/lib/deploy-comun.sh && echo "sintaxis ok"

docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

Expected: `sintaxis ok`, y `Valid configuration` de Caddy.

- [ ] **Step 9: Verificar que `consultar_salud` trae el detalle contra producción**

Producción todavía corre la imagen vieja, que ignora el header y devuelve todo. Lo que se comprueba acá es que el transporte nuevo —https, CA, header— funciona.

```bash
source scripts/lib/deploy-comun.sh
CA=$(mktemp -p /var/tmp arandano-ca.XXXXXXXX)
extraer_ca_caddy /srv/arandano/prod "$CA"
SALUD=$(consultar_salud https://localhost "$(token_salud /srv/arandano/prod)" "$CA")
health_ok "$SALUD" && echo "health_ok: sano"
echo "sha reportado: $(sha_del_health "$SALUD")"
rm -f "$CA"
```

Expected: `health_ok: sano` y el SHA del commit corriendo.

- [ ] **Step 10: Commit — uno solo, con los cinco archivos**

```bash
git add docker/Caddyfile scripts/lib/deploy-comun.sh scripts/deploy.sh \
        scripts/rollback.sh scripts/smoke.sh
git commit -m "feat(cutover): :80 pasa a redirección y el gate consulta el healthcheck por TLS

Los cinco archivos van juntos porque separarlos deja un estado donde cada
deploy sano dispara el rollback automático, y --objetivo=ensayo no puede
atraparlo: ese stack no tiene Caddy."
```

---

### Task 5: Los checks de la suite

**Files:**
- Modify: `scripts/verify-infra.sh` (ampliar `suite_network`)

**Interfaces:**
- Consumes: los helpers `ok`, `bad`, `check_eq`, `check_cmd` que ya existen.

- [ ] **Step 1: Escribir los checks**

Al final de `suite_network()` en `scripts/verify-infra.sh`:

```bash
  # El check que habría atrapado el estado anterior. Durante meses
  # `curl http://127.0.0.1/api/health` devolvió 200: el bloque :80 era un
  # reverse_proxy catch-all sirviendo la app en texto plano a internet, con el
  # nombre de la base, el del rol y el sha adentro de la respuesta.
  local codigo_80
  codigo_80=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    http://127.0.0.1/api/health 2>/dev/null || echo 000)
  check_eq ":80 redirige en vez de servir la app" "308" "$codigo_80"

  # Que el site block localhost:443 siga sirviendo Y que su certificado valide
  # contra la CA interna. De esto depende el gate del deploy: si Caddy no
  # aprovisiona el certificado, deploy.sh y rollback.sh no pueden consultar el
  # healthcheck.
  local ca_tmp verifico
  ca_tmp=$(mktemp -p /var/tmp arandano-ca-check.XXXXXXXX)
  ( cd /srv/arandano/prod && docker compose exec -T caddy \
      cat /data/caddy/pki/authorities/local/root.crt ) > "$ca_tmp" 2>/dev/null || true
  if [[ -s "$ca_tmp" ]]; then
    verifico=$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 5 \
      --cacert "$ca_tmp" https://localhost/api/health 2>/dev/null || echo 99)
  else
    verifico=99
  fi
  rm -f "$ca_tmp"
  check_eq "el certificado de localhost valida contra la CA interna" "0" "$verifico"
```

- [ ] **Step 2: Correr la suite y ver el estado real**

Run: `./scripts/verify-infra.sh network`
Expected: el check de la CA **pasa** (ya funciona hoy). El de `:80` **falla** con `obtenido: 200`, porque el Caddyfile del repo cambió pero `/srv/arandano/prod/Caddyfile` todavía no. Ese rojo es correcto y lo cierra la Task 6.

- [ ] **Step 3: Demostrar que el check de la CA no es vacío**

Un check que da ✓ pase lo que pase es peor que no tenerlo.

```bash
curl -s -o /dev/null -w 'sin CA: ssl_verify_result=%{ssl_verify_result}\n' \
  --max-time 5 https://localhost/api/health 2>/dev/null || echo "sin CA: falla el handshake"
```

Expected: falla, o devuelve un `ssl_verify_result` distinto de 0. Confirma que el `--cacert` es lo que hace pasar el check, y no que curl acepte cualquier cosa.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-infra.sh
git commit -m "test(infra): comprobar que :80 redirige y que el certificado de localhost valida"
```

---

### Task 6: Aplicar a producción y cerrar la documentación

La única verificación real del conjunto. **Ventana de deploy**: temprano a la mañana o de noche hora Argentina (UTC-3), porque sin feature flags un deploy malo alcanza a todos a la vez.

**Files:**
- Modify: `/srv/arandano/prod/Caddyfile` *(fuera del repo — la copia es manual)*
- Modify: `CLAUDE.md` (los bloqueantes del cutover)

- [ ] **Step 1: Deployar, con el `:80` todavía viejo**

El orden es deliberado: `https://localhost` ya funciona hoy, así que el gate nuevo verifica bien contra el Caddyfile viejo. Deployar primero deja la app nueva —la que exige el token— corriendo antes de tocar el proxy.

```bash
./scripts/deploy.sh
```

Expected: los 18 pasos en verde y un tag nuevo. Si aborta en el paso 16 con "el healthcheck no dio sano", el sospechoso número uno es `ARANDANO_SALUD_TOKEN` faltando o mal copiado en `/srv/arandano/prod/.env` (Task 3, step 1).

- [ ] **Step 2: Comprobar los dos niveles contra producción real**

```bash
echo "--- anónimo ---"
CA=$(mktemp -p /var/tmp ca.XXXXXX)
( cd /srv/arandano/prod && docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt ) > "$CA"
curl -s --cacert "$CA" https://localhost/api/health
echo; echo "--- con token ---"
source scripts/lib/deploy-comun.sh
curl -s --cacert "$CA" -H "X-Arandano-Salud: $(token_salud /srv/arandano/prod)" \
  https://localhost/api/health | head -c 200
rm -f "$CA"
```

Expected: el primero devuelve exactamente `{"status":"ok"}`. El segundo, el objeto completo con `checks` e `info.sha`.

- [ ] **Step 3: Copiar el Caddyfile y recargar**

```bash
cp docker/Caddyfile /srv/arandano/prod/Caddyfile
( cd /srv/arandano/prod && docker compose exec -T caddy \
    caddy reload --config /etc/caddy/Caddyfile )
```

`reload` y no `restart`: Caddy recarga la configuración sin cortar conexiones en curso.

- [ ] **Step 4: Comprobar que `:80` redirige y que la IP dejó de servir**

```bash
curl -s -o /dev/null -w 'localhost:80  -> %{http_code}  location=%{redirect_url}\n' http://127.0.0.1/api/health
curl -s -o /dev/null -w 'IP pública:80 -> %{http_code}\n' --max-time 5 http://178.156.251.41/api/health
curl -s -o /dev/null -w 'IP pública:443 -> %{http_code}\n' --max-time 5 https://178.156.251.41/api/health || echo "IP pública:443 -> TLS rechazado (esperado)"
```

Expected: el primero `308` con `location=https://127.0.0.1/api/health`. El segundo `308`. El tercero falla el TLS — la app dejó de ser alcanzable por IP, que es el objetivo.

- [ ] **Step 5: Correr la suite y verificar que ahora sí pasa entera**

Run: `./scripts/verify-infra.sh network` y después `./scripts/verify-infra.sh env`
Expected: los dos en `0 fallan`. El de `env` importa porque compara `docker/Caddyfile` contra `/srv/arandano/prod/Caddyfile`: si el `cp` no se hizo, ahí sale.

- [ ] **Step 6: Ensayar el rollback, que es la red que nadie prueba**

`rollback.sh` cambió y sólo se ejercita cuando algo sale mal. Correrlo a mano ahora, contra ensayo, es la única forma de saber que el dialecto nuevo funciona antes de necesitarlo de verdad.

```bash
./scripts/deploy.sh --objetivo=ensayo
```

Expected: el gate completo en verde contra `arandano-ensayo`, sin crear tag. Cubre `token_salud` y `consultar_salud` sin CA (ensayo no tiene Caddy).

- [ ] **Step 7: Cerrar los bloqueantes en `CLAUDE.md`**

En *Bloqueantes antes del cutover de DNS*, marcar los puntos 2, 3 y 4 como hechos y dejar el 1 abierto:

```markdown
2. ~~**El bloque `:80` del Caddyfile tiene que pasar a ser sólo redirección.**~~
   **Hecho** (2026-08-09). `redir https://{host}{uri} 308`. La app dejó de ser
   alcanzable por IP, a propósito. Ver
   `docs/superpowers/specs/2026-08-09-cutover-dns-design.md`.
3. ~~**Decidir si `/api/health` se autentica o se restringe por origen.**~~
   **Hecho** (2026-08-09). Dos niveles: sin credencial devuelve sólo el
   veredicto —lo que un uptime check externo necesita—, y con el header
   `X-Arandano-Salud` devuelve los checks y el `sha`. **Lo que NO resuelve**:
   el amplificador de carga. El nivel anónimo sigue costando un ida y vuelta a
   Postgres contra un pool de `max: 5`, y Caddy en su build estándar no trae
   rate limiting.
4. ~~**Quien toque el bloque `:80` tiene que cambiar `URL_SALUD` en los dos
   scripts en el mismo commit.**~~ **Hecho** (2026-08-09). `URL_SALUD` de prod
   es `https://localhost`, validando contra la raíz de la CA interna de Caddy —
   lo que además le suma al gate detectar un certificado sin emitir, que antes
   pasaba desapercibido. El punto ciego de `--objetivo=ensayo` sigue existiendo:
   ese stack no tiene Caddy, así que no ejercita ni el proxy ni el TLS.
```

- [ ] **Step 8: Documentar la rotación del token**

Un secreto sin procedimiento de rotación escrito es un secreto que nunca se
rota. Agregar a `docs/runbook-stacks.md`, en la sección *Deploy y rollback*:

```markdown
### Rotar el token del healthcheck

`ARANDANO_SALUD_TOKEN` habilita el nivel detallado de `/api/health` — los
checks con su detalle y el `sha`. Sin él, el endpoint devuelve sólo el
veredicto, y `deploy.sh` no puede comparar el sha contra la imagen que
promovió.

```bash
# 1. Reemplazar el valor en el .env del stack
sed -i "s/^ARANDANO_SALUD_TOKEN=.*/ARANDANO_SALUD_TOKEN=$(openssl rand -hex 32)/" \
  /srv/arandano/prod/.env

# 2. Recrear la app para que lo tome (env_file se lee al arrancar)
( cd /srv/arandano/prod && docker compose up -d --no-deps --force-recreate app )

# 3. Comprobar que el nivel detallado sigue respondiendo
source /root/arandano/scripts/lib/deploy-comun.sh
CA=$(mktemp -p /var/tmp ca.XXXXXX)
extraer_ca_caddy /srv/arandano/prod "$CA"
consultar_salud https://localhost "$(token_salud /srv/arandano/prod)" "$CA" | head -c 120
rm -f "$CA"
```

No hace falta tocar el uptime check externo: monitorea con el nivel anónimo, a
propósito, para que rotar este token no lo ponga en rojo. El token de stage
(`efimero-salud`) no se rota: vive en claro en `docker/compose.stage.yml` y en
`scripts/deploy.sh` porque ese stack es efímero y nunca ve datos de clientes.
```

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md docs/runbook-stacks.md
git commit -m "docs: cerrar los bloqueantes 2, 3 y 4 del cutover, y documentar la rotación del token"
```

---

## Lo que este plan no cierra

- **El primer bloqueante del cutover**: `dig arandano.app` sigue sin resolver, y desde este servidor no se puede distinguir si nunca se registró, si expiró, o si está registrado sin zona publicada. No es una tarea de código.
- **El rate limiting de `/api/health`.** Sumarlo es meter un plugin a Caddy, que es su propia decisión.
- **El certificado wildcard por DNS-01 y el site block del dominio real.** Entran en el cutover. El `localhost:443` queda **intacto** para diagnóstico local y para el gate del deploy.
- **El uptime check externo y Sentry.** Su propio ciclo. Este plan deja `/api/health` en condiciones de recibirlo sin exponer internals, que era la precondición.
