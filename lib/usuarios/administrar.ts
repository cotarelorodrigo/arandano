import { authParaTenant } from '@/lib/auth/para-tenant'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { ErrorDeUsuario } from './errores'

const CLAVE_MINIMA = 8

type RolUsuario = 'DUENO' | 'EMPLEADO'

export type EntradaCrearEmpleado = {
  tenantId: string
  origen: string
  nombre: string
  email: string
  clave: string
  rol: RolUsuario
}

/**
 * Alta de una persona con su credencial.
 *
 * Pasa por signUpEmail y no por un insert propio porque el hash tiene que
 * salir de Better Auth: es la única forma de que el algoritmo viva en un solo
 * lugar. El precio es que devuelve una sesión, que se descarta — el dueño no
 * puede terminar navegando como el empleado que acaba de crear.
 *
 * El `rol` se escribe DESPUÉS y no en el alta: está declarado con `input:false`
 * justamente para que no se pueda mandar desde afuera.
 */
export async function crearEmpleado(entrada: EntradaCrearEmpleado): Promise<{ id: string }> {
  if (entrada.clave.length < CLAVE_MINIMA) {
    throw new ErrorDeUsuario('CLAVE_CORTA', `la contraseña necesita al menos ${CLAVE_MINIMA} caracteres`)
  }

  const db = prismaParaTenant(entrada.tenantId)

  // Minúsculas SIEMPRE, y no por prolijidad: Better Auth busca por
  // `email.toLowerCase()`, y la columna es un String común con comparación
  // sensible a mayúsculas. Una fila guardada como `Juan@X.com` no la encuentra
  // nunca ni el login ni `usuario:clave`. Es el bug que la Task 6 encontró en
  // el alta de tenants; acá sería el mismo, con empleados.
  const email = entrada.email.trim().toLowerCase()

  // El @@unique([tenantId, email]) es la defensa real; esto sólo traduce a algo
  // legible en vez de dejar salir el error crudo.
  const yaEsta = await db.user.findFirst({ where: { email } })
  if (yaEsta) {
    throw new ErrorDeUsuario('MAIL_REPETIDO', `ya hay alguien con el mail ${email} en este local`)
  }

  const auth = authParaTenant(entrada.tenantId, entrada.origen)

  let id: string
  try {
    const alta = await auth.api.signUpEmail({
      body: { email, password: entrada.clave, name: entrada.nombre },
    })
    id = alta.user.id
  } catch (e) {
    throw new ErrorDeUsuario('MAIL_REPETIDO', e instanceof Error ? e.message : 'no se pudo dar de alta')
  }

  // La sesión que devolvió el alta se descarta: no es de quien está operando.
  await db.session.deleteMany({ where: { userId: id } })

  await db.user.update({ where: { id }, data: { rol: entrada.rol } })

  return { id }
}

export async function resetearClave(entrada: {
  tenantId: string
  origen: string
  usuarioId: string
  clave: string
}): Promise<void> {
  if (entrada.clave.length < CLAVE_MINIMA) {
    throw new ErrorDeUsuario('CLAVE_CORTA', `la contraseña necesita al menos ${CLAVE_MINIMA} caracteres`)
  }

  const db = prismaParaTenant(entrada.tenantId)
  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  // `auth.api.setUserPassword` (lo que proponía originalmente este paso) NO
  // existe sin el plugin de admin, que este ciclo no instala — ver
  // scripts/definir-clave.mts, que resolvió este mismo problema. Se reusa acá
  // el mismo camino: `auth.$context` da `ctx.password.hash` (el único lugar
  // que produce hashes) y `ctx.internalAdapter`, el mismo objeto con el que el
  // propio endpoint /reset-password de Better Auth resuelve "la cuenta puede o
  // no tener ya fila en accounts" — actualiza si existe, crea si no.
  const auth = authParaTenant(entrada.tenantId, entrada.origen)
  const ctx = await auth.$context
  const hash = await ctx.password.hash(entrada.clave)

  const cuentas = await ctx.internalAdapter.findAccounts(entrada.usuarioId)
  const yaTieneCredencial = cuentas.some((cuenta) => cuenta.providerId === 'credential')
  if (yaTieneCredencial) {
    // updatePassword hace un UPDATE: sobre una fila que no existe no haría
    // nada, y la clave quedaría "reseteada" en apariencia pero sin efecto. Por
    // eso el create de abajo es la otra rama y no un upsert genérico.
    await ctx.internalAdapter.updatePassword(entrada.usuarioId, hash)
  } else {
    // Caso de un usuario que nunca tuvo credencial propia (p. ej. el dueño
    // dado de alta por crear-tenant.mts con SQL pelado, antes de que exista
    // definir-clave.mts para ese tenant).
    await ctx.internalAdapter.createAccount({
      userId: entrada.usuarioId,
      providerId: 'credential',
      accountId: entrada.usuarioId,
      password: hash,
    })
  }

  // Sin esto, resetearle la clave a alguien que se fue no lo saca de ningún lado.
  await db.session.deleteMany({ where: { userId: entrada.usuarioId } })
}

export async function desactivar(entrada: { tenantId: string; usuarioId: string }): Promise<void> {
  const db = prismaParaTenant(entrada.tenantId)

  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  if (usuario.rol === 'DUENO') {
    const duenosActivos = await db.user.count({ where: { rol: 'DUENO', desactivadoEn: null } })
    if (duenosActivos <= 1) {
      throw new ErrorDeUsuario(
        'ULTIMO_DUENO',
        'es el último dueño activo: dejar el local sin dueño sólo se arregla con un comando en el servidor',
      )
    }
  }

  await db.user.update({ where: { id: entrada.usuarioId }, data: { desactivadoEn: new Date() } })

  // El guard ya lo rechazaría en el request siguiente; borrar las filas hace que
  // no quede una sesión válida esperando a que alguien se olvide del guard.
  await db.session.deleteMany({ where: { userId: entrada.usuarioId } })
}

export async function reactivar(entrada: { tenantId: string; usuarioId: string }): Promise<void> {
  const db = prismaParaTenant(entrada.tenantId)
  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  await db.user.update({ where: { id: entrada.usuarioId }, data: { desactivadoEn: null } })
}
