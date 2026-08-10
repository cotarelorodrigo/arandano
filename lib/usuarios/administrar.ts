import { APIError } from 'better-auth'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { ErrorDeUsuario } from './errores'

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
 * Tira `CLAVE_CORTA`/`CLAVE_LARGA` si `clave` no entra en `config`.
 *
 * Antes esta validación vivía en una constante local (`CLAVE_MINIMA = 8`) que
 * coincidía con `OPCIONES_BASE.emailAndPassword.minPasswordLength` sólo por
 * casualidad — dos números en dos archivos que nada obligaba a mantener
 * iguales. Leer `ctx.password.config` en vez de reinventar el número es lo
 * mismo que ya hace `scripts/definir-clave.mts` para el mismo problema: una
 * sola fuente de verdad, la misma que usa Better Auth para validar `signUp`.
 *
 * Importa más en `resetearClave` que acá: `ctx.password.hash` no valida nada
 * por su cuenta, así que esta llamada es la ÚNICA defensa de ese camino. Si
 * `minPasswordLength` subiera en `OPCIONES_BASE`, una constante local propia
 * se habría quedado atrás en silencio — sin test ni error de tipos que lo
 * delate — y los reseteos seguirían aceptando la clave vieja. Acá se aplica
 * en las dos funciones para que no queden dos caminos con criterios
 * distintos.
 */
function validarLargoDeClave(clave: string, config: { minPasswordLength: number; maxPasswordLength: number }): void {
  if (clave.length < config.minPasswordLength) {
    throw new ErrorDeUsuario(
      'CLAVE_CORTA',
      `la contraseña necesita al menos ${config.minPasswordLength} caracteres`,
    )
  }
  if (clave.length > config.maxPasswordLength) {
    throw new ErrorDeUsuario(
      'CLAVE_LARGA',
      `la contraseña no puede superar los ${config.maxPasswordLength} caracteres`,
    )
  }
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
 *
 * No corre dentro de `enTransaccionDeTenant`: el paso de en medio
 * (`signUpEmail`) hace su propia escritura vía Better Auth, sobre una
 * conexión que este código no controla, así que no hay una única transacción
 * posible que lo cubra entero. Si el proceso muere entre el alta y el
 * `update` del rol, queda un usuario con rol EMPLEADO (el default del schema)
 * donde se pedía un DUENO — un fallo real, pero angosto y fuera del alcance
 * de esta task; queda anotado para la review, no resuelto acá.
 */
export async function crearEmpleado(entrada: EntradaCrearEmpleado): Promise<{ id: string }> {
  const auth = authParaTenant(entrada.tenantId, entrada.origen)
  const ctx = await auth.$context

  validarLargoDeClave(entrada.clave, ctx.password.config)

  const db = prismaParaTenant(entrada.tenantId)

  // Minúsculas SIEMPRE, y no por prolijidad: Better Auth busca por
  // `email.toLowerCase()`, y la columna es un String común con comparación
  // sensible a mayúsculas. Una fila guardada como `Juan@X.com` no la encuentra
  // nunca ni el login ni `usuario:clave`. Es el bug que la Task 6 encontró en
  // el alta de tenants; acá sería el mismo, con empleados.
  const email = entrada.email.trim().toLowerCase()

  // El @@unique([tenantId, email]) es la defensa real; esto sólo traduce a algo
  // legible en vez de dejar salir el error crudo. Queda una ventana entre este
  // chequeo y el signUpEmail de abajo — una carrera la puede saltear — y por
  // eso el catch de abajo también sabe reconocer el mismo duplicado.
  const yaEsta = await db.user.findFirst({ where: { email } })
  if (yaEsta) {
    throw new ErrorDeUsuario('MAIL_REPETIDO', `ya hay alguien con el mail ${email} en este local`)
  }

  let id: string
  try {
    const alta = await auth.api.signUpEmail({
      body: { email, password: entrada.clave, name: entrada.nombre },
    })
    id = alta.user.id
  } catch (e) {
    // El duplicado YA se descartó arriba: si el signUpEmail igual falla, la
    // causa normal NO es un mail repetido (eso sería la carrera del comentario
    // de arriba, que Better Auth reporta con este código puntual) sino
    // cualquier otra cosa — Postgres caído, una policy de RLS que rechaza, una
    // validación de la librería que el chequeo local no anticipó. Traducir
    // TODO a MAIL_REPETIDO le mostraría al dueño "ya hay alguien con ese mail"
    // ante cualquier falla; probaría con otra dirección y chocaría con el
    // mismo veredicto falso. Sólo se traduce el código exacto que usa
    // sign-up.mjs para esto (BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL);
    // cualquier otra cosa se relanza tal cual.
    if (e instanceof APIError && e.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      throw new ErrorDeUsuario('MAIL_REPETIDO', `ya hay alguien con el mail ${email} en este local`)
    }
    throw e
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
  const auth = authParaTenant(entrada.tenantId, entrada.origen)
  const ctx = await auth.$context

  validarLargoDeClave(entrada.clave, ctx.password.config)

  const db = prismaParaTenant(entrada.tenantId)
  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  // `auth.api.setUserPassword` (lo que proponía originalmente este paso) NO
  // existe sin el plugin de admin, que este ciclo no instala — ver
  // scripts/definir-clave.mts, que resolvió este mismo problema. Se reusa acá
  // el mismo camino: `ctx.password.hash` (el único lugar que produce hashes) y
  // `ctx.internalAdapter`, el mismo objeto con el que el propio endpoint
  // /reset-password de Better Auth resuelve "la cuenta puede o no tener ya
  // fila en accounts" — actualiza si existe, crea si no.
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
    // dado de alta por crear-tenant.mts con SQL pelado, antes de correr
    // `usuario:clave` por primera vez).
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
  // Todo en UNA transacción: el chequeo del último dueño, la escritura de
  // `desactivadoEn` y el borrado de sesiones. Sin esto hay dos problemas
  // distintos, uno de concurrencia y uno que no depende de ella — ver los
  // comentarios de abajo en cada punto exacto donde se producían.
  await enTransaccionDeTenant(entrada.tenantId, async (tx) => {
    const usuario = await tx.user.findUnique({ where: { id: entrada.usuarioId } })
    if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

    if (usuario.rol === 'DUENO') {
      // Bajo READ COMMITTED (el nivel por defecto, que enTransaccionDeTenant no
      // cambia), un simple `count()` no alcanza: dos desactivaciones
      // simultáneas de dos dueños DISTINTOS leerían el mismo snapshot —2
      // activos—, las dos pasarían el `<= 1` y el local quedaría sin ninguno,
      // porque cada una actualiza una fila distinta y no hay conflicto de
      // escritura que las frene. Hace falta un lock sobre el conjunto
      // candidato: el FOR UPDATE de abajo bloquea TODAS las filas de dueños
      // activos (no sólo "los otros"), así que la segunda transacción espera a
      // que la primera termine y vuelve a leer sobre el estado ya escrito.
      //
      // Bloquear el conjunto COMPLETO —y no sólo los otros, excluyendo acá con
      // el filter de abajo en vez de en el WHERE— es lo que evita el
      // deadlock: si cada transacción excluyera su propio `usuarioId` del
      // `FOR UPDATE`, una desactivación simultánea de A y otra de B tomarían
      // el lock de la fila DEL OTRO primero (A bloquea B, B bloquea A), y
      // cuando cada una llegara al `update` de más abajo pediría el lock de
      // SU PROPIA fila —que la otra ya tiene tomado— cerrando el ciclo: un
      // deadlock (40P01) que sale como error crudo de Prisma. `ORDER BY id`
      // hace que las dos transacciones pidan los locks en el MISMO orden,
      // así que una espera a la otra en vez de cruzarse. Es el mismo recurso
      // que usa `anularVenta` (lib/ventas/anular.ts) ordenando por
      // `articuloId` antes de tomar sus locks — un orden total sirve si es el
      // MISMO en todo el motor.
      const duenosActivos = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users
         WHERE rol = 'DUENO' AND desactivado_en IS NULL
         ORDER BY id
           FOR UPDATE
      `
      // Contra `usuario.id` —lo que devolvió el findUnique de arriba, ya
      // canonicalizado por Postgres al castear el literal— y NO contra
      // `entrada.usuarioId`: Postgres compara `uuid` normalizando mayúsculas,
      // JS no. Si `desactivar` recibiera un id en mayúsculas (la próxima
      // task arma la pantalla y ese id sale de un formulario, no de
      // Postgres), comparar contra el crudo dejaría a `otrosActivos`
      // conteniéndose a sí mismo —la fila SÍ está en minúsculas en
      // `duenosActivos`— y la guarda pasaría de largo, desactivando al
      // último dueño activo: el estado exacto que esta función existe para
      // impedir.
      const otrosActivos = duenosActivos.filter((d) => d.id !== usuario.id)
      if (otrosActivos.length === 0) {
        throw new ErrorDeUsuario(
          'ULTIMO_DUENO',
          'es el último dueño activo: dejar el local sin dueño sólo se arregla con un comando en el servidor',
        )
      }
    }

    await tx.user.update({ where: { id: entrada.usuarioId }, data: { desactivadoEn: new Date() } })

    // En la MISMA transacción que el update de arriba: si quedaran en pasos
    // separados y el borrado de sesiones fallara después de escribir
    // `desactivadoEn`, alguien quedaría desactivado con sesiones vivas. No es
    // un problema de concurrencia — es la mitad de este hallazgo que un blip
    // cualquiera (una conexión que se cae a mitad de camino) alcanza para
    // producir.
    await tx.session.deleteMany({ where: { userId: entrada.usuarioId } })
  })
}

export async function reactivar(entrada: { tenantId: string; usuarioId: string }): Promise<void> {
  const db = prismaParaTenant(entrada.tenantId)
  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  await db.user.update({ where: { id: entrada.usuarioId }, data: { desactivadoEn: null } })
}
