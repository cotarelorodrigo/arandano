# El bot en modo prueba — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño pueda poner el bot de WhatsApp en un modo **Sólo prueba**, donde contesta únicamente a una lista de números que carga él, sin que ningún cliente real reciba respuesta.

**Architecture:** `BotDeWhatsapp.activo` pasa a ser `modo` (`APAGADO | PRUEBA | TODOS`), con `activo` todavía escrito como `modo === 'TODOS'` para que un rollback de imagen deje al bot callado. Los números viven en una tabla propia con RLS (`numeros_de_prueba_bot`) y se comparan contra el `waId` por los últimos 10 dígitos, con funciones puras en `lib/bot/numeros-de-prueba.ts`. La regla entra en `evaluarCorte` del webhook como un motivo nuevo (`MODO_PRUEBA`), y la pantalla `/bot` cambia el switch por un segmentado de tres opciones con confirmación en dos toques para pasar a Todos, más una card para administrar los números.

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma sobre PostgreSQL con RLS por `tenant_id`, vitest contra un Postgres efímero, shadcn/ui (Radix `ToggleGroup`) sobre Tailwind v4, sonner para los avisos.

**Spec:** `docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md`

## Global Constraints

- **Worktree**: la feature se construye en un worktree aparte. `EnterWorktree` ramifica de `origin/main`, que puede estar atrás del `main` local: antes de empezar, `git reset --hard main` dentro del worktree recién creado (está vacío de trabajo propio) y confirmar con `git log --oneline -1` que el HEAD es el de `main`.
- **Todo en castellano rioplatense**: nombres de funciones, variables, tipos, tablas, columnas, mensajes de error, comentarios y copy de pantalla.
- **Toda tabla nueva lleva `tenant_id`, `ENABLE ROW LEVEL SECURITY` y la policy `tenant_aislamiento`** escrita a mano en la migración (Prisma no la genera). `test/rls-cobertura.test.ts` falla si falta.
- **Las migraciones son sólo aditivas**: cero `DROP`, cero renombres. `npx prisma migrate dev` en desarrollo. **Nunca `prisma migrate reset`**: contra la base de dev borra `_prisma_migrations` y aborta con P3016 (ver `docs/runbook-stacks.md`). Si `migrate dev` pide un reset por drift, parar y avisar.
- **Después de la migración hay que regenerar el ERD**: `scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md`. El paso 3 de `deploy.sh` lo verifica.
- **`activo` se sigue escribiendo como `modo === 'TODOS'`** en toda escritura de `modo`. Es lo que hace que, si el healthcheck revierte la imagen durante una prueba, la imagen vieja lea `activo = false` y se calle. Nunca `modo !== 'APAGADO'`.
- **Un módulo que importe `lib/db.ts` o `lib/tenant/prisma.ts` (directa o transitivamente) no puede importarse desde un archivo `'use client'`**: arrastra `pg` al bundle. `lib/bot/numeros-de-prueba.ts` y `lib/bot/modo.ts` son puros justamente para que `formularios.tsx` los pueda importar. `test/limite-cliente-servidor.test.ts` lo vigila.
- **Un archivo `'use server'` sólo exporta funciones async.** `test/use-server.test.ts` lo vigila.
- **Mobile-first**: el valor del teléfono sin prefijo, el de escritorio con `lg:` (1024 px). Prohibido `sm:`/`md:` en código propio.
- **Cada server action vuelve a exigir lo suyo**: `exigirPermiso('BOT')` y después `botHabilitadoEn(sesion.subdominio)`. Los casos de guarda cuentan en las dos direcciones.
- **Correr los tests**: `npx vitest run <archivo>`. La suite completa es `npm test`. El Postgres efímero lo levanta `test/global-setup.ts`.
- **Cómo se ve un número en pantalla**: los últimos 10 dígitos como `112233-4455` (seis, guion, cuatro). El spec pone de ejemplo `11 2233-4455`, pero los códigos de área argentinos tienen de 2 a 4 dígitos y no se sabe dónde partir, así que no se inventa un espacio que en Córdoba (`351`) quedaría mal puesto. La Task 8 alinea el spec.

---

### Task 1: Las reglas puras — números de prueba y modo del bot

Dos módulos sin ningún import de Prisma: la comparación de números (la usan el webhook, `administrar.ts` y la pantalla) y la lógica del segmentado (la usan `administrar.ts` para validar y la pantalla para el doble toque). Una sola implementación de cada regla.

**Files:**
- Create: `lib/bot/numeros-de-prueba.ts`
- Create: `lib/bot/numeros-de-prueba.test.ts`
- Create: `lib/bot/modo.ts`
- Create: `lib/bot/modo.test.ts`

**Interfaces:**
- Produces (`lib/bot/numeros-de-prueba.ts`):
  - `TOPE_NUMEROS_DE_PRUEBA = 20`
  - `digitosDe(texto: string): string`
  - `ultimos10(digitos: string): string`
  - `validarNumeroDePrueba(texto: string): { ok: true; digitos: string } | { ok: false; problema: 'NUMERO_CORTO' | 'NUMERO_LARGO' }`
  - `coinciden(a: string, b: string): boolean`
  - `coincideConAlguno(waId: string, numeros: readonly string[]): boolean`
  - `mostrarNumeroDePrueba(digitos: string): string`
- Produces (`lib/bot/modo.ts`):
  - `MODOS = ['APAGADO', 'PRUEBA', 'TODOS'] as const`, `type Modo`
  - `esModo(valor: unknown): valor is Modo`
  - `MS_CONFIRMACION_TODOS = 3000`
  - `tocarModo(estado: { modo: Modo; armadoTodos: boolean }, tocado: Modo): { cambiarA: Modo | null; armadoTodos: boolean }`
  - `leyendaDelModo(entrada: { modo: Modo; cantidadNumeros: number; armadoTodos: boolean }): string`
  - `subtituloDelModo(modo: Modo): string`

- [ ] **Step 1: Escribir los tests de `numeros-de-prueba`**

```ts
// lib/bot/numeros-de-prueba.test.ts
import { describe, it, expect } from 'vitest'
import {
  coincideConAlguno,
  coinciden,
  digitosDe,
  mostrarNumeroDePrueba,
  ultimos10,
  validarNumeroDePrueba,
} from './numeros-de-prueba'

describe('digitosDe', () => {
  it('se queda sólo con los dígitos, sea cual sea la forma de tipearlo', () => {
    expect(digitosDe('+54 9 (11) 2233-4455')).toBe('5491122334455')
    expect(digitosDe('11 2233 4455')).toBe('1122334455')
    expect(digitosDe('')).toBe('')
  })
})

describe('validarNumeroDePrueba', () => {
  it('acepta 10 dígitos (código de área + número) y guarda los dígitos', () => {
    expect(validarNumeroDePrueba('11 2233-4455')).toEqual({ ok: true, digitos: '1122334455' })
  })

  it('acepta el número internacional completo', () => {
    expect(validarNumeroDePrueba('+54 9 11 2233-4455')).toEqual({ ok: true, digitos: '5491122334455' })
  })

  it('rechaza un número sin código de área', () => {
    expect(validarNumeroDePrueba('2233-4455')).toEqual({ ok: false, problema: 'NUMERO_CORTO' })
  })

  it('rechaza más de 15 dígitos, el largo máximo de E.164', () => {
    expect(validarNumeroDePrueba('1234567890123456')).toEqual({ ok: false, problema: 'NUMERO_LARGO' })
  })

  it('acepta exactamente 15', () => {
    expect(validarNumeroDePrueba('123456789012345')).toEqual({ ok: true, digitos: '123456789012345' })
  })
})

describe('coinciden', () => {
  it('iguala lo que tipea el dueño con el waId que entrega Kapso', () => {
    expect(coinciden('+5491122334455', '11 2233-4455')).toBe(true)
    expect(coinciden('5491122334455', '+54 9 11 2233 4455')).toBe(true)
  })

  it('no iguala dos números distintos', () => {
    expect(coinciden('+5491122334455', '11 2233-4456')).toBe(false)
  })

  /**
   * El límite de la comparación, fijado a propósito (spec, decisión 2): con el
   * 0 y el 15 los últimos 10 dígitos son otros. La red es la pantalla, que
   * muestra "Todavía no escribió" en ese número — no una heurística que adivine
   * el largo del código de área.
   */
  it('NO iguala el número tipeado con 0 y 15', () => {
    expect(coinciden('+5491122334455', '011 15 2233-4455')).toBe(false)
  })

  it('un número de menos de 10 dígitos no coincide con nada, ni consigo mismo', () => {
    expect(coinciden('2233-4455', '2233-4455')).toBe(false)
  })
})

describe('coincideConAlguno', () => {
  it('encuentra el waId en la lista', () => {
    expect(coincideConAlguno('+5491122334455', ['1199998888', '1122334455'])).toBe(true)
  })

  it('con la lista vacía no coincide nadie', () => {
    expect(coincideConAlguno('+5491122334455', [])).toBe(false)
  })
})

describe('mostrarNumeroDePrueba', () => {
  it('muestra los últimos 10 dígitos partidos antes de los cuatro finales', () => {
    expect(mostrarNumeroDePrueba('5491122334455')).toBe('112233-4455')
    expect(mostrarNumeroDePrueba('3514445566')).toBe('351444-5566')
  })

  it('ultimos10 no inventa dígitos cuando hay menos', () => {
    expect(ultimos10('12345')).toBe('12345')
  })
})
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run lib/bot/numeros-de-prueba.test.ts`
Expected: FAIL con "Failed to resolve import "./numeros-de-prueba""

- [ ] **Step 3: Implementar `lib/bot/numeros-de-prueba.ts`**

```ts
// lib/bot/numeros-de-prueba.ts
/**
 * Los números a los que el bot les contesta en modo prueba.
 *
 * **Puro a propósito**, sin ningún import de Prisma: lo usan el webhook,
 * `lib/bot/administrar.ts` y la pantalla (`'use client'`), y un import de valor
 * que llegue a `lib/tenant/prisma.ts` arrastraría `pg` al bundle del navegador.
 * Una sola implementación de la comparación para los tres, por lo mismo que
 * existe `SelectorDeCategoria`: dos versiones de la misma regla divergen en
 * silencio.
 *
 * **Se compara por los últimos 10 dígitos.** En Argentina código de área más
 * número son 10, así que `11 2233-4455`, `+54 9 11 2233 4455` y el
 * `5491122334455` que entrega Kapso dan lo mismo. El caso que NO salva es el
 * número tipeado con 0 y 15 (`011 15 2233-4455`): no se intenta detectarlo
 * porque los códigos de área tienen largo variable y cualquier heurística le
 * erraría a alguno. La red es la pantalla, que muestra si ese número ya
 * escribió. Ver docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md.
 */

/** Una lista de prueba más larga ya no es una prueba. */
export const TOPE_NUMEROS_DE_PRUEBA = 20

const DIGITOS_MINIMOS = 10
/** El largo máximo de un número E.164. */
const DIGITOS_MAXIMOS = 15

export function digitosDe(texto: string): string {
  return texto.replace(/\D/g, '')
}

export function ultimos10(digitos: string): string {
  return digitos.slice(-DIGITOS_MINIMOS)
}

export function validarNumeroDePrueba(
  texto: string,
): { ok: true; digitos: string } | { ok: false; problema: 'NUMERO_CORTO' | 'NUMERO_LARGO' } {
  const digitos = digitosDe(texto)
  if (digitos.length < DIGITOS_MINIMOS) return { ok: false, problema: 'NUMERO_CORTO' }
  if (digitos.length > DIGITOS_MAXIMOS) return { ok: false, problema: 'NUMERO_LARGO' }
  return { ok: true, digitos }
}

/**
 * Dos números son el mismo teléfono si sus últimos 10 dígitos coinciden.
 * Menos de 10 dígitos no coincide con nada: sin código de área no hay forma de
 * saber de qué número se habla, y "4455" no puede terminar habilitando a todos
 * los que terminen así.
 */
export function coinciden(a: string, b: string): boolean {
  const da = digitosDe(a)
  const db = digitosDe(b)
  if (da.length < DIGITOS_MINIMOS || db.length < DIGITOS_MINIMOS) return false
  return ultimos10(da) === ultimos10(db)
}

export function coincideConAlguno(waId: string, numeros: readonly string[]): boolean {
  return numeros.some((n) => coinciden(waId, n))
}

/**
 * Cómo se ve un número en la pantalla: seis dígitos, guion, cuatro. No se parte
 * el código de área porque su largo varía (11, 351, 2966): un espacio fijo
 * después del segundo dígito quedaría mal puesto fuera de Buenos Aires.
 */
export function mostrarNumeroDePrueba(digitos: string): string {
  const u = ultimos10(digitos)
  return `${u.slice(0, 6)}-${u.slice(6)}`
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run lib/bot/numeros-de-prueba.test.ts`
Expected: PASS

- [ ] **Step 5: Escribir los tests de `modo`**

```ts
// lib/bot/modo.test.ts
import { describe, it, expect } from 'vitest'
import { esModo, leyendaDelModo, subtituloDelModo, tocarModo } from './modo'

describe('esModo', () => {
  it('acepta los tres modos y nada más', () => {
    expect(esModo('APAGADO')).toBe(true)
    expect(esModo('PRUEBA')).toBe(true)
    expect(esModo('TODOS')).toBe(true)
    expect(esModo('ENCENDIDO')).toBe(false)
    expect(esModo('')).toBe(false)
    expect(esModo(undefined)).toBe(false)
  })
})

/**
 * El doble toque para pasar a Todos (spec, decisión 6). Es la única transición
 * que manda el bot a clientes reales, y con un segmentado un toque de más sobre
 * la opción vecina alcanza para hacerlo sin querer.
 */
describe('tocarModo', () => {
  it('el primer toque en Todos arma la confirmación y NO cambia el modo', () => {
    expect(tocarModo({ modo: 'PRUEBA', armadoTodos: false }, 'TODOS')).toEqual({
      cambiarA: null,
      armadoTodos: true,
    })
  })

  it('el segundo toque en Todos confirma', () => {
    expect(tocarModo({ modo: 'PRUEBA', armadoTodos: true }, 'TODOS')).toEqual({
      cambiarA: 'TODOS',
      armadoTodos: false,
    })
  })

  it('también desde Apagado hacen falta dos toques', () => {
    expect(tocarModo({ modo: 'APAGADO', armadoTodos: false }, 'TODOS').cambiarA).toBeNull()
  })

  it('tocar otra opción con la confirmación armada la desarma y cambia a esa', () => {
    expect(tocarModo({ modo: 'PRUEBA', armadoTodos: true }, 'APAGADO')).toEqual({
      cambiarA: 'APAGADO',
      armadoTodos: false,
    })
  })

  it('bajar a Sólo prueba o a Apagado es inmediato: es la dirección segura', () => {
    expect(tocarModo({ modo: 'TODOS', armadoTodos: false }, 'PRUEBA').cambiarA).toBe('PRUEBA')
    expect(tocarModo({ modo: 'TODOS', armadoTodos: false }, 'APAGADO').cambiarA).toBe('APAGADO')
    expect(tocarModo({ modo: 'APAGADO', armadoTodos: false }, 'PRUEBA').cambiarA).toBe('PRUEBA')
  })

  it('tocar el modo que ya está no hace nada', () => {
    expect(tocarModo({ modo: 'TODOS', armadoTodos: false }, 'TODOS')).toEqual({
      cambiarA: null,
      armadoTodos: false,
    })
  })
})

describe('leyendaDelModo', () => {
  it('dice qué pasa con el próximo mensaje en cada modo', () => {
    expect(leyendaDelModo({ modo: 'APAGADO', cantidadNumeros: 0, armadoTodos: false })).toBe(
      'No le contesta a nadie. Los mensajes quedan guardados.',
    )
    expect(leyendaDelModo({ modo: 'PRUEBA', cantidadNumeros: 2, armadoTodos: false })).toBe(
      'Contesta sólo a los números de prueba.',
    )
    expect(leyendaDelModo({ modo: 'TODOS', cantidadNumeros: 2, armadoTodos: false })).toBe(
      'Les contesta a todos los que escriban.',
    )
  })

  it('en prueba sin números avisa que no le contesta a nadie', () => {
    expect(leyendaDelModo({ modo: 'PRUEBA', cantidadNumeros: 0, armadoTodos: false })).toBe(
      'Todavía no cargaste ningún número de prueba: no le contesta a nadie.',
    )
  })

  it('con la confirmación armada, la leyenda pide el segundo toque', () => {
    expect(leyendaDelModo({ modo: 'PRUEBA', cantidadNumeros: 2, armadoTodos: true })).toBe(
      'Tocá de nuevo para que les conteste a todos.',
    )
  })
})

describe('subtituloDelModo', () => {
  it('nombra el estado en el encabezado', () => {
    expect(subtituloDelModo('APAGADO')).toBe('Apagado')
    expect(subtituloDelModo('PRUEBA')).toBe('En prueba')
    expect(subtituloDelModo('TODOS')).toBe('Contestando')
  })
})
```

- [ ] **Step 6: Correrlos y ver que fallan**

Run: `npx vitest run lib/bot/modo.test.ts`
Expected: FAIL con "Failed to resolve import "./modo""

- [ ] **Step 7: Implementar `lib/bot/modo.ts`**

```ts
// lib/bot/modo.ts
/**
 * El modo del bot: apagado, sólo a los números de prueba, o a todos.
 *
 * Puro, sin Prisma, por lo mismo que `lib/bot/numeros-de-prueba.ts`: lo importa
 * la pantalla. `MODOS` está atado al enum `ModoBot` del schema en las dos
 * direcciones por `lib/bot/modo.test.ts`.
 *
 * Tres estados y no un switch más una lista (spec, decisión 1): con una lista
 * que restringe "si tiene números", quitar el último número le soltaría el bot
 * a todos los clientes sin ningún gesto que lo diga.
 */

export const MODOS = ['APAGADO', 'PRUEBA', 'TODOS'] as const
export type Modo = (typeof MODOS)[number]

export function esModo(valor: unknown): valor is Modo {
  return typeof valor === 'string' && (MODOS as readonly string[]).includes(valor)
}

/** Cuánto dura armada la confirmación de Todos. Mismo plazo que el vaciado del
 *  carrito con doble Esc en /vender. */
export const MS_CONFIRMACION_TODOS = 3000

/**
 * Qué hace un toque sobre el segmentado.
 *
 * Pasar a Todos pide dos toques y es la única transición que los pide: es la
 * que manda el bot a clientes reales. Bajar es inmediato. Mismo mecanismo que
 * `AnularVenta` —confirmación en el mismo control, sin diálogo—, acá sobre la
 * misma opción.
 */
export function tocarModo(
  estado: { modo: Modo; armadoTodos: boolean },
  tocado: Modo,
): { cambiarA: Modo | null; armadoTodos: boolean } {
  if (tocado === estado.modo) return { cambiarA: null, armadoTodos: false }
  if (tocado !== 'TODOS') return { cambiarA: tocado, armadoTodos: false }
  if (estado.armadoTodos) return { cambiarA: 'TODOS', armadoTodos: false }
  return { cambiarA: null, armadoTodos: true }
}

export function leyendaDelModo(entrada: {
  modo: Modo
  cantidadNumeros: number
  armadoTodos: boolean
}): string {
  if (entrada.armadoTodos) return 'Tocá de nuevo para que les conteste a todos.'
  switch (entrada.modo) {
    case 'APAGADO':
      return 'No le contesta a nadie. Los mensajes quedan guardados.'
    case 'PRUEBA':
      return entrada.cantidadNumeros === 0
        ? 'Todavía no cargaste ningún número de prueba: no le contesta a nadie.'
        : 'Contesta sólo a los números de prueba.'
    case 'TODOS':
      return 'Les contesta a todos los que escriban.'
  }
}

export function subtituloDelModo(modo: Modo): string {
  switch (modo) {
    case 'APAGADO':
      return 'Apagado'
    case 'PRUEBA':
      return 'En prueba'
    case 'TODOS':
      return 'Contestando'
  }
}
```

- [ ] **Step 8: Correr, typecheck y lint**

Run: `npx vitest run lib/bot/numeros-de-prueba.test.ts lib/bot/modo.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS, sin errores de tipos ni de lint.

- [ ] **Step 9: Commit**

```bash
git add lib/bot/numeros-de-prueba.ts lib/bot/numeros-de-prueba.test.ts lib/bot/modo.ts lib/bot/modo.test.ts
git commit -m "feat(bot): reglas puras de los números de prueba y del modo del bot"
```

---

### Task 2: Schema y migración — `modo`, `MODO_PRUEBA` y `numeros_de_prueba_bot`

**Files:**
- Modify: `prisma/schema.prisma` (enum `MotivoSinRespuesta` ~línea 136, `model Tenant` relaciones, `model BotDeWhatsapp` ~línea 1069)
- Create: `prisma/migrations/<timestamp>_bot_modo_prueba/migration.sql`
- Modify: `docs/schema.md` (regenerado)
- Modify: `test/rls.test.ts` (bloque `describe('el bot de WhatsApp'`, ~línea 608)
- Modify: `lib/bot/modo.test.ts`

**Interfaces:**
- Consumes: `MODOS` de `lib/bot/modo.ts` (Task 1).
- Produces: el modelo Prisma `NumeroDePruebaBot` (`prisma.numeroDePruebaBot`, campos `id`, `tenantId`, `digitos`, `creadoEn`), `BotDeWhatsapp.modo: ModoBot`, el valor `'MODO_PRUEBA'` de `MotivoSinRespuesta`, y el tipo `ModoBot` exportado por `@/generated/prisma/client`.

- [ ] **Step 1: Escribir el test que ata `MODOS` al enum del schema**

Agregar al final de `lib/bot/modo.test.ts` (y sumar los imports que falten arriba):

```ts
import { readFileSync } from 'node:fs'
import { MODOS } from './modo'

/** Los valores del enum ModoBot tal como los declara el schema. Mismo mecanismo
 *  que test/permisos-catalogo.test.ts. */
function modosDelSchema(): string[] {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const bloque = schema.slice(schema.indexOf('enum ModoBot {'))
  const cuerpo = bloque.slice(bloque.indexOf('{') + 1, bloque.indexOf('}'))
  return cuerpo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l))
}

describe('MODOS contra el schema', () => {
  it('encuentra el enum en el schema; si no, el test no prueba nada', () => {
    expect(modosDelSchema().length).toBeGreaterThan(0)
  })

  // Las dos direcciones: una lista escrita a mano que se desincronice del enum
  // deja al servidor aceptando un modo que la base rechaza, o al revés.
  it('tiene exactamente los valores del enum ModoBot', () => {
    expect([...MODOS].sort()).toEqual(modosDelSchema().sort())
  })
})
```

- [ ] **Step 2: Escribir los casos de RLS de la tabla nueva**

En `test/rls.test.ts`, adentro de `describe('el bot de WhatsApp', () => {`, sumar `let numeroB: string` junto a las otras variables, este insert al final del `beforeAll` de ese bloque:

```ts
      const n = await owner.query(
        `INSERT INTO numeros_de_prueba_bot (id, tenant_id, digitos, creado_en)
         VALUES (gen_random_uuid(), $1, '1122334455', now())
         RETURNING id`,
        [tenantB],
      )
      numeroB = n.rows[0].id
```

y estos casos al final del bloque:

```ts
    it('numeros_de_prueba_bot: el otro tenant no ve la lista, y su dueño sí', async () => {
      const { rows: deA } = await comoTenant(tenantA, 'SELECT 1 FROM numeros_de_prueba_bot')
      expect(deA, 'numeros_de_prueba_bot filtró filas de otro tenant').toHaveLength(0)

      const { rows: deB } = await comoTenant(tenantB, 'SELECT 1 FROM numeros_de_prueba_bot')
      expect(deB, 'numeros_de_prueba_bot no es legible por su propio tenant').toHaveLength(1)
    })

    /**
     * Meterle un número a la lista de otro local es hacer que su bot en prueba
     * le conteste a un desconocido. Por eso el INSERT con tenant ajeno se
     * afirma aparte del SELECT.
     */
    it('numeros_de_prueba_bot: rechaza insertar un número en la lista de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO numeros_de_prueba_bot (id, tenant_id, digitos, creado_en)
           VALUES (gen_random_uuid(), $1, '1199998888', now())`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('numeros_de_prueba_bot: A no puede quitarle un número (DELETE) a B', async () => {
      const { rowCount } = await comoTenant(
        tenantA,
        'DELETE FROM numeros_de_prueba_bot WHERE id = $1',
        [numeroB],
      )
      expect(rowCount, 'el DELETE de A afectó una fila que no es suya').toBe(0)
    })
```

- [ ] **Step 3: Correr y ver que fallan**

Run: `npx vitest run lib/bot/modo.test.ts test/rls.test.ts`
Expected: FAIL. `modo.test.ts` con "encuentra el enum en el schema" (0 valores). `rls.test.ts` con `relation "numeros_de_prueba_bot" does not exist`.

- [ ] **Step 4: Editar `prisma/schema.prisma`**

(a) En `enum MotivoSinRespuesta`, agregar después de `SIN_MODELO`:

```prisma
  // El bot está en modo prueba y quien escribió no es uno de los números de
  // prueba del local: un cliente real. Se guarda igual —guardar siempre, decidir
  // después—, y es lo que le permite a la pantalla decir cuántos clientes
  // escribieron mientras el dueño probaba.
  MODO_PRUEBA
```

(b) Agregar el enum nuevo inmediatamente después del bloque de `enum MotivoSinRespuesta`:

```prisma
// A quién le contesta el bot. Tres estados y no un switch más una lista: con
// una lista que restringe "si tiene números", quitar el último le soltaría el
// bot a todos los clientes sin un gesto que lo diga. Ver
// docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md.
enum ModoBot {
  APAGADO
  PRUEBA
  TODOS

  @@map("modo_bot")
}
```

(c) En `model Tenant`, después de `mensajesBot      MensajeBot[]`:

```prisma
  numerosDePruebaBot NumeroDePruebaBot[]
```

(d) En `model BotDeWhatsapp`, reemplazar el comentario y la línea de `activo` por:

```prisma
  // A quién le contesta: nadie, sólo los números de prueba, o todos. Arranca
  // APAGADO: conectar el número y ponerlo a contestar son dos decisiones, y la
  // segunda tiene que ser deliberada.
  modo          ModoBot @default(APAGADO)
  // YA NO DECIDE NADA en el código nuevo, y no se borra todavía (expand/
  // contract). Toda escritura de `modo` la escribe como `modo === 'TODOS'`, y
  // ese valor es el que hace seguro el rollback: la imagen anterior sólo lee
  // esta columna, así que si el healthcheck la revierte durante una prueba, lee
  // `false` y se calla en vez de contestarles a todos los clientes. El DROP va
  // en un deploy posterior.
  activo        Boolean @default(false)
```

(e) Agregar el modelo nuevo inmediatamente después de `model BotDeWhatsapp { … }`:

```prisma
// Los números a los que el bot les contesta en modo PRUEBA. Una fila por
// número: agregar es un INSERT y quitar un DELETE, la fila ES el dato, igual
// que usuario_permisos. Tabla propia y no un text[] en bots_de_whatsapp: la
// unicidad la sostiene el índice y no un chequeo de aplicación que dos pestañas
// pisarían.
//
// `digitos` guarda los dígitos tal como se tipearon (sin símbolos), no sólo los
// últimos 10, para que la pantalla muestre lo que el dueño cargó. La coincidencia
// con el waId es por los últimos 10 (lib/bot/numeros-de-prueba.ts), así que dos
// formas del mismo teléfono podrían convivir como filas distintas: la acción de
// agregar lo rechaza antes, y si pasara igual es inofensivo.
model NumeroDePruebaBot {
  id       String   @id @default(uuid(7)) @db.Uuid
  tenantId String   @map("tenant_id") @db.Uuid
  digitos  String
  creadoEn DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, digitos])
  @@map("numeros_de_prueba_bot")
}
```

- [ ] **Step 5: Generar la migración sin aplicarla**

Run: `npx prisma migrate dev --create-only --name bot_modo_prueba`
Expected: crea `prisma/migrations/<timestamp>_bot_modo_prueba/migration.sql`.

- [ ] **Step 6: Completar el SQL a mano**

Abrir el archivo generado. Tiene que quedar con este contenido. Si Prisma generó nombres de constraint o índice distintos, se conservan los generados y se agregan los tres bloques comentados (backfill, RLS):

```sql
-- AlterEnum
ALTER TYPE "motivo_sin_respuesta" ADD VALUE 'MODO_PRUEBA';

-- CreateEnum
CREATE TYPE "modo_bot" AS ENUM ('APAGADO', 'PRUEBA', 'TODOS');

-- AlterTable
ALTER TABLE "bots_de_whatsapp" ADD COLUMN "modo" "modo_bot" NOT NULL DEFAULT 'APAGADO';

-- Backfill: el bot que estaba prendido sigue contestándoles a todos. No usa
-- 'MODO_PRUEBA', que no se puede usar en la misma transacción que lo agrega.
UPDATE "bots_de_whatsapp" SET "modo" = 'TODOS' WHERE "activo" = true;

-- CreateTable
CREATE TABLE "numeros_de_prueba_bot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "digitos" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "numeros_de_prueba_bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "numeros_de_prueba_bot_tenant_id_digitos_key" ON "numeros_de_prueba_bot"("tenant_id", "digitos");

-- AddForeignKey
ALTER TABLE "numeros_de_prueba_bot" ADD CONSTRAINT "numeros_de_prueba_bot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "numeros_de_prueba_bot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "numeros_de_prueba_bot" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 7: Verificar el backfill contra dev antes de aplicar**

Si la base de dev tiene alguna fila en `bots_de_whatsapp`, anotar cuáles tienen `activo = true`:

Run: `docker exec arandano-dev-db-1 psql -U postgres -d arandano -c "SELECT tenant_id, activo FROM bots_de_whatsapp"` (si el contenedor o el usuario tienen otro nombre, sacarlo de `docker ps` y de `docker/compose.dev.yml`).

- [ ] **Step 8: Aplicar la migración**

Run: `npx prisma migrate dev`
Expected: "Your database is now in sync with your schema" y el cliente regenerado. Si pide reset, **parar** (ver Global Constraints).

Después, repetir la consulta del Step 7 sumando `modo`: toda fila con `activo = true` tiene que tener `modo = TODOS`, y el resto `APAGADO`.

- [ ] **Step 9: Regenerar el ERD**

Run: `scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md`
Expected: `docs/schema.md` modificado, con `numeros_de_prueba_bot` y la columna `modo`.

- [ ] **Step 10: Correr los tests y el typecheck**

Run: `npx vitest run lib/bot/modo.test.ts test/rls.test.ts test/rls-cobertura.test.ts && npx tsc --noEmit`
Expected: PASS. `tsc` limpio: nada lee `modo` todavía, y `activo` sigue existiendo.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md test/rls.test.ts lib/bot/modo.test.ts
git commit -m "feat(bot): modo del bot y tabla de números de prueba con RLS"
```

---

### Task 3: `lib/bot/administrar.ts` — cambiar el modo y administrar los números

**Files:**
- Modify: `lib/bot/errores.ts`
- Modify: `lib/bot/administrar.ts`
- Modify: `lib/bot/administrar.test.ts`

**Interfaces:**
- Consumes: `esModo`, `type Modo` (`lib/bot/modo.ts`); `validarNumeroDePrueba`, `coincideConAlguno`, `coinciden`, `ultimos10`, `TOPE_NUMEROS_DE_PRUEBA` (`lib/bot/numeros-de-prueba.ts`); `prisma.numeroDePruebaBot` y `BotDeWhatsapp.modo` (Task 2).
- Produces:
  - `CodigoErrorDeBot` suma `'MODO_INVALIDO' | 'NUMERO_CORTO' | 'NUMERO_LARGO' | 'NUMERO_REPETIDO' | 'TOPE_NUMEROS'`
  - `BotDelLocal` suma `modo: Modo` (conserva `activo` hasta la Task 6)
  - `cambiarModo(tenantId: string, modo: string): Promise<void>`
  - `alternarActivo(tenantId: string, activo: boolean): Promise<void>`, que pasa a delegar en `cambiarModo` hasta que la Task 6 la borre
  - `agregarNumeroDePrueba(tenantId: string, texto: string): Promise<void>`
  - `quitarNumeroDePrueba(tenantId: string, id: string): Promise<void>`
  - `type NumeroDePruebaVisto = { id: string; digitos: string; ultimoMensajeEn: Date | null }`
  - `numerosDePruebaDelLocal(tenantId: string): Promise<NumeroDePruebaVisto[]>`
  - `confirmarNumero` y `desconectar` escriben también `modo: 'APAGADO'`

- [ ] **Step 1: Escribir los tests**

En `lib/bot/administrar.test.ts`:

(a) Declarar `let otroTenantId: string` junto a `tenantId`. En `beforeAll`, después de `tenantId = …`:

```ts
  otroTenantId = await crearTenant(owner, 'bot-administrar-otro')
```

(b) Reemplazar el `beforeEach` por:

```ts
beforeEach(async () => {
  vi.clearAllMocks()
  await owner.query('DELETE FROM bots_de_whatsapp')
  await owner.query('DELETE FROM numeros_de_prueba_bot')
  await owner.query('DELETE FROM conversaciones_bot')
})
```

(c) Agregar este helper debajo de `conCustomer`:

```ts
async function conectado(modo: 'APAGADO' | 'PRUEBA' | 'TODOS' = 'APAGADO') {
  await owner.query(
    `INSERT INTO bots_de_whatsapp
       (id, tenant_id, kapso_customer_id, phone_number_id, webhook_secreto, modo, activo, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'cus_1', 'pn_1', 'sec_1', $2, $3, now(), now())`,
    [tenantId, modo, modo === 'TODOS'],
  )
}

async function estadoDelBot() {
  const { rows } = await owner.query(
    'SELECT modo, activo FROM bots_de_whatsapp WHERE tenant_id = $1',
    [tenantId],
  )
  return rows[0] as { modo: string; activo: boolean }
}

async function digitosCargados(tenant = tenantId) {
  const { rows } = await owner.query(
    'SELECT digitos FROM numeros_de_prueba_bot WHERE tenant_id = $1 ORDER BY creado_en',
    [tenant],
  )
  return rows.map((r) => r.digitos as string)
}
```

(d) En el test `'conecta el número propio, guarda el secreto y lo deja APAGADO'`, cambiar el `SELECT` para traer también `modo` y sumar al final:

```ts
    expect(rows[0].modo).toBe('APAGADO')
```

(e) En el test `'limpia lo local aunque Kapso no responda'`, cambiar el INSERT para que agregue `modo` con valor `'TODOS'` (columnas `…, activo, modo, creado_en…` y valores `…, true, 'TODOS', now()…`), traer `modo` en el `SELECT` y sumar:

```ts
    expect(rows[0].modo).toBe('APAGADO')
```

(f) Agregar al final del archivo:

```ts
describe('cambiar el modo', () => {
  /**
   * El valor de `activo` es el que hace seguro el rollback (spec, decisión 4):
   * la imagen anterior sólo lee esa columna, y en prueba tiene que leer `false`
   * para callarse en vez de contestarles a todos.
   */
  it('en prueba deja activo en false', async () => {
    await conectado('TODOS')
    await administrar.cambiarModo(tenantId, 'PRUEBA')
    expect(await estadoDelBot()).toEqual({ modo: 'PRUEBA', activo: false })
  })

  it('en todos deja activo en true', async () => {
    await conectado('PRUEBA')
    await administrar.cambiarModo(tenantId, 'TODOS')
    expect(await estadoDelBot()).toEqual({ modo: 'TODOS', activo: true })
  })

  it('apagado deja activo en false', async () => {
    await conectado('TODOS')
    await administrar.cambiarModo(tenantId, 'APAGADO')
    expect(await estadoDelBot()).toEqual({ modo: 'APAGADO', activo: false })
  })

  it('no se puede pasar a prueba ni a todos sin número conectado', async () => {
    await conCustomer()
    await expect(administrar.cambiarModo(tenantId, 'PRUEBA')).rejects.toMatchObject({ codigo: 'SIN_NUMERO' })
    await expect(administrar.cambiarModo(tenantId, 'TODOS')).rejects.toMatchObject({ codigo: 'SIN_NUMERO' })
  })

  /** Lo que llega a la server action es un string del navegador. */
  it('rechaza un modo que no existe y no escribe', async () => {
    await conectado('APAGADO')
    await expect(administrar.cambiarModo(tenantId, 'ENCENDIDO')).rejects.toMatchObject({
      codigo: 'MODO_INVALIDO',
    })
    expect(await estadoDelBot()).toEqual({ modo: 'APAGADO', activo: false })
  })

  it('lo que la pantalla lee incluye el modo', async () => {
    await conectado('PRUEBA')
    expect(await administrar.botDelLocal(tenantId)).toMatchObject({ modo: 'PRUEBA' })
  })

  it('el local que nunca tocó la pantalla está apagado', async () => {
    expect(await administrar.botDelLocal(tenantId)).toMatchObject({ modo: 'APAGADO' })
  })
})

describe('los números de prueba', () => {
  it('guarda sólo los dígitos, tal como se tipearon', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '+54 9 11 2233-4455')
    expect(await digitosCargados()).toEqual(['5491122334455'])
  })

  it('rechaza un número sin código de área y no escribe', async () => {
    await expect(administrar.agregarNumeroDePrueba(tenantId, '2233-4455')).rejects.toMatchObject({
      codigo: 'NUMERO_CORTO',
    })
    expect(await digitosCargados()).toEqual([])
  })

  it('rechaza un número de más de 15 dígitos', async () => {
    await expect(
      administrar.agregarNumeroDePrueba(tenantId, '1234567890123456'),
    ).rejects.toMatchObject({ codigo: 'NUMERO_LARGO' })
  })

  it('rechaza el mismo número repetido', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await expect(administrar.agregarNumeroDePrueba(tenantId, '1122334455')).rejects.toMatchObject({
      codigo: 'NUMERO_REPETIDO',
    })
    expect(await digitosCargados()).toHaveLength(1)
  })

  /** Dos formas del mismo teléfono son el mismo número de prueba. */
  it('rechaza el mismo teléfono escrito de otra forma', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await expect(
      administrar.agregarNumeroDePrueba(tenantId, '+54 9 11 2233 4455'),
    ).rejects.toMatchObject({ codigo: 'NUMERO_REPETIDO' })
    expect(await digitosCargados()).toEqual(['1122334455'])
  })

  it('no deja pasar del tope de 20', async () => {
    for (let i = 0; i < 20; i++) {
      await owner.query(
        `INSERT INTO numeros_de_prueba_bot (id, tenant_id, digitos, creado_en)
         VALUES (gen_random_uuid(), $1, $2, now())`,
        [tenantId, `11000000${String(i).padStart(2, '0')}`],
      )
    }
    await expect(administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')).rejects.toMatchObject({
      codigo: 'TOPE_NUMEROS',
    })
    expect(await digitosCargados()).toHaveLength(20)
  })

  it('quita un número propio', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    const [{ id }] = await administrar.numerosDePruebaDelLocal(tenantId)
    await administrar.quitarNumeroDePrueba(tenantId, id)
    expect(await digitosCargados()).toEqual([])
  })

  it('quitar el id de un número de otro local no borra nada', async () => {
    const { rows } = await owner.query(
      `INSERT INTO numeros_de_prueba_bot (id, tenant_id, digitos, creado_en)
       VALUES (gen_random_uuid(), $1, '1122334455', now()) RETURNING id`,
      [otroTenantId],
    )
    await administrar.quitarNumeroDePrueba(tenantId, rows[0].id)
    expect(await digitosCargados(otroTenantId), 'se borró el número de prueba de otro local').toEqual([
      '1122334455',
    ])
  })

  it('un id que no es un uuid no rompe ni borra nada', async () => {
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await expect(administrar.quitarNumeroDePrueba(tenantId, 'no-es-un-uuid')).resolves.toBeUndefined()
    expect(await digitosCargados()).toHaveLength(1)
  })

  /**
   * La línea "Último mensaje" es la verificación del número: si el dueño se
   * escribe desde ese celular y la fila sigue diciendo "Todavía no escribió",
   * el número está mal cargado (spec, decisión 2).
   */
  it('cada número dice cuándo escribió por última vez quien coincide con él', async () => {
    const cuando = new Date('2026-09-15T17:32:00Z')
    await owner.query(
      `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
       VALUES (gen_random_uuid(), $1, '+5491122334455', now(), $2)`,
      [tenantId, cuando],
    )
    await administrar.agregarNumeroDePrueba(tenantId, '11 2233-4455')
    await administrar.agregarNumeroDePrueba(tenantId, '11 9999-8888')

    const vistos = await administrar.numerosDePruebaDelLocal(tenantId)
    expect(vistos.map((v) => [v.digitos, v.ultimoMensajeEn?.toISOString() ?? null])).toEqual([
      ['1122334455', cuando.toISOString()],
      ['1199998888', null],
    ])
  })

  it('el número tipeado con 0 y 15 no encuentra la conversación', async () => {
    await owner.query(
      `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
       VALUES (gen_random_uuid(), $1, '+5491122334455', now(), now())`,
      [tenantId],
    )
    await administrar.agregarNumeroDePrueba(tenantId, '011 15 2233-4455')
    const [visto] = await administrar.numerosDePruebaDelLocal(tenantId)
    expect(visto.ultimoMensajeEn).toBeNull()
  })

  it('sin números no consulta conversaciones y devuelve la lista vacía', async () => {
    expect(await administrar.numerosDePruebaDelLocal(tenantId)).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run lib/bot/administrar.test.ts`
Expected: FAIL con "administrar.cambiarModo is not a function" (y los demás de la tabla nueva), más `modo` esperado en confirmar y desconectar.

- [ ] **Step 3: Sumar los códigos de error**

En `lib/bot/errores.ts`, reemplazar el tipo por:

```ts
export type CodigoErrorDeBot =
  | 'SIN_INTEGRACION'
  | 'DEDICACION_LARGA'
  | 'INSTRUCCIONES_LARGAS'
  | 'NUMERO_AJENO'
  | 'SIN_NUMERO'
  | 'YA_CONECTADO'
  | 'MODO_INVALIDO'
  | 'NUMERO_CORTO'
  | 'NUMERO_LARGO'
  | 'NUMERO_REPETIDO'
  | 'TOPE_NUMEROS'
```

- [ ] **Step 4: Implementar en `lib/bot/administrar.ts`**

(a) Imports, sumar arriba:

```ts
import { Prisma } from '@/generated/prisma/client'
import { esModo, type Modo } from '@/lib/bot/modo'
import {
  TOPE_NUMEROS_DE_PRUEBA,
  coincideConAlguno,
  coinciden,
  ultimos10,
  validarNumeroDePrueba,
} from '@/lib/bot/numeros-de-prueba'
```

(b) En `BotDelLocal` agregar `modo: Modo` debajo de `activo: boolean`; en `VACIO`, `modo: 'APAGADO'`; en `CAMPOS`, `modo: true`.

(c) En `confirmarNumero`, en el `data` del `update`, agregar `modo: 'APAGADO',` justo antes de `activo: false,`. En `desconectar`, lo mismo en su `data`.

(d) Reemplazar `alternarActivo` entera por:

```ts
/**
 * A quién le contesta el bot.
 *
 * `modo` llega como string porque viene de una server action: el navegador
 * puede mandar cualquier cosa, así que se valida acá y no sólo en el tipo.
 *
 * **Escribe `activo = modo === 'TODOS'`, y ése es el valor que hace seguro el
 * rollback.** La imagen anterior sólo lee `activo`: si el healthcheck la
 * revierte mientras el local está en prueba, lee `false` y se calla. Con
 * `modo !== 'APAGADO'` un rollback durante una prueba pondría al bot a
 * contestarles a todos los clientes. Ver el comentario de la columna en
 * prisma/schema.prisma.
 */
export async function cambiarModo(tenantId: string, modo: string): Promise<void> {
  if (!esModo(modo)) {
    throw new ErrorDeBot('MODO_INVALIDO', 'Ese modo del bot no existe.')
  }
  const prisma = prismaParaTenant(tenantId)
  if (modo !== 'APAGADO') {
    const bot = await prisma.botDeWhatsapp.findUnique({
      where: { tenantId },
      select: { phoneNumberId: true },
    })
    if (!bot?.phoneNumberId) {
      throw new ErrorDeBot('SIN_NUMERO', 'Conectá un número antes de prender el bot.')
    }
  }
  await prisma.botDeWhatsapp.update({
    where: { tenantId },
    data: { modo, activo: modo === 'TODOS' },
  })
}

/** Transitoria: la usa `prenderOApagar` hasta que la pantalla pase a
 *  `cambiarModo` (Task 6 del plan del modo prueba), que la borra. */
export async function alternarActivo(tenantId: string, activo: boolean): Promise<void> {
  await cambiarModo(tenantId, activo ? 'TODOS' : 'APAGADO')
}
```

(e) Agregar al final del archivo:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MENSAJE_DE_PROBLEMA = {
  NUMERO_CORTO: 'El número tiene que ir con código de área: al menos 10 dígitos, sin 0 y sin 15.',
  NUMERO_LARGO: 'Ese número tiene demasiados dígitos.',
} as const

function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * Agrega un número a la lista de prueba.
 *
 * El repetido se rechaza dos veces, por dos razones distintas: comparando los
 * últimos 10 dígitos contra los que ya hay —porque `11 2233-4455` y
 * `+54 9 11 2233 4455` son el mismo teléfono y el índice único no lo sabe— y
 * atrapando el P2002 del índice, que es lo único que frena a dos pestañas
 * agregando el mismo número en el mismo instante.
 *
 * El tope se cuenta antes de insertar, así que dos altas simultáneas con 19
 * números podrían dejar 21. Es aceptable: el tope existe para que la lista siga
 * siendo de prueba, no para defender un recurso.
 */
export async function agregarNumeroDePrueba(tenantId: string, texto: string): Promise<void> {
  const validado = validarNumeroDePrueba(texto)
  if (!validado.ok) {
    throw new ErrorDeBot(validado.problema, MENSAJE_DE_PROBLEMA[validado.problema])
  }

  const prisma = prismaParaTenant(tenantId)
  const existentes = await prisma.numeroDePruebaBot.findMany({ select: { digitos: true } })
  if (existentes.length >= TOPE_NUMEROS_DE_PRUEBA) {
    throw new ErrorDeBot(
      'TOPE_NUMEROS',
      `Ya hay ${TOPE_NUMEROS_DE_PRUEBA} números de prueba. Quitá uno para agregar otro.`,
    )
  }
  const repetido = new ErrorDeBot('NUMERO_REPETIDO', 'Ese número ya está en la lista de prueba.')
  if (coincideConAlguno(validado.digitos, existentes.map((e) => e.digitos))) throw repetido

  try {
    await prisma.numeroDePruebaBot.create({ data: { tenantId, digitos: validado.digitos } })
  } catch (e) {
    if (esP2002(e)) throw repetido
    throw e
  }
}

/**
 * Quita un número. Filtra por id y el tenant lo ponen la extensión de Prisma y
 * RLS: el id de un número de otro local no afecta ninguna fila. Un id que no es
 * un uuid no llega a la base, donde el cast lo convertiría en un 500.
 */
export async function quitarNumeroDePrueba(tenantId: string, id: string): Promise<void> {
  if (!UUID.test(id)) return
  await prismaParaTenant(tenantId).numeroDePruebaBot.deleteMany({ where: { id } })
}

export type NumeroDePruebaVisto = {
  id: string
  digitos: string
  /** La última vez que escribió alguien que coincide con este número, o
   *  `null` si nadie. Es la verificación de que el número está bien cargado. */
  ultimoMensajeEn: Date | null
}

/**
 * La lista de prueba, cada número con su último mensaje.
 *
 * El `endsWith` de la consulta es sólo un prefiltro para no traer todas las
 * conversaciones del local: quien decide es `coinciden`, la misma función que
 * usa el webhook, así que la pantalla no puede decir "escribió" de un número al
 * que el bot no le contestaría.
 */
export async function numerosDePruebaDelLocal(tenantId: string): Promise<NumeroDePruebaVisto[]> {
  const prisma = prismaParaTenant(tenantId)
  const numeros = await prisma.numeroDePruebaBot.findMany({
    orderBy: { creadoEn: 'asc' },
    select: { id: true, digitos: true },
  })
  if (numeros.length === 0) return []

  const conversaciones = await prisma.conversacionBot.findMany({
    where: { OR: numeros.map((n) => ({ waId: { endsWith: ultimos10(n.digitos) } })) },
    select: { waId: true, ultimoMensajeEn: true },
  })

  return numeros.map((n) => {
    const fechas = conversaciones
      .filter((c) => coinciden(c.waId, n.digitos))
      .map((c) => c.ultimoMensajeEn.getTime())
    return {
      id: n.id,
      digitos: n.digitos,
      ultimoMensajeEn: fechas.length > 0 ? new Date(Math.max(...fechas)) : null,
    }
  })
}
```

- [ ] **Step 5: Correr y ver que pasan**

Run: `npx vitest run lib/bot/administrar.test.ts`
Expected: PASS, incluido el `describe('prender el bot')` viejo, que sigue pasando porque `alternarActivo(true)` delega en `cambiarModo('TODOS')` y conserva `SIN_NUMERO`.

- [ ] **Step 6: Completar los fixtures de la pantalla, typecheck y lint**

`app/(app)/bot/page.test.tsx` construye `BotDelLocal` a mano, y `modo` ahora es requerido. Sumar `modo: 'APAGADO',` debajo de `activo: false,` en `SIN_CONECTAR`, y `modo: 'TODOS',` debajo de `activo: true,` en `CONECTADO`. `activo` se queda en los dos hasta la Task 6.

Run: `npx tsc --noEmit && npm run lint && npx vitest run "app/(app)/bot/page.test.tsx"`
Expected: limpio y PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/bot/errores.ts lib/bot/administrar.ts lib/bot/administrar.test.ts "app/(app)/bot/page.test.tsx"
git commit -m "feat(bot): cambiar el modo y administrar los números de prueba"
```

---

### Task 4: El webhook decide por modo, y lo que la pantalla va a contar

**Files:**
- Modify: `app/api/whatsapp/webhook/route.ts`
- Modify: `app/api/whatsapp/webhook/route.test.ts`
- Modify: `lib/bot/limites.ts`
- Create: `lib/bot/limites.test.ts`
- Create: `lib/bot/conversaciones.test.ts`
- Modify: `scripts/probar-bot.mts:75` y `:110`

**Interfaces:**
- Consumes: `coincideConAlguno` (Task 1); `BotDeWhatsapp.modo`, `prisma.numeroDePruebaBot`, `MotivoSinRespuesta.MODO_PRUEBA`, tipo `ModoBot` (Task 2).
- Produces: `sinRespuestaEnPruebaDelMes(tenantId: string, ahora?: Date): Promise<number>` en `lib/bot/limites.ts`.

- [ ] **Step 1: Escribir los tests del webhook**

En `app/api/whatsapp/webhook/route.test.ts`:

(a) Sumar `const buscarNumeros = vi.fn()` junto a los otros `vi.fn()`, y reemplazar el mock de `@/lib/tenant/prisma` por:

```ts
vi.mock('@/lib/tenant/prisma', () => ({
  prismaParaTenant: () => ({
    botDeWhatsapp: { findUnique: () => buscarBot() },
    numeroDePruebaBot: { findMany: () => buscarNumeros() },
  }),
}))
```

(b) En `BOT_CONECTADO`, reemplazar `activo: true,` por `modo: 'TODOS',`.

(c) En `beforeEach`, sumar `buscarNumeros.mockResolvedValue([])`.

(d) Reemplazar el test `'con el bot apagado guarda y calla'` por:

```ts
    it('con el bot apagado guarda y calla', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'APAGADO' })
      await noContesta('BOT_APAGADO')
    })

    /** La lista se lee sólo cuando hace falta (spec, decisión 5). */
    it('con el bot apagado no lee la lista de prueba', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'APAGADO' })
      await POST(pedido())
      expect(buscarNumeros).not.toHaveBeenCalled()
    })
```

(e) Agregar, adentro de `describe('el webhook de WhatsApp'`, al final:

```ts
  /**
   * El modo prueba, en las dos direcciones: un caso que sólo afirmara que el
   * cliente real no recibe respuesta pasaría igual con el bot apagado para
   * todos.
   */
  describe('el modo prueba', () => {
    // El waId del CUERPO es +5491155550000.
    const EL_QUE_ESCRIBE = { digitos: '1155550000' }
    const OTRO = { digitos: '1199998888' }

    it('le contesta a un número de la lista', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'PRUEBA' })
      buscarNumeros.mockResolvedValue([OTRO, EL_QUE_ESCRIBE])
      const r = await POST(pedido())
      expect(r.status).toBe(200)
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: null })
      expect(agendado).toHaveBeenCalledTimes(1)
    })

    it('a quien no está en la lista lo guarda con MODO_PRUEBA y no le contesta', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'PRUEBA' })
      buscarNumeros.mockResolvedValue([OTRO])
      const r = await POST(pedido())
      expect(r.status).toBe(200)
      expect(registrarEntrante, 'el mensaje del cliente real no quedó guardado').toHaveBeenCalledTimes(1)
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: 'MODO_PRUEBA' })
      expect(agendado, 'el bot en prueba le contestó a un cliente real').not.toHaveBeenCalled()
    })

    it('con la lista vacía no le contesta a nadie', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'PRUEBA' })
      buscarNumeros.mockResolvedValue([])
      await POST(pedido())
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: 'MODO_PRUEBA' })
      expect(agendado).not.toHaveBeenCalled()
    })

    it('el número tipeado con 0 y 15 no habilita al que escribe', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'PRUEBA' })
      // '011 15 5555-0000' tipeado: 13 dígitos cuyos últimos 10 son otros.
      buscarNumeros.mockResolvedValue([{ digitos: '0111555550000' }])
      await POST(pedido())
      expect(agendado).not.toHaveBeenCalled()
    })

    it('en todos, quien no está en la lista recibe respuesta igual', async () => {
      buscarNumeros.mockResolvedValue([OTRO])
      await POST(pedido())
      expect(agendado).toHaveBeenCalledTimes(1)
    })

    /**
     * El tope por hora defiende del ping-pong entre dos automatizaciones, y
     * quien usa un número de prueba es una persona que llega a 12 preguntas en
     * diez minutos (spec, decisión 5). Las dos direcciones: el de prueba pasa,
     * el que no es de prueba queda frenado.
     */
    it('un número de prueba no tiene el tope por hora, en prueba', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'PRUEBA' })
      buscarNumeros.mockResolvedValue([EL_QUE_ESCRIBE])
      respuestasDeLaUltimaHora.mockResolvedValue(12)
      await POST(pedido())
      expect(agendado).toHaveBeenCalledTimes(1)
    })

    it('un número de prueba no tiene el tope por hora, en todos', async () => {
      buscarNumeros.mockResolvedValue([EL_QUE_ESCRIBE])
      respuestasDeLaUltimaHora.mockResolvedValue(12)
      await POST(pedido())
      expect(agendado).toHaveBeenCalledTimes(1)
    })

    it('uno que no es de prueba sigue frenado por el tope por hora', async () => {
      buscarNumeros.mockResolvedValue([OTRO])
      respuestasDeLaUltimaHora.mockResolvedValue(12)
      await POST(pedido())
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: 'TOPE_CONVERSACION' })
      expect(agendado).not.toHaveBeenCalled()
    })

    /** Cuestan plata igual: cada respuesta de prueba es una llamada al modelo. */
    it('un número de prueba sí queda frenado por el tope mensual', async () => {
      buscarBot.mockResolvedValue({ ...BOT_CONECTADO, modo: 'PRUEBA' })
      buscarNumeros.mockResolvedValue([EL_QUE_ESCRIBE])
      respuestasDelMes.mockResolvedValue(1000)
      await POST(pedido())
      expect(registrarEntrante.mock.calls[0][1]).toMatchObject({ motivo: 'TOPE_MENSUAL' })
      expect(agendado).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run app/api/whatsapp/webhook/route.test.ts`
Expected: FAIL. `route.ts` todavía lee `activo`, que en el fixture ya no existe, así que "con el bot apagado" contesta y los casos de modo prueba fallan.

- [ ] **Step 3: Implementar en `route.ts`**

(a) Imports, sumar:

```ts
import { coincideConAlguno } from '@/lib/bot/numeros-de-prueba'
```

y cambiar el import de tipos a:

```ts
import type { ModoBot, MotivoSinRespuesta } from '@/generated/prisma/client'
```

(b) En el `select` del `findUnique`, reemplazar `activo: true,` por `modo: true,`.

(c) Reemplazar el bloque desde `const entrantes = mensajesDelWebhook(cuerpo)` hasta el final del `for` por:

```ts
  const entrantes = mensajesDelWebhook(cuerpo)
  if (entrantes.length === 0) return new Response('ok', { status: 200 })

  // La lista se lee UNA vez por webhook, y sólo si el bot no está apagado: en
  // PRUEBA decide quién recibe respuesta, en TODOS decide quién no tiene el
  // tope por hora. Va después de la firma y del cruce de phone_number_id, como
  // toda lectura del local: un request sin firmar no gasta ni esta consulta.
  const numerosDePrueba =
    bot.modo === 'APAGADO'
      ? []
      : (
          await prismaParaTenant(tenantId).numeroDePruebaBot.findMany({ select: { digitos: true } })
        ).map((n) => n.digitos)

  for (const entrante of entrantes) {
    await atender(entrante, {
      tenantId,
      nombreLocal: resolucion.tenant.nombre,
      phoneNumberId: bot.phoneNumberId,
      numeroVisible: bot.numeroVisible,
      modo: bot.modo,
      numerosDePrueba,
      aQueSeDedica: bot.aQueSeDedica,
      instrucciones: bot.instrucciones,
      topeMensual: bot.topeMensual,
    })
  }
```

(d) En `type Local`, reemplazar `activo: boolean` por:

```ts
  modo: ModoBot
  numerosDePrueba: string[]
```

(e) Reemplazar `evaluarCorte` entera (docblock incluido) por:

```ts
/**
 * Los cortes, TODOS antes de insertar.
 *
 * Que se evalúen antes no es una optimización: el motivo se escribe en la misma
 * fila que crea el mensaje, y `mensajes_bot` no admite UPDATE (es tabla-libro,
 * ver scripts/setup-db-roles.sh). Anotar el motivo después exigiría un UPDATE
 * que el rol de la app no tiene, y fallaría en silencio.
 *
 * Todos son lecturas locales: ninguno gasta un solo milisegundo de red del
 * presupuesto de diez segundos del webhook.
 *
 * **El modo prueba** (docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md):
 * en PRUEBA sólo se contesta a los números de la lista, y el resto queda
 * guardado con `MODO_PRUEBA`. Un número de prueba no tiene el tope por hora en
 * ningún modo —ese tope defiende del ping-pong entre automatizaciones, y quien
 * prueba es una persona que llega a doce preguntas en diez minutos—, pero sí el
 * mensual, porque cada respuesta de prueba se paga igual.
 */
async function evaluarCorte(
  entrante: MensajeEntrante,
  local: Local,
): Promise<MotivoSinRespuesta | null> {
  if (local.modo === 'APAGADO') return 'BOT_APAGADO'
  const esDePrueba = coincideConAlguno(entrante.waId, local.numerosDePrueba)
  if (local.modo === 'PRUEBA' && !esDePrueba) return 'MODO_PRUEBA'
  if (entrante.texto === '') return 'SIN_TEXTO'
  if (!modeloConfigurado()) return 'SIN_MODELO'
  if ((await respuestasDelMes(local.tenantId)) >= local.topeMensual) return 'TOPE_MENSUAL'
  if (
    !esDePrueba &&
    (await respuestasDeLaUltimaHora(local.tenantId, entrante.waId)) >= TOPE_POR_CONVERSACION_POR_HORA
  ) {
    return 'TOPE_CONVERSACION'
  }
  return null
}
```

- [ ] **Step 4: Correr y ver que pasan**

Run: `npx vitest run app/api/whatsapp/webhook/route.test.ts`
Expected: PASS

- [ ] **Step 5: Escribir los tests de base de lo que cuenta la pantalla y del invariante de rollback**

```ts
// lib/bot/limites.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
let conversacionId: string
let limites: typeof import('@/lib/bot/limites')

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'bot-limites')
  process.env.DATABASE_URL = urlApp()
  limites = await import('@/lib/bot/limites')
})

afterAll(async () => {
  await owner.end()
})

beforeEach(async () => {
  await owner.query('DELETE FROM conversaciones_bot WHERE tenant_id = $1', [tenantId])
  const { rows } = await owner.query(
    `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
     VALUES (gen_random_uuid(), $1, '+5491155550000', now(), now()) RETURNING id`,
    [tenantId],
  )
  conversacionId = rows[0].id
})

async function entrante(motivo: string | null, creadoEn = 'now()') {
  await owner.query(
    `INSERT INTO mensajes_bot (id, tenant_id, conversacion_id, direccion, texto, wamid, motivo, creado_en)
     VALUES (gen_random_uuid(), $1, $2, 'ENTRANTE', 'hola', gen_random_uuid()::text, $3, ${creadoEn})`,
    [tenantId, conversacionId, motivo],
  )
}

describe('los clientes que escribieron durante la prueba', () => {
  it('cuenta sólo los entrantes con MODO_PRUEBA del mes', async () => {
    await entrante('MODO_PRUEBA')
    await entrante('MODO_PRUEBA')
    await entrante('BOT_APAGADO')
    await entrante(null)
    await entrante('MODO_PRUEBA', "now() - interval '40 days'")
    expect(await limites.sinRespuestaEnPruebaDelMes(tenantId)).toBe(2)
  })

  it('sin mensajes da cero', async () => {
    expect(await limites.sinRespuestaEnPruebaDelMes(tenantId)).toBe(0)
  })
})
```

```ts
// lib/bot/conversaciones.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
let conversaciones: typeof import('@/lib/bot/conversaciones')

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'bot-conversaciones')
  process.env.DATABASE_URL = urlApp()
  conversaciones = await import('@/lib/bot/conversaciones')
})

afterAll(async () => {
  await owner.end()
})

describe('el historial que ve el modelo', () => {
  /**
   * El invariante que hace seguro el rollback (spec, *Deploy*): la imagen
   * anterior no conoce `MODO_PRUEBA`, y su Prisma fallaría al deserializar una
   * fila con ese valor. `historialDe` las filtra en el WHERE y selecciona sólo
   * dirección y texto, así que nunca las lee. Si alguien cambia esa consulta
   * para traer la fila entera sin filtrar el motivo, este caso tiene que
   * avisar.
   */
  it('excluye los mensajes de clientes reales durante la prueba sin leerlos', async () => {
    const { rows } = await owner.query(
      `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
       VALUES (gen_random_uuid(), $1, '+5491155550000', now(), now()) RETURNING id`,
      [tenantId],
    )
    const conversacionId = rows[0].id
    await owner.query(
      `INSERT INTO mensajes_bot (id, tenant_id, conversacion_id, direccion, texto, wamid, motivo, creado_en)
       VALUES (gen_random_uuid(), $1, $2, 'ENTRANTE', 'durante la prueba', 'wamid.p', 'MODO_PRUEBA', now() - interval '1 minute'),
              (gen_random_uuid(), $1, $2, 'ENTRANTE', 'con el bot contestando', 'wamid.t', NULL, now())`,
      [tenantId, conversacionId],
    )

    const historial = await conversaciones.historialDe(tenantId, conversacionId)
    expect(historial).toEqual([{ rol: 'cliente', texto: 'con el bot contestando' }])
  })
})
```

- [ ] **Step 6: Correr y ver que fallan**

Run: `npx vitest run lib/bot/limites.test.ts lib/bot/conversaciones.test.ts`
Expected: `limites.test.ts` FAIL con "limites.sinRespuestaEnPruebaDelMes is not a function". `conversaciones.test.ts` PASS: el invariante ya se cumple, y el caso existe para que nadie lo rompa después.

- [ ] **Step 7: Implementar en `lib/bot/limites.ts`**

Agregar al final:

```ts
/**
 * Cuántos clientes escribieron este mes mientras el bot estaba en prueba y no
 * recibieron respuesta.
 *
 * Es el dato con el que el dueño decide pasar a Todos. Se cuentan filas, igual
 * que el tope: los mensajes se guardan igual (guardar siempre, decidir
 * después), así que no hay nada que acumular aparte.
 */
export async function sinRespuestaEnPruebaDelMes(
  tenantId: string,
  ahora: Date = new Date(),
): Promise<number> {
  return prismaParaTenant(tenantId).mensajeBot.count({
    where: { direccion: 'ENTRANTE', motivo: 'MODO_PRUEBA', creadoEn: { gte: inicioDelMes(ahora) } },
  })
}
```

- [ ] **Step 8: Actualizar `scripts/probar-bot.mts`**

Línea 75, `select`: reemplazar `activo: true` por `modo: true`.
Línea 110: reemplazar por:

```ts
if (bot && bot.modo !== 'TODOS') {
  const estado = bot.modo === 'PRUEBA' ? 'EN PRUEBA' : 'APAGADO'
  console.log(`aviso:   el bot está ${estado}; esto lo corre igual, sin tocar ese estado.`)
}
```

- [ ] **Step 9: Correr todo lo del bot, typecheck y lint**

Run: `npx vitest run app/api/whatsapp lib/bot && npx tsc --noEmit && npm run lint`
Expected: PASS y limpio.

- [ ] **Step 10: Commit**

```bash
git add app/api/whatsapp/webhook lib/bot/limites.ts lib/bot/limites.test.ts lib/bot/conversaciones.test.ts scripts/probar-bot.mts
git commit -m "feat(bot): el webhook contesta según el modo y los números de prueba"
```

---

### Task 5: Las server actions nuevas

**Files:**
- Modify: `app/(app)/bot/acciones.ts`
- Modify: `app/(app)/bot/acciones.test.ts`

**Interfaces:**
- Consumes: `cambiarModo`, `agregarNumeroDePrueba`, `quitarNumeroDePrueba` (Task 3).
- Produces:
  - `cambiarModoDelBot(modo: string): Promise<EstadoBot>`
  - `agregarNumeroDePruebaDelLocal(texto: string): Promise<EstadoBot>`
  - `quitarNumeroDePruebaDelLocal(id: string): Promise<EstadoBot>`
  - `prenderOApagar` **sigue existiendo** hasta la Task 6.

- [ ] **Step 1: Escribir los tests**

En `app/(app)/bot/acciones.test.ts`:

(a) Sumar `vi.fn()` y entradas al mock de `@/lib/bot/administrar`:

```ts
const cambiarModo = vi.fn()
const agregarNumeroDePrueba = vi.fn()
const quitarNumeroDePrueba = vi.fn()
```

y dentro del objeto del `vi.mock('@/lib/bot/administrar', …)`:

```ts
  cambiarModo: (...a: unknown[]) => cambiarModo(...a),
  agregarNumeroDePrueba: (...a: unknown[]) => agregarNumeroDePrueba(...a),
  quitarNumeroDePrueba: (...a: unknown[]) => quitarNumeroDePrueba(...a),
```

(b) En el `it.each` de `'%s se delega con el permiso BOT'`, sumar:

```ts
    ['cambiarModoDelBot', () => acciones.cambiarModoDelBot('PRUEBA')],
    ['agregarNumeroDePruebaDelLocal', () => acciones.agregarNumeroDePruebaDelLocal('11 2233-4455')],
    ['quitarNumeroDePruebaDelLocal', () => acciones.quitarNumeroDePruebaDelLocal('0190a1b2-0000-7000-8000-000000000000')],
```

(c) Agregar en `describe('los guards de las acciones de /bot'`:

```ts
  it.each([
    ['cambiarModoDelBot', () => acciones.cambiarModoDelBot('TODOS'), () => cambiarModo],
    ['agregarNumeroDePruebaDelLocal', () => acciones.agregarNumeroDePruebaDelLocal('11 2233-4455'), () => agregarNumeroDePrueba],
    ['quitarNumeroDePruebaDelLocal', () => acciones.quitarNumeroDePruebaDelLocal('x'), () => quitarNumeroDePrueba],
  ])('un empleado sin BOT no puede %s', async (_n, correr, efecto) => {
    exigirPermiso.mockRejectedValue(new Error('forbidden'))
    await expect(correr()).rejects.toThrow()
    expect(efecto(), 'la acción corrió sin el permiso BOT').not.toHaveBeenCalled()
  })
```

(d) Agregar en `describe('lo que las acciones devuelven'`:

```ts
  it('el modo viaja tal cual; lo valida administrar', async () => {
    await acciones.cambiarModoDelBot('PRUEBA')
    expect(cambiarModo).toHaveBeenCalledWith('tenant-1', 'PRUEBA')
  })

  it('cada modo avisa lo que va a pasar con el próximo mensaje', async () => {
    expect((await acciones.cambiarModoDelBot('APAGADO')).aviso).toBe('El bot dejó de contestar.')
    expect((await acciones.cambiarModoDelBot('PRUEBA')).aviso).toBe(
      'El bot contesta sólo a los números de prueba.',
    )
    expect((await acciones.cambiarModoDelBot('TODOS')).aviso).toBe('El bot les contesta a todos.')
  })

  it('agregar pasa el texto tipeado y quitar el id', async () => {
    await acciones.agregarNumeroDePruebaDelLocal('11 2233-4455')
    expect(agregarNumeroDePrueba).toHaveBeenCalledWith('tenant-1', '11 2233-4455')
    await acciones.quitarNumeroDePruebaDelLocal('id-1')
    expect(quitarNumeroDePrueba).toHaveBeenCalledWith('tenant-1', 'id-1')
  })

  it('un número repetido se muestra como error, no se relanza', async () => {
    const { ErrorDeBot } = await import('@/lib/bot/errores')
    agregarNumeroDePrueba.mockRejectedValueOnce(
      new ErrorDeBot('NUMERO_REPETIDO', 'Ese número ya está en la lista de prueba.'),
    )
    const r = await acciones.agregarNumeroDePruebaDelLocal('11 2233-4455')
    expect(r.error).toBe('Ese número ya está en la lista de prueba.')
  })
```

(e) En `describe('el gate del rollout alcanza a las cinco acciones'`, renombrar el `describe` a `'el gate del rollout alcanza a todas las acciones'` y sumar a `TODAS`:

```ts
    ['cambiarModoDelBot', () => acciones.cambiarModoDelBot('PRUEBA'), cambiarModo],
    ['agregarNumeroDePruebaDelLocal', () => acciones.agregarNumeroDePruebaDelLocal('11 2233-4455'), agregarNumeroDePrueba],
    ['quitarNumeroDePruebaDelLocal', () => acciones.quitarNumeroDePruebaDelLocal('id-1'), quitarNumeroDePrueba],
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run "app/(app)/bot/acciones.test.ts"`
Expected: FAIL con "acciones.cambiarModoDelBot is not a function".

- [ ] **Step 3: Implementar en `acciones.ts`**

(a) En el import de `@/lib/bot/administrar`, sumar `agregarNumeroDePrueba`, `cambiarModo`, `quitarNumeroDePrueba`.

(b) En el docblock de `exigirBotHabilitado`, reemplazar "en las CINCO acciones" por "en TODAS las acciones".

(c) Agregar después de `prenderOApagar`:

```ts
const AVISO_DEL_MODO: Record<string, string> = {
  APAGADO: 'El bot dejó de contestar.',
  PRUEBA: 'El bot contesta sólo a los números de prueba.',
  TODOS: 'El bot les contesta a todos.',
}

/**
 * A quién le contesta el bot. El modo llega como string y lo valida
 * `cambiarModo`: una server action recibe lo que el navegador mande.
 *
 * La confirmación en dos toques para pasar a Todos vive en la pantalla y no
 * acá: es una defensa contra el toque de más, no una autorización, y quien
 * tiene `BOT` puede pasar a Todos llamando a la acción directo igual que
 * tocando dos veces.
 */
export async function cambiarModoDelBot(modo: string): Promise<EstadoBot> {
  try {
    const sesion = await exigirPermiso('BOT')
    exigirBotHabilitado(sesion.subdominio)
    await cambiarModo(sesion.tenant.id, modo)
    revalidatePath('/bot')
    return { error: null, aviso: AVISO_DEL_MODO[modo] ?? null, enlace: null }
  } catch (e) {
    return traducir(e)
  }
}

/** Con `BOT`, igual que cambiar el modo: elegir a quién le contesta el bot en
 *  prueba es la misma palanca. */
export async function agregarNumeroDePruebaDelLocal(texto: string): Promise<EstadoBot> {
  try {
    const sesion = await exigirPermiso('BOT')
    exigirBotHabilitado(sesion.subdominio)
    await agregarNumeroDePrueba(sesion.tenant.id, texto)
    revalidatePath('/bot')
    return { error: null, aviso: 'Número de prueba agregado.', enlace: null }
  } catch (e) {
    return traducir(e)
  }
}

export async function quitarNumeroDePruebaDelLocal(id: string): Promise<EstadoBot> {
  try {
    const sesion = await exigirPermiso('BOT')
    exigirBotHabilitado(sesion.subdominio)
    await quitarNumeroDePrueba(sesion.tenant.id, id)
    revalidatePath('/bot')
    return { error: null, aviso: 'Número de prueba quitado.', enlace: null }
  } catch (e) {
    return traducir(e)
  }
}
```

- [ ] **Step 4: Correr y ver que pasan, y los vigías del límite**

Run: `npx vitest run "app/(app)/bot/acciones.test.ts" test/use-server.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS y limpio.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/bot/acciones.ts" "app/(app)/bot/acciones.test.ts"
git commit -m "feat(bot): acciones para el modo y los números de prueba"
```

---

### Task 6: La card "El bot" pasa a ser un segmentado de tres modos

Acá se va el switch, junto con `prenderOApagar`, `alternarActivo` y `BotDelLocal.activo`, que quedan sin consumidor.

**Files:**
- Modify: `app/(app)/bot/formularios.tsx`
- Modify: `app/(app)/bot/page.tsx`
- Modify: `app/(app)/bot/page.test.tsx`
- Modify: `app/(app)/bot/acciones.ts`, `app/(app)/bot/acciones.test.ts`
- Modify: `lib/bot/administrar.ts`, `lib/bot/administrar.test.ts`

**Interfaces:**
- Consumes: `MODOS`, `type Modo`, `esModo`, `tocarModo`, `leyendaDelModo`, `subtituloDelModo`, `MS_CONFIRMACION_TODOS` (Task 1); `cambiarModoDelBot` (Task 5); `numerosDePruebaDelLocal` (Task 3).
- Produces: `VistaDelBot` pierde `activo` y suma `modo: Modo` y `numerosDePrueba: { id: string; digitos: string; ultimoMensajeEn: string | null }[]`, con la fecha ya formateada. La Task 7 la consume.

- [ ] **Step 1: Escribir los tests de pantalla**

En `app/(app)/bot/page.test.tsx`:

(a) Sumar `const numerosDePruebaDelLocal = vi.fn()` y agregarlo al mock de `@/lib/bot/administrar`:

```ts
vi.mock('@/lib/bot/administrar', () => ({
  botDelLocal: () => botDelLocal(),
  numerosDisponibles: () => numerosDisponibles(),
  numerosDePruebaDelLocal: () => numerosDePruebaDelLocal(),
}))
```

(b) En `SIN_CONECTAR` reemplazar `activo: false,` por `modo: 'APAGADO',`. En `CONECTADO` reemplazar `activo: true,` por `modo: 'TODOS',`.

(c) En `beforeEach`, sumar `numerosDePruebaDelLocal.mockResolvedValue([])`.

(d) Agregar al final del `describe('/bot'`:

```ts
  describe('el modo del bot', () => {
    it('ofrece los tres modos con el actual marcado', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      const html = await render()
      expect(html).toContain('Apagado')
      expect(html).toContain('Sólo prueba')
      expect(html).toContain('Todos')
      // En modo single, Radix renderiza cada ítem como un <button role="radio">
      // con aria-checked: el elegido es el único en "true".
      expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*>Sólo prueba<\/button>/)
      expect(html).not.toMatch(/<button[^>]*aria-checked="true"[^>]*>Todos<\/button>/)
    })

    it('en prueba el encabezado dice En prueba', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      expect(await render()).toContain('En prueba')
    })

    it('apagado el encabezado dice Apagado y la leyenda explica que no contesta', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'APAGADO' })
      const html = await render()
      expect(html).toContain('+54 9 11 5555 0000 · Apagado')
      expect(html).toContain('No le contesta a nadie. Los mensajes quedan guardados.')
    })

    it('en prueba sin números avisa que no le contesta a nadie', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      numerosDePruebaDelLocal.mockResolvedValue([])
      expect(await render()).toContain(
        'Todavía no cargaste ningún número de prueba: no le contesta a nadie.',
      )
    })

    it('en prueba con números dice a quién contesta', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      numerosDePruebaDelLocal.mockResolvedValue([
        { id: 'n1', digitos: '1122334455', ultimoMensajeEn: null },
      ])
      expect(await render()).toContain('Contesta sólo a los números de prueba.')
    })

    it('sin número conectado no ofrece el modo ni consulta los números de prueba', async () => {
      const html = await render()
      expect(html).not.toContain('Sólo prueba')
      expect(numerosDePruebaDelLocal).not.toHaveBeenCalled()
    })
  })
```

Si en el Step 7 la regex del primer caso no matchea pese a que la pantalla marca bien el modo, es porque la versión de Radix del repo renderiza el ítem con otro atributo (`aria-pressed` en vez de `aria-checked`). Verificarlo con un `console.log(html)` puntual, ajustar **sólo el nombre del atributo** en las dos regex y sacar el `console.log`. Las dos direcciones (el elegido en `true`, otro no) se conservan.

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run "app/(app)/bot/page.test.tsx"`
Expected: FAIL. La pantalla todavía dibuja el switch ("Está contestando"), y no aparecen "Sólo prueba" ni "En prueba".

- [ ] **Step 3: Pasar la pantalla a `modo`**

En `app/(app)/bot/page.tsx`:

(a) Imports: sumar `numerosDePruebaDelLocal` al import de `@/lib/bot/administrar`, y `import { subtituloDelModo } from '@/lib/bot/modo'`.

(b) Antes de `const vista`, agregar:

```ts
  // Sólo con número conectado: sin número no hay modo que elegir, y la card de
  // números de prueba no se dibuja.
  const numerosDePrueba = conectado
    ? (await numerosDePruebaDelLocal(sesion.tenant.id)).map((n) => ({
        id: n.id,
        digitos: n.digitos,
        ultimoMensajeEn: n.ultimoMensajeEn ? formatearFechaCorta(n.ultimoMensajeEn) : null,
      }))
    : []
```

(c) En `vista`, reemplazar `activo: bot.activo,` por:

```ts
    modo: bot.modo,
    numerosDePrueba,
```

(d) En el `subtitulo` del `<Encabezado>`, reemplazar `${bot.activo ? 'Contestando' : 'Apagado'}` por `${subtituloDelModo(bot.modo)}`.

- [ ] **Step 4: Reemplazar el `Interruptor` por `ModoDelBot` en `formularios.tsx`**

(a) Imports: `useEffect` al import de `react`; sacar `Switch`, y `Power` de lucide si queda sin uso (el lint del Step 7 lo marca); sumar:

```ts
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  MODOS,
  MS_CONFIRMACION_TODOS,
  esModo,
  leyendaDelModo,
  tocarModo,
  type Modo,
} from '@/lib/bot/modo'
```

En el import de `./acciones`, reemplazar `prenderOApagar` por `cambiarModoDelBot`.

(b) En `VistaDelBot`, reemplazar `activo: boolean` por:

```ts
  modo: Modo
  /** La lista de prueba, con la fecha del último mensaje ya formateada en el
   *  servidor (huso de Buenos Aires). */
  numerosDePrueba: { id: string; digitos: string; ultimoMensajeEn: string | null }[]
```

(c) Reemplazar la función `Interruptor` entera por:

```tsx
const ETIQUETA_DEL_MODO: Record<Modo, string> = {
  APAGADO: 'Apagado',
  PRUEBA: 'Sólo prueba',
  TODOS: 'Todos',
}

/**
 * A quién le contesta el bot: nadie, sólo los números de prueba, o todos.
 *
 * Un segmentado y no un switch más un toggle de prueba: tres estados reales, y
 * ninguna combinación de dos controles que haya que leer junta para saber qué
 * pasa con el próximo mensaje.
 *
 * **Pasar a Todos pide dos toques** (`tocarModo`, lib/bot/modo.ts). Es la única
 * transición que manda el bot a clientes reales, y con tres pastillas juntas un
 * toque de más sobre la vecina alcanza para hacerlo sin querer. La confirmación
 * vive en la leyenda de abajo y se desarma sola: mismo mecanismo que
 * `AnularVenta`, sin diálogo.
 */
function ModoDelBot({ vista }: { vista: VistaDelBot }) {
  const [enCurso, empezar] = useTransition()
  const [modo, setModo] = useState<Modo>(vista.modo)
  const [armadoTodos, setArmadoTodos] = useState(false)

  useEffect(() => {
    if (!armadoTodos) return
    const t = setTimeout(() => setArmadoTodos(false), MS_CONFIRMACION_TODOS)
    return () => clearTimeout(t)
  }, [armadoTodos])

  if (!vista.conectado) return null

  const tocar = (valor: string) => {
    // Radix manda '' al tocar el ítem ya elegido: un modo nunca queda vacío.
    if (!esModo(valor)) return
    const r = tocarModo({ modo, armadoTodos }, valor)
    setArmadoTodos(r.armadoTodos)
    const nuevo = r.cambiarA
    if (!nuevo) return

    const antes = modo
    setModo(nuevo)
    empezar(async () => {
      const resultado = avisar(await cambiarModoDelBot(nuevo), 'bot-modo')
      // Rollback si el servidor lo rechazó: el control no puede quedar diciendo
      // algo distinto de lo que la base guardó.
      if (resultado.error) {
        setModo(antes)
        return
      }
      // Al empezar a probar también: es justo cuando conviene enterarse.
      if (nuevo === 'APAGADO') return
      if (!vista.aQueSeDedica.trim()) {
        // Primero éste: sin saber a qué se dedica el local, el bot contesta
        // como "un comercio" cualquiera, que es peor que no saber los horarios.
        toast('El bot todavía no sabe a qué se dedica tu local: va a hablar en genérico hasta que se lo cargues.', {
          id: 'bot-sin-dedicacion',
        })
      } else if (!vista.instrucciones.trim()) {
        toast('El bot va a contestar sólo precios y disponibilidad hasta que cargues la información del local.', {
          id: 'bot-sin-info',
        })
      }
    })
  }

  return (
    <Seccion titulo="El bot">
      <ToggleGroup
        type="single"
        value={modo}
        onValueChange={tocar}
        disabled={enCurso}
        aria-label="A quién le contesta el bot"
        className="w-full gap-0.5 rounded-[10px] bg-muted p-[3px]"
      >
        {MODOS.map((m) => (
          <ToggleGroupItem
            key={m}
            value={m}
            className="flex-1 rounded-lg text-xs font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-foreground"
          >
            {ETIQUETA_DEL_MODO[m]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className={cn(AYUDA, armadoTodos && 'font-semibold text-foreground')} aria-live="polite">
        {leyendaDelModo({ modo, cantidadNumeros: vista.numerosDePrueba.length, armadoTodos })}
      </p>
      {!vista.modeloListo && (
        <p className="rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
          Falta configurar el modelo en este servidor, así que el bot no puede responder todavía.
          Los mensajes que lleguen quedan guardados.
        </p>
      )}
    </Seccion>
  )
}
```

(d) En `CuerpoBot`, reemplazar `<Interruptor vista={vista} />` por `<ModoDelBot vista={vista} />`.

- [ ] **Step 5: Borrar lo que quedó sin consumidor**

(a) `app/(app)/bot/acciones.ts`: borrar `prenderOApagar` entera y sacar `alternarActivo` del import.

(b) `app/(app)/bot/acciones.test.ts`:
- Sacar `alternarActivo` del mock y su `vi.fn()`.
- Sacar `['prenderOApagar', …]` del `it.each` de delegación y de `TODAS`.
- Borrar el test `'un empleado sin BOT no puede prender el bot'`: ya lo cubre el `it.each` de la Task 5.
- Borrar `'el switch manda el booleano, no un texto'`.

(c) `lib/bot/administrar.ts`:
- Borrar `alternarActivo` entera.
- Sacar `activo` de `BotDelLocal`, de `VACIO` y de `CAMPOS`.
- `cambiarModo`, `confirmarNumero` y `desconectar` siguen **escribiendo** `activo`: no se toca.

(d) `lib/bot/administrar.test.ts`: borrar el `describe('prender el bot')` entero. El `SIN_NUMERO` ya lo cubre `'no se puede pasar a prueba ni a todos sin número conectado'`.

- [ ] **Step 6: Confirmar que nadie más lee `activo` ni llama a lo borrado**

Run: `grep -rn "prenderOApagar\|alternarActivo\|\.activo\b\|vista\.activo" app lib scripts --include=*.ts --include=*.tsx --include=*.mts`
Expected: ninguna coincidencia. Si aparece algo que no sea una **escritura** de `activo` en `lib/bot/administrar.ts`, resolverlo antes de seguir.

- [ ] **Step 7: Correr, typecheck y lint**

Run: `npx vitest run "app/(app)/bot" lib/bot test/limite-cliente-servidor.test.ts test/servidor-llama-a-cliente.test.ts test/responsive.test.ts test/sistema-de-diseno.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS y limpio.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/bot" lib/bot/administrar.ts lib/bot/administrar.test.ts
git commit -m "feat(bot): el switch pasa a ser un segmentado de tres modos"
```

---

### Task 7: La card "Números de prueba" y los clientes sin respuesta durante la prueba

**Files:**
- Modify: `app/(app)/bot/formularios.tsx`
- Modify: `app/(app)/bot/page.tsx`
- Modify: `app/(app)/bot/page.test.tsx`

**Interfaces:**
- Consumes: `VistaDelBot.numerosDePrueba` (Task 6); `agregarNumeroDePruebaDelLocal`, `quitarNumeroDePruebaDelLocal` (Task 5); `mostrarNumeroDePrueba`, `TOPE_NUMEROS_DE_PRUEBA` (Task 1); `sinRespuestaEnPruebaDelMes` (Task 4).
- Produces: `VistaDelBot.sinRespuestaEnPrueba: number`.

- [ ] **Step 1: Escribir los tests de pantalla**

En `app/(app)/bot/page.test.tsx`:

(a) Sumar `const sinRespuestaEnPruebaDelMes = vi.fn()` y reemplazar el mock de `@/lib/bot/limites` por:

```ts
vi.mock('@/lib/bot/limites', () => ({
  respuestasDelMes: () => respuestasDelMes(),
  sinRespuestaEnPruebaDelMes: () => sinRespuestaEnPruebaDelMes(),
}))
```

(b) En `beforeEach`, sumar `sinRespuestaEnPruebaDelMes.mockResolvedValue(0)`.

(c) Agregar al final del `describe('/bot'`:

```ts
  describe('los números de prueba', () => {
    it('con número conectado se ve la card aunque el bot esté en todos', async () => {
      botDelLocal.mockResolvedValue(CONECTADO)
      const html = await render()
      expect(html).toContain('Números de prueba')
      expect(html).toContain('Con código de área, sin 0 y sin 15. Ej: 11 2233-4455.')
    })

    it('sin número conectado no se ve', async () => {
      expect(await render()).not.toContain('Números de prueba')
    })

    /**
     * La segunda línea de cada número es la verificación de que está bien
     * cargado (spec, decisión 2): las dos formas tienen que poder aparecer.
     */
    it('cada número dice si ya escribió', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      numerosDePruebaDelLocal.mockResolvedValue([
        { id: 'n1', digitos: '5491122334455', ultimoMensajeEn: new Date('2026-09-15T17:32:00Z') },
        { id: 'n2', digitos: '1199998888', ultimoMensajeEn: null },
      ])
      const html = await render()
      expect(html).toContain('112233-4455')
      expect(html).toContain('119999-8888')
      expect(html).toContain('Último mensaje:')
      expect(html).toContain('Todavía no escribió')
    })

    it('con 20 números avisa el tope y deshabilita el campo', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      numerosDePruebaDelLocal.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          id: `n${i}`,
          digitos: `11000000${String(i).padStart(2, '0')}`,
          ultimoMensajeEn: null,
        })),
      )
      const html = await render()
      expect(html).toContain('Llegaste al tope de 20 números de prueba')
      expect(html).toMatch(/<input[^>]*id="bot-numero-prueba"[^>]*disabled=""/)
    })
  })

  describe('los clientes que escribieron durante la prueba', () => {
    it('en prueba, con clientes sin respuesta, lo dice en Este mes', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      sinRespuestaEnPruebaDelMes.mockResolvedValue(6)
      expect(await render()).toContain(
        'Mientras estuvo en prueba te escribieron 6 clientes que no recibieron respuesta.',
      )
    })

    it('en prueba sin clientes sin respuesta no agrega la línea', async () => {
      botDelLocal.mockResolvedValue({ ...CONECTADO, modo: 'PRUEBA' })
      expect(await render()).not.toContain('Mientras estuvo en prueba')
    })

    /** Sólo corre en prueba: en todos o apagado es una consulta que no se muestra. */
    it('fuera de prueba ni siquiera lo cuenta', async () => {
      botDelLocal.mockResolvedValue(CONECTADO)
      const html = await render()
      expect(html).not.toContain('Mientras estuvo en prueba')
      expect(sinRespuestaEnPruebaDelMes).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `npx vitest run "app/(app)/bot/page.test.tsx"`
Expected: FAIL. No aparecen "Números de prueba" ni la línea de Este mes.

- [ ] **Step 3: Pasar el conteo a la vista**

En `app/(app)/bot/page.tsx`:

(a) Sumar `sinRespuestaEnPruebaDelMes` al import de `@/lib/bot/limites`.

(b) En `vista`, después de `respuestasDelMes: …`, agregar:

```ts
    // Sólo en prueba: es el dato con el que el dueño decide pasar a Todos, y
    // fuera de ese modo sería una consulta por mensaje de pantalla que no se
    // muestra.
    sinRespuestaEnPrueba:
      conectado && bot.modo === 'PRUEBA' ? await sinRespuestaEnPruebaDelMes(sesion.tenant.id) : 0,
```

- [ ] **Step 4: La card y la línea en `formularios.tsx`**

(a) Imports: sumar `Plus` al import de lucide; sumar al import de `./acciones` `agregarNumeroDePruebaDelLocal` y `quitarNumeroDePruebaDelLocal`; y:

```ts
import { TOPE_NUMEROS_DE_PRUEBA, mostrarNumeroDePrueba } from '@/lib/bot/numeros-de-prueba'
```

(b) En `VistaDelBot`, sumar debajo de `respuestasDelMes: number`:

```ts
  /** Entrantes con MODO_PRUEBA este mes. Cero fuera de prueba. */
  sinRespuestaEnPrueba: number
```

(c) Agregar la función, debajo de `ModoDelBot`:

```tsx
/**
 * La lista de números a los que el bot les contesta en «Sólo prueba».
 *
 * Se ve en cualquier modo con número conectado, para poder armarla antes de
 * pasar a prueba. Cada número muestra si ya escribió alguien que coincida con
 * él, y ésa es la verificación del número: la comparación es por los últimos
 * 10 dígitos, así que uno tipeado con 0 y 15 no coincide con nadie y se queda
 * en "Todavía no escribió" aunque el dueño se escriba desde ese celular.
 *
 * Los errores van por toast y no inline, con el mismo `avisar` que el resto de
 * la pantalla: el campo es uno solo y el mensaje dice qué corregir.
 */
function NumerosDePrueba({ vista }: { vista: VistaDelBot }) {
  const [enCurso, empezar] = useTransition()
  const [texto, setTexto] = useState('')

  if (!vista.conectado) return null

  const lleno = vista.numerosDePrueba.length >= TOPE_NUMEROS_DE_PRUEBA

  const agregar = () =>
    empezar(async () => {
      const r = avisar(await agregarNumeroDePruebaDelLocal(texto), 'bot-numero-agregar')
      if (!r.error) setTexto('')
    })

  const quitar = (id: string) =>
    empezar(async () => {
      avisar(await quitarNumeroDePruebaDelLocal(id), `bot-numero-quitar-${id}`)
    })

  return (
    <Seccion titulo="Números de prueba">
      <p className={AYUDA}>Con el bot en «Sólo prueba», contesta únicamente a estos números.</p>
      <form
        className="flex flex-col gap-2 lg:flex-row"
        onSubmit={(e) => {
          e.preventDefault()
          agregar()
        }}
      >
        <Label htmlFor="bot-numero-prueba" className="sr-only">
          Número de prueba
        </Label>
        <Input
          id="bot-numero-prueba"
          inputMode="tel"
          autoComplete="off"
          placeholder="11 2233-4455"
          value={texto}
          disabled={lleno || enCurso}
          onChange={(e) => setTexto(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={lleno || enCurso || !texto.trim()}>
          <Plus className="size-4" />
          Agregar
        </Button>
      </form>
      <p className={AYUDA}>
        {lleno
          ? `Llegaste al tope de ${TOPE_NUMEROS_DE_PRUEBA} números de prueba. Quitá uno para agregar otro.`
          : 'Con código de área, sin 0 y sin 15. Ej: 11 2233-4455.'}
      </p>
      {vista.numerosDePrueba.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {vista.numerosDePrueba.map((n) => {
            const visible = mostrarNumeroDePrueba(n.digitos)
            return (
              <li key={n.id} className="flex flex-col gap-2 p-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium tabular-nums text-foreground">{visible}</p>
                  <p className={AYUDA}>
                    {n.ultimoMensajeEn ? `Último mensaje: ${n.ultimoMensajeEn}` : 'Todavía no escribió'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={enCurso}
                  onClick={() => quitar(n.id)}
                  aria-label={`Quitar ${visible}`}
                >
                  Quitar
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Seccion>
  )
}
```

(d) En `Consumo`, antes del `return` (después de `const lleno = …`), agregar:

```tsx
  // Un solo template string y no fragmentos JSX: renderToStaticMarkup separa
  // los fragmentos con `<!-- -->`, y la oración dejaría de poder buscarse
  // entera en el test.
  const sinRespuesta = vista.sinRespuestaEnPrueba
  const enPrueba =
    vista.modo === 'PRUEBA' && sinRespuesta > 0
      ? `Mientras estuvo en prueba te escribieron ${sinRespuesta} ${
          sinRespuesta === 1 ? 'cliente que no recibió' : 'clientes que no recibieron'
        } respuesta.`
      : null
```

y dentro de la `Seccion`, debajo del `<p className={AYUDA}>` existente:

```tsx
      {enPrueba && <p className={AYUDA}>{enPrueba}</p>}
```

(e) En `CuerpoBot`, debajo de `<ModoDelBot vista={vista} />`, agregar `<NumerosDePrueba vista={vista} />`.

- [ ] **Step 5: Correr, vigías y typecheck**

Run: `npx vitest run "app/(app)/bot" test/limite-cliente-servidor.test.ts test/responsive.test.ts test/sistema-de-diseno.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS y limpio. Si `test/sistema-de-diseno.test.ts` rechaza alguna clase de color de la card, reemplazarla por la que usan las filas de unidades de `app/(app)/inventario/[id]/page.tsx` y volver a correr.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/bot"
git commit -m "feat(bot): card de números de prueba y clientes sin respuesta durante la prueba"
```

---

### Task 8: Documentación y suite completa

**Files:**
- Modify: `docs/pantallas.md` (sección `` ## `/bot` ``, ~línea 2445)
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 38, antes de `## Cómo agregar una entrada`)
- Modify: `CLAUDE.md` (entrada nueva en *Próximos pasos técnicos → Y del producto*, inmediatamente antes de `- Definir el formato de los presets de rubro`)
- Modify: `docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md` (formato visible del número)

- [ ] **Step 1: `docs/pantallas.md`, sección `/bot`**

(a) Reemplazar la línea de **Acciones** por:

```markdown
**Acciones**: `generarEnlaceDeConexion`, `confirmarNumeroDelLocal`,
`desconectarNumero`, `cambiarModoDelBot`, `agregarNumeroDePruebaDelLocal`,
`quitarNumeroDePruebaDelLocal`, `guardarInformacionDelLocal`.
```

(b) En **Qué se puede hacer**, reemplazar `- Prender y apagar el bot.` por:

```markdown
- Elegir a quién le contesta el bot: a nadie, sólo a los números de prueba, o
  a todos.
- Cargar y quitar los números de prueba (hasta 20), y ver si cada uno ya
  escribió.
```

(c) Agregar al final de **Decisiones**:

```markdown
- **Probar es un modo del bot, no un switch más una lista.** El control es un
  segmentado Apagado · Sólo prueba · Todos. Con una lista que restringiera "si
  tiene números", quitar el último le soltaría el bot a todos los clientes sin
  ningún gesto. En prueba, el mensaje de un cliente real se guarda igual con
  motivo `MODO_PRUEBA`, y "Este mes" dice cuántos escribieron sin respuesta.

- **Pasar a Todos pide dos toques, y es la única transición que los pide.**
  El primer toque arma la confirmación en la leyenda y se desarma sola a los 3
  segundos (`tocarModo`, `lib/bot/modo.ts`). Es una defensa contra el toque de
  más sobre la pastilla vecina, no una autorización: la acción con `BOT` pasa a
  Todos igual.

- **Los números se comparan por los últimos 10 dígitos**
  (`lib/bot/numeros-de-prueba.ts`), así que `11 2233-4455` y el `5491122334455`
  de Kapso son el mismo. Uno tipeado con 0 y 15 no coincide con nadie, y por eso
  cada fila dice "Último mensaje" o "Todavía no escribió": es la verificación de
  que el número está bien cargado. Se muestran como `112233-4455`, sin partir el
  código de área, porque su largo varía.

- **Un número de prueba no tiene el tope de 12 respuestas por hora**, en ningún
  modo, pero sí el mensual. El tope por hora defiende del ping-pong entre
  automatizaciones; quien prueba es una persona.

- **`activo` se sigue escribiendo como `modo === 'TODOS'`** aunque la pantalla
  ya no lo lea: la imagen anterior sólo lee esa columna, y así un rollback
  durante una prueba deja al bot callado. Se borra en un deploy posterior.
```

- [ ] **Step 2: `docs/correcciones-pendientes-del-pen.md`, entrada 38**

Agregar antes de `## Cómo agregar una entrada` (con el separador `---` que usan las entradas anteriores):

```markdown
## 38. La maqueta no dibuja el modo del bot ni la card "Números de prueba", en ningún ancho

- **Frames**: ninguno. `design/arandano.pen` no tiene la pantalla `/bot` en
  ningún ancho: es anterior al ciclo del bot (2026-08-29).

**El segmentado Apagado · Sólo prueba · Todos** reemplaza al switch de la card
"El bot". Se derivó del `ToggleGroup` del alta de `/usuarios` (nodo `iotGr`),
con las mismas clases. Lo que no tiene referencia es **cómo se ve la
confirmación armada de Todos**: hoy la leyenda de abajo cambia de texto y pasa a
semibold, sin ningún color. Un frame tendría que decidir si ese estado pide más
presencia.

**La card "Números de prueba"**, debajo de "El bot". El campo con su botón se
derivó de los controles de la card de información del local, y las filas de
las de unidades de `/inventario/[id]`. Sin referencia: el apilado del botón
"Quitar" debajo del número en el teléfono y el formato `112233-4455`.

Qué haría falta: la pantalla `/bot` dibujada en los dos anchos, incluida la
leyenda con la confirmación armada.

Detectado al construir el ciclo del modo prueba del bot (2026-09-15). Ver
`docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md`.
```

- [ ] **Step 3: El spec, formato visible del número**

En `docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md`, decisión 6, reemplazar `los últimos 10 dígitos formateados (`11 2233-4455`)` por:

```markdown
los últimos 10 dígitos como `112233-4455` (sin partir el código de área, cuyo
largo varía de 2 a 4 dígitos)
```

- [ ] **Step 4: `CLAUDE.md`**

Agregar la entrada inmediatamente antes de `- Definir el formato de los presets de rubro y escribir los dos primeros (servicio técnico y retail).`:

```markdown
- ~~Poder probar el bot sin que les conteste a clientes reales.~~ **Hecho**
  (2026-09-15). Sale del pedido del dueño del producto: *"que el dueño pueda
  configurar N números a los que sólo el bot les responda. esto es para que lo
  pueda testear para ver cómo responde y que no afecte a clientes reales"*. Ver
  `docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md`.

  **Probar es un estado del bot, no un flag aparte.** `BotDeWhatsapp.activo`
  pasó a `modo` (`APAGADO | PRUEBA | TODOS`), un segmentado en `/bot`. Se
  descartó la lista que restringe "si tiene números": quitar el último número
  le soltaba el bot a todos los clientes sin ningún gesto que lo dijera. Pasar a
  Todos pide dos toques, y es la única transición que los pide.

  **`activo` no se borró, y el valor que se le escribe es el que hace seguro el
  rollback**: `modo === 'TODOS'`. La imagen anterior sólo lee esa columna, así
  que si el healthcheck la revierte durante una prueba, lee `false` y se calla.
  Con `modo !== 'APAGADO'` un rollback en plena prueba habría puesto al bot a
  contestarles a todos. El `DROP` es un deploy posterior. Y el valor nuevo
  `MODO_PRUEBA` tampoco rompe a la imagen vieja: ningún lector la deserializa
  (`historialDe` la filtra en el `WHERE`, los topes son `count`), y
  `lib/bot/conversaciones.test.ts` fija ese invariante.

  **Los números viven en `numeros_de_prueba_bot`**, tabla propia con RLS y no un
  `text[]`: la unicidad la sostiene el índice. Se comparan contra el `waId` por
  los **últimos 10 dígitos** (`lib/bot/numeros-de-prueba.ts`), así que el dueño
  tipea como quiera. El caso que no se salva —el número con 0 y 15— se ataja en
  la pantalla, donde cada número dice si ya escribió alguien que coincida.

  **Un número de prueba no tiene el tope de 12 respuestas por hora** (defiende
  del ping-pong entre automatizaciones, y quien prueba es una persona), pero sí
  el mensual, porque cada respuesta se paga igual.

  **Sin permiso nuevo**: `BOT` ya cubría prender y apagar, y elegir a quién le
  contesta es la misma palanca. `lib/permisos/catalogo.ts` no crece.

  **La migración viaja con la UI en el mismo deploy**: tabla nueva, columna con
  default y backfill desde `activo`, un valor de enum y un enum nuevos, cero
  `DROP`. Mismo argumento que el precio en dólares: el schema nuevo soporta la
  imagen anterior.

  **`design/arandano.pen` no dibuja `/bot` en ningún ancho**. Entrada 38 de
  `docs/correcciones-pendientes-del-pen.md`.

  **Queda pendiente la verificación manual**, después del merge
  (`arandano-dev` sirve `main`): conectar el número sandbox de Kapso, cargar el
  celular propio y pasar a Sólo prueba; escribir desde ese celular y ver que
  contesta y que la fila pasa a "Último mensaje"; escribir desde otro celular y
  ver que no contesta y que "Este mes" suma el cliente; tocar Todos una vez y
  ver que se desarma a los 3 segundos, y dos veces para que cambie; cargar un
  número con 15 y ver que se queda en "Todavía no escribió"; y mirar las dos
  cards a 1440 y a 390 px.
```

- [ ] **Step 5: Correr la suite completa**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo en verde. `test/pantallas.test.ts` sigue pasando porque no hay rutas nuevas.

- [ ] **Step 6: Commit**

```bash
git add docs/pantallas.md docs/correcciones-pendientes-del-pen.md CLAUDE.md docs/superpowers/specs/2026-09-15-bot-modo-prueba-design.md
git commit -m "docs(bot): modo prueba en pantallas, maqueta pendiente y CLAUDE.md"
```
