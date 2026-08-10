/**
 * Define o resetea la contraseña de un usuario.
 *
 * Existe porque `crear-tenant.mts` no puede hacerlo: corre como arandano_owner
 * con `pg` pelado y no tiene de dónde sacar el hash en el formato correcto.
 * Calcularlo por su cuenta duplicaría la decisión de qué algoritmo se usa, que
 * es justo lo que este ciclo mantiene en un solo lugar.
 *
 * Es además el recupero del dueño, que no tiene a nadie arriba que le resetee
 * la clave mientras no haya proveedor de mail. No queda como un rincón sin
 * probar: es el camino que se ejercita en CADA alta de tenant.
 *
 * Corre como la aplicación (DATABASE_URL, o sea arandano_app), no como owner:
 * todo pasa por la API de Better Auth y por lo tanto por RLS.
 *
 * `auth.api.listUsers` / `auth.api.setUserPassword` (lo que proponía el brief
 * original) NO existen en la versión instalada (better-auth 1.6.26) salvo que
 * se sume el plugin de admin — son endpoints de
 * `node_modules/better-auth/dist/plugins/admin/admin.d.mts`, y OPCIONES_BASE
 * no lo activa a propósito (agregaría tablas y roles propios que este ciclo
 * decidió no sumar, la misma razón por la que tampoco se usa el plugin de
 * organizaciones). La alternativa de acá usa `auth.$context` para llegar al
 * hasher (`ctx.password.hash`) y al `internalAdapter` que ya trae Better Auth
 * — el mismo objeto que arma su propio endpoint `/reset-password`
 * (`api/routes/password.mjs`) para este problema exacto: una cuenta que puede
 * o no tener ya una fila de credenciales. Se copia ESE patrón (crear la fila
 * si no existe, actualizarla si existe) en vez de improvisar uno nuevo.
 *
 * Es también por qué la búsqueda del usuario no usa
 * `prismaParaTenant(tenantId).user.findFirst`, la alternativa que daba el
 * brief: `ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true
 * })` devuelve el usuario Y sus cuentas en una sola consulta, ya acotada al
 * tenant porque corre sobre el mismo adapter tenant-scoped que le pasa
 * `authParaTenant` a Better Auth — no hace falta un segundo camino (Prisma
 * pelado) al lado del que ya usa toda esta librería.
 */
import { randomBytes } from 'node:crypto'
import { authParaTenant } from '../lib/auth/para-tenant.ts'
import { pool } from '../lib/db.ts'

export type ArgsClave = {
  tenantId: string
  email: string
  clave: string
  origen: string
}

/** Una clave legible pero no adivinable, para cuando no se pasa `--clave`. */
export function generarClave(): string {
  return randomBytes(12).toString('base64url')
}

export async function definirClave(args: ArgsClave): Promise<void> {
  const auth = authParaTenant(args.tenantId, args.origen)
  const ctx = await auth.$context

  // Better Auth normaliza el mail a minúsculas TANTO al guardar como al
  // buscar (internal-adapter.mjs: createUser y findUserByEmail hacen las dos
  // el mismo email.toLowerCase()), así que findUserByEmail ya lo hace por su
  // cuenta con lo que le llegue acá — este toLowerCase() no cambia a qué fila
  // llega la búsqueda hoy. Se deja explícito igual: la corrección real está
  // en que la fila QUEDE guardada en minúsculas (crear-tenant.mts, el único
  // punto de todo el sistema que escribe `users.email` sin pasar por Better
  // Auth), y este toLowerCase() documenta esa dependencia en vez de dejarla
  // implícita adentro de una librería que no es nuestra.
  const email = args.email.toLowerCase()

  const encontrado = await ctx.internalAdapter.findUserByEmail(email, {
    includeAccounts: true,
  })
  if (!encontrado) {
    throw new Error(`no existe un usuario con el mail ${email} en ese tenant`)
  }

  // ctx.password.hash no valida longitud por su cuenta —eso lo hacen los
  // endpoints (signUpEmail, /reset-password) antes de llamarlo—, y acá se
  // llama directo, así que el chequeo se repite a mano. Sin esto, el script
  // podría dejar una clave más corta que minPasswordLength, una que
  // funcionaría para entrar pero violaría la política que el resto del
  // sistema sí hace cumplir.
  const { minPasswordLength, maxPasswordLength } = ctx.password.config
  if (args.clave.length < minPasswordLength) {
    throw new Error(`la clave necesita al menos ${minPasswordLength} caracteres`)
  }
  if (args.clave.length > maxPasswordLength) {
    throw new Error(`la clave no puede superar los ${maxPasswordLength} caracteres`)
  }

  // El hash lo produce Better Auth, nunca código nuestro: es la regla que este
  // ciclo no negocia, para que el algoritmo quede decidido en un solo lugar.
  const hash = await ctx.password.hash(args.clave)

  const yaTieneCredencial = encontrado.accounts.some((cuenta) => cuenta.providerId === 'credential')
  if (yaTieneCredencial) {
    // updatePassword hace un UPDATE (ver internal-adapter.mjs): sobre una
    // fila que no existe no haría nada, y la clave quedaría "definida" en
    // apariencia pero sin efecto. Por eso el create de abajo es la otra rama
    // y no un upsert genérico.
    await ctx.internalAdapter.updatePassword(encontrado.user.id, hash)
  } else {
    // El caso que motiva esta task: el dueño que `crear-tenant.mts` dio de
    // alta con SQL pelado no tiene ninguna fila en `accounts` todavía.
    await ctx.internalAdapter.createAccount({
      userId: encontrado.user.id,
      providerId: 'credential',
      accountId: encontrado.user.id,
      password: hash,
    })
  }
}

export type ArgsCLI = {
  subdominio: string
  email: string
  clave?: string
}

export type ResultadoArgsCLI = { ok: true; args: ArgsCLI } | { ok: false; motivo: string }

const CONOCIDOS_CLI = new Set(['--subdominio', '--email', '--clave'])

/**
 * Separado de `ejecutar` por la misma razón que `crear-tenant.mts` separa
 * `parsearArgumentos` de `crear`: es puro, no toca la red, y el test puede
 * ejercitarlo sin Postgres.
 *
 * Un flag desconocido es un ERROR y no algo que se ignora en silencio — acá
 * el riesgo es peor que en el alta de tenant: un `--clve=` mal tipeado (en
 * vez de `--clave=`) haría que el script generara una clave al azar SIN
 * avisar, y el operador se iría creyendo que la clave que tipeó es la que
 * quedó puesta. Para un comando cuyo trabajo entero es fijar una contraseña,
 * ese es exactamente el peor momento para fallar callado.
 */
export function parsearArgumentosCLI(argv: string[]): ResultadoArgsCLI {
  const crudos = new Map<string, string>()

  for (const arg of argv) {
    const i = arg.indexOf('=')
    const clave = i === -1 ? arg : arg.slice(0, i)
    if (!CONOCIDOS_CLI.has(clave)) {
      return { ok: false, motivo: `argumento desconocido: ${clave}` }
    }
    if (i === -1) return { ok: false, motivo: `${clave} necesita un valor: ${clave}=algo` }
    crudos.set(clave, arg.slice(i + 1))
  }

  const subdominio = crudos.get('--subdominio')
  const email = crudos.get('--email')
  if (!subdominio || !email) {
    return { ok: false, motivo: 'faltan --subdominio y/o --email' }
  }

  return { ok: true, args: { subdominio, email, clave: crudos.get('--clave') } }
}

async function ejecutar(args: ArgsCLI): Promise<void> {
  const { rows } = await pool.query('SELECT id, nombre FROM resolver_tenant($1)', [args.subdominio])
  if (!rows[0]) {
    throw new Error(`no existe el tenant "${args.subdominio}"`)
  }

  const clave = args.clave ?? generarClave()
  const dominio = process.env.DOMINIO_BASE ?? 'arandano.app'
  // El origen acá sólo alimenta el `baseURL` de Better Auth y la clave del
  // caché de `authParaTenant` — no hay navegador de por medio en un script de
  // línea de comandos. Se arma con la misma forma que usa `origenDelRequest`
  // (lib/auth/origen.ts) para que un lector futuro no se confunda pensando
  // que es un origen distinto; esa función es de servidor (usa
  // `next/headers`) y por eso no se puede llamar directo desde acá.
  const puerto = process.env.PUERTO_PUBLICO
  const origen = `https://${args.subdominio}.${dominio}${puerto ? `:${puerto}` : ''}`

  await definirClave({
    tenantId: rows[0].id,
    email: args.email,
    clave,
    origen,
  })

  console.log(`contraseña definida para ${args.email} en ${rows[0].nombre}`)
  // Se imprime una sola vez y no se guarda en ningún lado: es el único momento
  // en que existe en texto plano.
  console.log(`  clave: ${clave}`)
  console.log(`  url:   https://${args.subdominio}.${dominio}/login`)
  await pool.end()
}

// Sólo corre cuando se lo invoca como programa, para que el test pueda
// importar definirClave (y parsearArgumentosCLI) sin ejecutar nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const resultado = parsearArgumentosCLI(process.argv.slice(2))
  if (!resultado.ok) {
    console.error(`error: ${resultado.motivo}`)
    console.error('\nuso: npm run usuario:clave -- --subdominio=flor --email=flor@ejemplo.com [--clave=…]')
    process.exit(2)
  }

  // Mismo patrón que crear-tenant.mts: sin este .catch(), un error de
  // definirClave (tenant inexistente, usuario inexistente, clave corta) le
  // llega al operador como un stack trace de unhandled rejection en vez del
  // mensaje en castellano que el error ya trae, y pool.end() nunca corre.
  await ejecutar(resultado.args).catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
