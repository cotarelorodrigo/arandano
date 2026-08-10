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

  const encontrado = await ctx.internalAdapter.findUserByEmail(args.email, {
    includeAccounts: true,
  })
  if (!encontrado) {
    throw new Error(`no existe un usuario con el mail ${args.email} en ese tenant`)
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

// Sólo corre cuando se lo invoca como programa, para que el test pueda importar
// definirClave sin ejecutar nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const crudos = new Map<string, string>()
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf('=')
    if (i === -1) { console.error(`error: ${arg} necesita un valor`); process.exit(2) }
    crudos.set(arg.slice(0, i), arg.slice(i + 1))
  }

  const subdominio = crudos.get('--subdominio')
  const email = crudos.get('--email')
  if (!subdominio || !email) {
    console.error('uso: npm run usuario:clave -- --subdominio=flor --email=flor@ejemplo.com [--clave=…]')
    process.exit(2)
  }

  const { rows } = await pool.query('SELECT id, nombre FROM resolver_tenant($1)', [subdominio])
  if (!rows[0]) { console.error(`error: no existe el tenant "${subdominio}"`); process.exit(1) }

  const clave = crudos.get('--clave') ?? generarClave()
  const dominio = process.env.DOMINIO_BASE ?? 'arandano.app'
  // El origen acá sólo alimenta el `baseURL` de Better Auth y la clave del
  // caché de `authParaTenant` — no hay navegador de por medio en un script de
  // línea de comandos. Se arma con la misma forma que usa `origenDelRequest`
  // (lib/auth/origen.ts) para que un lector futuro no se confunda pensando
  // que es un origen distinto; esa función es de servidor (usa
  // `next/headers`) y por eso no se puede llamar directo desde acá.
  const puerto = process.env.PUERTO_PUBLICO
  const origen = `https://${subdominio}.${dominio}${puerto ? `:${puerto}` : ''}`

  await definirClave({
    tenantId: rows[0].id,
    email,
    clave,
    origen,
  })

  console.log(`contraseña definida para ${email} en ${rows[0].nombre}`)
  // Se imprime una sola vez y no se guarda en ningún lado: es el único momento
  // en que existe en texto plano.
  console.log(`  clave: ${clave}`)
  console.log(`  url:   https://${subdominio}.${dominio}/login`)
  await pool.end()
}
