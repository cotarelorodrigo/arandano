import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { APIError } from 'better-auth'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import dinámico: `lib/auth/para-tenant.ts` arrastra lib/db.ts, que construye
// su Pool al importarse leyendo DATABASE_URL.
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant

const ORIGEN = 'http://flor.arandano.test'
const MAIL = 'compartido@ejemplo.test'
const CLAVE_A = 'clave-del-local-a'
const CLAVE_B = 'clave-del-local-b'

let owner: Client
let tenantA: string
let tenantB: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  const sufijo = Date.now()
  tenantA = await crearTenant(owner, `auth-a-${sufijo}`)
  tenantB = await crearTenant(owner, `auth-b-${sufijo}`)

  // El MISMO mail en los dos locales, con contraseñas distintas. Es todo el
  // punto del ciclo: `users` lleva @@unique([tenantId, email]), no un unique
  // global, así que esto es un estado legítimo del sistema.
  await authParaTenant(tenantA, ORIGEN).api.signUpEmail({
    body: { email: MAIL, password: CLAVE_A, name: 'Juan del local A' },
  })
  await authParaTenant(tenantB, ORIGEN).api.signUpEmail({
    body: { email: MAIL, password: CLAVE_B, name: 'Juan del local B' },
  })
})

afterAll(async () => {
  await owner.end()
})

async function entrar(tenantId: string, password: string) {
  try {
    const r = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: MAIL, password },
      asResponse: true,
    })
    return r.status
  } catch (error) {
    // Con `asResponse: true`, Better Auth devuelve las credenciales inválidas
    // como Response (status 401) en vez de tirarlas — medido contra la
    // versión instalada, ver el reporte de la task. Este catch en la
    // práctica no debería dispararse por una contraseña incorrecta; queda
    // como red ante un cambio de versión de la librería, pero acotada al
    // código puntual de "credenciales inválidas". Cualquier otra excepción
    // (un bug de setup, de red, de conexión) se relanza: un catch genérico
    // convertiría un test roto en un "no entró" indistinguible de un login
    // legítimamente rechazado, y eso es justo lo que el Step 6 necesita NO
    // que pase.
    if (error instanceof APIError && error.body?.code === 'INVALID_EMAIL_OR_PASSWORD') {
      return 401
    }
    throw error
  }
}

describe('aislamiento del login entre tenants', () => {
  it('el mismo mail existe como dos filas distintas, una por tenant', async () => {
    const { rows } = await owner.query(
      'SELECT tenant_id FROM users WHERE email = $1 ORDER BY tenant_id',
      [MAIL],
    )
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((f) => f.tenant_id))).toEqual(new Set([tenantA, tenantB]))
  })

  it('entra en el local A con la clave de A', async () => {
    expect(await entrar(tenantA, CLAVE_A)).toBe(200)
  })

  it('entra en el local B con la clave de B', async () => {
    expect(await entrar(tenantB, CLAVE_B)).toBe(200)
  })

  it('NO entra en el local A con la clave de B', async () => {
    // Éste es el test que justifica la arquitectura. Si la búsqueda por mail
    // dejara de estar acotada al tenant, Better Auth podría encontrar la fila
    // de B desde A y este login pasaría.
    //
    // toBe(401) y no un .not.toBe(200) más débil: con ese negativo, un 429
    // por rate limit o un setup roto satisfarían la aserción igual que un
    // login correctamente rechazado, y el Step 6 (ver más abajo) necesita
    // que esto tenga peso propio para significar algo.
    expect(await entrar(tenantA, CLAVE_B)).toBe(401)
  })

  it('NO entra en el local B con la clave de A', async () => {
    expect(await entrar(tenantB, CLAVE_A)).toBe(401)
  })
})

describe('aislamiento de la sesión', () => {
  it('la sesión creada en A no existe para B', async () => {
    const r = await authParaTenant(tenantA, ORIGEN).api.signInEmail({
      body: { email: MAIL, password: CLAVE_A },
      asResponse: true,
    })
    const cookie = r.headers.get('set-cookie')
    expect(cookie, 'el login no devolvió cookie').toBeTruthy()

    const cabeceras = new Headers({ cookie: cookie!.split(';')[0] })

    const enA = await authParaTenant(tenantA, ORIGEN).api.getSession({ headers: cabeceras })
    expect(enA?.user, 'la sesión no vale en su propio tenant').toBeTruthy()

    // Misma cookie, otro local. La fila de `sessions` existe, pero con el
    // tenant_id de A: la policy no la devuelve cuando el GUC dice B.
    const enB = await authParaTenant(tenantB, ORIGEN).api.getSession({ headers: cabeceras })
    expect(enB, 'la cookie de un local sirvió en otro').toBeFalsy()
  })

  it('las filas de sessions llevan el tenant_id que les puso la extensión', async () => {
    const { rows } = await owner.query(
      'SELECT DISTINCT tenant_id FROM sessions WHERE tenant_id = $1',
      [tenantA],
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})

/**
 * Step 6 de la task: no alcanza con que el resto de este archivo pase — hay
 * que confirmar que las aserciones DETECTAN el aislamiento roto, y no que
 * simplemente "no pasan por otra razón". Mutar el CLIENTE (cambiar
 * `prismaParaTenant(tenantId)` por el `prisma` base en para-tenant.ts, que es
 * lo que probé a mano para el reporte) no sirve para eso: sin la extensión el
 * `create` de `signUpEmail` ya no autocompleta `tenant_id`, así que
 * `beforeAll` explota ANTES de que corra ninguna aserción y los 7 tests
 * quedan `skipped` — lo mismo que hubiera pasado con un archivo lleno de
 * `expect(true).toBe(true)`.
 *
 * Esta prueba muta las POLICIES en vez del cliente: afloja el `USING` de
 * lectura —DESPUÉS de que `beforeAll` ya sembró los dos Juanes—, dejando el
 * `WITH CHECK` de escritura intacto. Es el modo de falla real que este ciclo
 * previene (una policy mal escrita, no un cliente mal armado), y es justo lo
 * que separa a un test con aserciones verificadas de uno que nunca llegó a
 * ejecutarlas.
 *
 * Y afloja LAS DOS, `users` y `accounts`, que es la corrección que trajo la
 * review final. Aflojando sólo `users`, las dos aserciones titulares del
 * archivo —"NO entra en el local A con la clave de B" y su simétrica— no se
 * daban vuelta: el login sigue dando 401, porque Better Auth busca primero el
 * usuario por mail y DESPUÉS su fila de `accounts` por userId, y esa segunda
 * búsqueda seguía acotada al tenant. Lo único observable era que se rompía el
 * login legítimo, que es una señal mucho más débil — y no la que estos tests
 * dicen estar cubriendo. Con las dos flojas, el cruce de credenciales entre
 * locales SÍ pasa (200), que es el modo de falla realista: un cliente sin GUC
 * afecta a todas las tablas a la vez, no a una sola.
 */
describe('el aislamiento roto se detecta (Step 6)', () => {
  const AFLOJAR = 'ALTER POLICY "tenant_aislamiento" ON %s USING (true)'
  const RESTAURAR =
    `ALTER POLICY "tenant_aislamiento" ON %s
       USING (tenant_id = nullif(current_setting('arandano.tenant_id', true), '')::uuid)`

  it('con las policies de lectura de users y accounts aflojadas, se entra en un local con la clave del otro', async () => {
    await owner.query(AFLOJAR.replace('%s', 'users'))
    await owner.query(AFLOJAR.replace('%s', 'accounts'))
    try {
      // Sin el USING acotado por tenant, la búsqueda por mail de Better Auth
      // encuentra CUALQUIER fila con ese email — en la práctica, siempre la
      // de A, que es la que quedó insertada primero (sin ORDER BY, Postgres
      // devuelve la misma fila en ambos sentidos). Y con `accounts` también
      // floja, su credencial aparece: parado en el local B, con la clave del
      // local A, se entra. Ésa es exactamente la aserción titular de más
      // arriba ("NO entra en el local B con la clave de A") dada vuelta, que
      // es lo que este Step tiene que demostrar.
      expect(
        await entrar(tenantB, CLAVE_A),
        'las policies flojas no cambiaron nada: entonces las aserciones de arriba no prueban lo que dicen',
      ).toBe(200)
    } finally {
      // Los ALTER de arriba tocaron sólo USING; WITH CHECK no se mencionó, así
      // que sigue siendo el original y no hace falta restaurarlo. Alcanza
      // con devolverle a USING la expresión de
      // prisma/migrations/20260804205911_inicial/migration.sql (users) y
      // 20260810131312_autenticacion/migration.sql (accounts). El finally
      // corre incluso si algún expect de arriba tira, así que las policies
      // vuelven a quedar cerradas para el resto de la suite pase lo que pase.
      await owner.query(RESTAURAR.replace('%s', 'users'))
      await owner.query(RESTAURAR.replace('%s', 'accounts'))
    }
  })

  it('y con las policies restauradas vuelve a rebotar', async () => {
    // El cierre del finally de arriba no es decorativo: si la restauración no
    // funcionara, el resto de la suite correría sin aislamiento y en verde.
    expect(await entrar(tenantB, CLAVE_A)).toBe(401)
  })
})

describe('definir-clave', () => {
  it('deja una contraseña con la que efectivamente se entra', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')

    const nueva = 'clave-nueva-del-script'
    await definirClave({ tenantId: tenantB, email: MAIL, clave: nueva, origen: ORIGEN })

    // El restore va en `finally`, misma convención que los describes vecinos
    // de arriba ("el aislamiento roto se detecta" y "la sesión de un usuario
    // desactivado"): sin esto, CLAVE_B queda muerta para el resto del
    // archivo, y que nada se rompa depende de qué test corra después — hoy
    // "funciona" sólo porque el describe siguiente no vuelve a usar CLAVE_B.
    try {
      expect(await entrar(tenantB, nueva)).toBe(200)
      // Y la vieja deja de servir: definir una clave la REEMPLAZA.
      expect(await entrar(tenantB, CLAVE_B)).not.toBe(200)
    } finally {
      await definirClave({ tenantId: tenantB, email: MAIL, clave: CLAVE_B, origen: ORIGEN })
    }
  })

  it('falla claro si el usuario no existe en ese tenant', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')
    await expect(
      definirClave({ tenantId: tenantA, email: 'nadie@ejemplo.test', clave: 'x'.repeat(10), origen: ORIGEN }),
    ).rejects.toThrow(/no existe/)
  })

  /**
   * El test de arriba usa un mail que no existe en NINGÚN tenant, así que
   * pasaría igual con un cliente sin atar al tenant (Prisma pelado, sin
   * `prismaParaTenant`). La prueba fuerte del scoping es ésta: un usuario que
   * SÍ existe, pero en el OTRO tenant, tiene que dar el mismo "no existe" —
   * si `ctx.internalAdapter.findUserByEmail` no estuviera acotado por RLS al
   * tenant que arma `authParaTenant`, encontraría la fila de A igual estando
   * parado en B.
   */
  it('no encuentra un usuario que sólo existe en el OTRO tenant', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')

    const mailSoloEnA = 'solo-en-a@ejemplo.test'
    await authParaTenant(tenantA, ORIGEN).api.signUpEmail({
      body: { email: mailSoloEnA, password: 'clave-de-sobra-en-a', name: 'Sólo en A' },
    })

    await expect(
      definirClave({ tenantId: tenantB, email: mailSoloEnA, clave: 'x'.repeat(10), origen: ORIGEN }),
    ).rejects.toThrow(/no existe/)
  })

  /**
   * `crear-tenant.mts` ahora normaliza el mail del dueño a minúsculas antes
   * de insertarlo (ver su `parsearArgumentos`), pero un operador puede
   * tipear `--email=Duenio@Ejemplo.com` acá igual, con otra letra que la que
   * quedó guardada. Better Auth busca SIEMPRE en minúsculas
   * (`findUserByEmail`, `internal-adapter.mjs`), así que la fila —guardada en
   * minúsculas— tiene que encontrarse sin importar con qué mayúsculas la
   * pida quien corre el comando.
   */
  it('encuentra al usuario sin importar las mayúsculas con que se pida el mail', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')

    const mailNormalizado = 'duenio-mayus@ejemplo.test'
    await authParaTenant(tenantA, ORIGEN).api.signUpEmail({
      body: { email: mailNormalizado, password: 'clave-original-de-sobra', name: 'Dueño mayus' },
    })

    const nueva = 'clave-puesta-con-mayusculas'
    await definirClave({
      tenantId: tenantA,
      email: 'Duenio-Mayus@Ejemplo.TEST',
      clave: nueva,
      origen: ORIGEN,
    })

    const r = await authParaTenant(tenantA, ORIGEN).api.signInEmail({
      body: { email: mailNormalizado, password: nueva },
      asResponse: true,
    })
    expect(r.status).toBe(200)
  })

  /**
   * El motivo entero de esta task: `crear-tenant.mts` inserta el dueño con SQL
   * pelado, sin ninguna fila en `accounts`. Los dos tests de arriba corren
   * sobre MAIL, que se dio de alta con `signUpEmail` en `beforeAll` y por lo
   * tanto YA tiene una credencial — no ejercitan el camino real que motiva
   * esta task. Este test recrea esa fila "cruda" a mano (mismo INSERT que usa
   * el script) y confirma que `definirClave` también funciona cuando no hay
   * ninguna fila de `accounts` de la que partir.
   */
  it('define la PRIMERA contraseña de un usuario dado de alta sin credenciales', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')

    const mailDuenio = 'duenio-sin-clave@ejemplo.test'
    await owner.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Dueño sin clave', $2, 'DUENO', now(), now())`,
      [tenantA, mailDuenio],
    )

    const primera = 'clave-inicial-del-duenio'
    await definirClave({ tenantId: tenantA, email: mailDuenio, clave: primera, origen: ORIGEN })

    const auth = authParaTenant(tenantA, ORIGEN)
    const r = await auth.api.signInEmail({
      body: { email: mailDuenio, password: primera },
      asResponse: true,
    })
    expect(r.status).toBe(200)
  })

  /**
   * `ctx.password.hash` no valida longitud por su cuenta —eso lo hacen los
   * endpoints de Better Auth ANTES de llamarlo (ver password.mjs)—, y
   * `definirClave` lo llama directo. Sin este chequeo propio, el script
   * dejaría pasar una clave más corta que `minPasswordLength` (8, ver
   * OPCIONES_BASE) que después funcionaría para entrar igual: una política
   * que el resto del sistema exige y este único camino se saltearía.
   *
   * Usa un usuario PROPIO (no MAIL/tenantB) para no depender de qué clave
   * dejó el test de arriba, que la reemplaza y no la restaura.
   */
  it('rechaza una clave más corta que la política mínima', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')

    const mail = 'clave-corta@ejemplo.test'
    const claveOriginal = 'clave-larga-de-sobra'
    await authParaTenant(tenantA, ORIGEN).api.signUpEmail({
      body: { email: mail, password: claveOriginal, name: 'Clave corta' },
    })

    await expect(
      definirClave({ tenantId: tenantA, email: mail, clave: 'corta', origen: ORIGEN }),
    ).rejects.toThrow(/al menos/)

    // Y no queda a mitad de camino: la clave original se mantiene sirviendo.
    const r = await authParaTenant(tenantA, ORIGEN).api.signInEmail({
      body: { email: mail, password: claveOriginal },
      asResponse: true,
    })
    expect(r.status).toBe(200)
  })
})

describe('la sesión de un usuario desactivado', () => {
  it('deja de valer en el request siguiente', async () => {
    const auth = authParaTenant(tenantA, ORIGEN)

    const r = await auth.api.signInEmail({
      body: { email: MAIL, password: CLAVE_A },
      asResponse: true,
    })
    const cookie = r.headers.get('set-cookie')!.split(';')[0]
    const cabeceras = new Headers({ cookie })

    // Con la sesión viva, Better Auth la devuelve.
    const antes = await auth.api.getSession({ headers: cabeceras })
    expect(antes?.user).toBeTruthy()

    await owner.query(
      'UPDATE users SET desactivado_en = now() WHERE tenant_id = $1 AND email = $2',
      [tenantA, MAIL],
    )

    // El restore va en `finally`, igual que el `describe` vecino de arriba
    // ("el aislamiento roto se detecta"): si algún expect de abajo tira, el
    // usuario no puede quedar desactivado. Sin esto, el riesgo es chico
    // mientras este describe sea el último del archivo, pero deja de serlo
    // en cuanto la próxima task agregue tests debajo -mejor que el hábito
    // esté puesto desde ahora.
    try {
      // Better Auth NO sabe nada de desactivación: la sesión le sigue
      // pareciendo válida. Ésa es exactamente la razón por la que el guard
      // existe, y por la que el chequeo va en cada request y no sólo al
      // entrar: si se hiciera sólo al entrar, echar a un empleado no tendría
      // efecto hasta que se le venciera la sesión.
      const despues = await auth.api.getSession({ headers: cabeceras })
      expect(despues?.user, 'Better Auth ya no devuelve la sesión: el test no prueba nada')
        .toBeTruthy()
      expect((despues!.user as { desactivadoEn?: unknown }).desactivadoEn).toBeTruthy()
    } finally {
      await owner.query(
        'UPDATE users SET desactivado_en = NULL WHERE tenant_id = $1 AND email = $2',
        [tenantA, MAIL],
      )
    }
  })
})
