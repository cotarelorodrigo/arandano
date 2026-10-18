import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { excedeEscala, ESCALA_DINERO } from '@/lib/ventas/totales'
import {
  BATERIA_MAXIMA,
  BATERIA_MINIMA,
  RANGOS_SUGERIDOS,
  rotuloDeRango,
  seSolapan,
  type MonedaDeCanje,
  type Rango,
} from './calculo'
import { ErrorDeCanje } from './errores'

/**
 * Lo que escribe la tabla del plan canje. Sólo la pantalla de valores llega
 * acá, y cada action que la llama exige `CANJE_VALORES` antes; la calculadora
 * no escribe nada.
 *
 * **Las tablas de canje no están en `MODELOS_CON_TENANT`** (lib/tenant/prisma.ts),
 * igual que `PlanDePago`: todo `create` pasa `tenantId` explícito, y adentro de
 * `enTransaccionDeTenant` no hay extensión que lo complete de todos modos. El
 * compilador lo exige —el campo es obligatorio— y detrás está el WITH CHECK de
 * la policy.
 */

/** Lo que entra en `Decimal(12, 2)`: diez dígitos enteros. Más que eso no es
 *  el valor de un usado, es un typo — y Postgres lo rechazaría como 500. */
const VALOR_MAXIMO = new Prisma.Decimal('9999999999.99')

/** Holgura para "iPhone 15 Pro Max 256 GB Titanio Natural" y más; el tope
 *  existe para que una tabla que se lee de un vistazo no reciba un párrafo. */
const NOMBRE_MAXIMO = 80

function validarRango(r: Rango): void {
  const enteros = Number.isInteger(r.minimo) && Number.isInteger(r.maximo)
  if (!enteros || r.minimo < BATERIA_MINIMA || r.maximo > BATERIA_MAXIMA || r.minimo > r.maximo) {
    throw new ErrorDeCanje(
      'RANGO_INVALIDO',
      'Un rango va de un porcentaje entero a otro, entre 0 y 100, con el de abajo primero.',
    )
  }
}

/**
 * Serializa las escrituras de rangos de UN tenant.
 *
 * Sin esto, dos altas simultáneas que se solapan entre sí pasan las dos: cada
 * transacción mira la tabla, no ve a la otra, y escribe. Un `FOR UPDATE` sobre
 * los rangos existentes no alcanza —con la tabla vacía no hay fila que
 * bloquear, y es justo el caso de dos personas cargando el primer rango—, así
 * que el lock es de aplicación: `pg_advisory_xact_lock`, que se suelta solo al
 * terminar la transacción y no deja nada colgado si revienta.
 *
 * La clave sale del tenant, así que dos locales distintos nunca se esperan
 * entre sí. `hashtextextended` da 64 bits; una colisión entre dos tenants sólo
 * haría que uno espere al otro unos milisegundos, nunca que vea sus datos.
 */
async function bloquearRangos(tx: ClienteTx, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'plan-canje:rangos:' + tenantId}, 0))`
}

/** El primer rango de la lista que se pisa con `r`, para nombrarlo en el
 *  mensaje: "se pisa con otro" no dice cuál hay que mirar. */
function chequearSolapamiento(r: Rango, otros: Rango[]): void {
  const choque = otros.find((o) => seSolapan(r, o))
  if (choque) {
    throw new ErrorDeCanje(
      'RANGO_SOLAPADO',
      `${rotuloDeRango(r)} se pisa con el rango ${rotuloDeRango(choque)}. Un porcentaje no puede tener dos precios.`,
    )
  }
}

export async function crearRango(e: { tenantId: string; minimo: number; maximo: number }): Promise<{ id: string }> {
  validarRango(e)
  return enTransaccionDeTenant(e.tenantId, async (tx) => {
    await bloquearRangos(tx, e.tenantId)
    const existentes = await tx.rangoDeBateria.findMany({ select: { minimo: true, maximo: true } })
    chequearSolapamiento(e, existentes)
    return tx.rangoDeBateria.create({
      data: { tenantId: e.tenantId, minimo: e.minimo, maximo: e.maximo },
      select: { id: true },
    })
  })
}

/**
 * Corregir los bordes de un rango. Los valores cargados en él se quedan: el
 * dueño que corre el 90–99 a 88–99 está diciendo que esos precios valen
 * también para 88 y 89, no que los quiere perder.
 */
export async function editarRango(e: {
  tenantId: string
  id: string
  minimo: number
  maximo: number
}): Promise<void> {
  validarRango(e)
  await enTransaccionDeTenant(e.tenantId, async (tx) => {
    await bloquearRangos(tx, e.tenantId)
    const existentes = await tx.rangoDeBateria.findMany({ select: { id: true, minimo: true, maximo: true } })
    // Bajo RLS, uno de otro tenant tampoco aparece: son el mismo caso para el
    // llamador, y el mismo mensaje.
    if (!existentes.some((r) => r.id === e.id)) {
      throw new ErrorDeCanje('RANGO_INEXISTENTE', 'Ese rango ya no está en la tabla. Recargá la pantalla.')
    }
    chequearSolapamiento(e, existentes.filter((r) => r.id !== e.id))
    await tx.rangoDeBateria.update({ where: { id: e.id }, data: { minimo: e.minimo, maximo: e.maximo } })
  })
}

/**
 * Borra el rango y, por el cascade, todos sus valores.
 *
 * Idempotente, como `desactivarPlan`: dos clicks mandan la orden dos veces, y
 * un id que no existe —o que es de otro tenant, que bajo RLS es lo mismo— no
 * se queja. No hay nada que distinguir: en los dos casos el rango no está.
 */
export async function borrarRango({ tenantId, id }: { tenantId: string; id: string }): Promise<void> {
  await prismaParaTenant(tenantId).rangoDeBateria.deleteMany({ where: { id } })
}

/**
 * Los cinco rangos del pedido, de un saque, sobre una tabla de rangos VACÍA.
 *
 * Con algún rango ya cargado se niega en vez de agregar "los que entren": el
 * botón promete empezar con los sugeridos, y una mezcla de los del dueño con
 * algunos de los sugeridos no es eso. Bajo el mismo lock que el alta, así que
 * dos clicks seguidos no los cargan dos veces.
 */
export async function cargarRangosSugeridos({ tenantId }: { tenantId: string }): Promise<void> {
  await enTransaccionDeTenant(tenantId, async (tx) => {
    await bloquearRangos(tx, tenantId)
    if ((await tx.rangoDeBateria.count()) > 0) {
      throw new ErrorDeCanje(
        'RANGOS_YA_CARGADOS',
        'La tabla ya tiene rangos. Los sugeridos son para empezar: editá los que hay.',
      )
    }
    await tx.rangoDeBateria.createMany({
      data: RANGOS_SUGERIDOS.map((r) => ({ tenantId, minimo: r.minimo, maximo: r.maximo })),
    })
  })
}

function validarNombre(nombre: string): string {
  const limpio = nombre.trim()
  if (limpio === '') throw new ErrorDeCanje('NOMBRE_VACIO', 'El modelo necesita un nombre, como "iPhone 14".')
  if (limpio.length > NOMBRE_MAXIMO) {
    throw new ErrorDeCanje('NOMBRE_LARGO', `El nombre del modelo tiene a lo sumo ${NOMBRE_MAXIMO} caracteres.`)
  }
  return limpio
}

function validarValor(valor: Prisma.Decimal): void {
  if (valor.isNegative() || valor.greaterThan(VALOR_MAXIMO) || excedeEscala(valor, ESCALA_DINERO)) {
    throw new ErrorDeCanje(
      'VALOR_INVALIDO',
      `"${valor.toString()}" no sirve como valor: va en cero o más, con dos decimales a lo sumo.`,
    )
  }
}

function repetido(nombre: string): ErrorDeCanje {
  return new ErrorDeCanje('NOMBRE_REPETIDO', `Ya hay un modelo que se llama "${nombre}".`)
}

/** P2002 = violación de unicidad. En esta transacción las únicas que hay son
 *  el nombre sin mayúsculas y (modelo, rango); la segunda no puede saltar,
 *  porque cada celda se escribe con upsert. Mismo criterio que `esRepetido` en
 *  lib/planes/administrar.ts: bajo `arandano_app` el detalle de qué
 *  constraint fue no está disponible. */
function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

export type CeldaDeCanje = { rangoId: string; valor: Prisma.Decimal | null }

/**
 * Guarda una fila ENTERA de la tabla —el nombre del modelo y todas sus celdas—
 * en una sola transacción. `id: null` la crea.
 *
 * Entera y no celda por celda porque así se piensa: cuando sube el precio del
 * iPhone 14, el dueño actualiza los cinco valores de la fila de un gesto, y una
 * fila guardada a medias (tres celdas nuevas, dos viejas) sería un precio que
 * nadie decidió. Una celda inválida rechaza la fila completa.
 *
 * `valor: null` es la celda vacía: "no se toma ese equipo en ese rango", y
 * borra la fila de `valores_de_canje` si existía. Un cero, en cambio, se guarda.
 * Los rangos que la fila no menciona no se tocan.
 *
 * **El modelo y los rangos se buscan bajo RLS antes de escribir**, y no es
 * redundante con la policy: la policy impide escribir una fila con el
 * `tenant_id` de otro, pero el chequeo de una FK NO pasa por RLS. Sin esto, un
 * id de modelo o de rango de OTRO local —que nadie tipea, pero que una action
 * recibe como texto— dejaría una celda de este tenant colgada de una fila
 * ajena.
 *
 * El nombre repetido se chequea antes, sin distinguir mayúsculas, para poder
 * decir con cuál choca; el índice único de expresión de la migración es el que
 * gana la carrera entre dos altas simultáneas, y su P2002 vuelve con el mismo
 * mensaje.
 */
export async function guardarModelo(e: {
  tenantId: string
  id: string | null
  nombre: string
  valores: CeldaDeCanje[]
}): Promise<{ id: string }> {
  const nombre = validarNombre(e.nombre)
  for (const c of e.valores) if (c.valor) validarValor(c.valor)

  try {
    return await enTransaccionDeTenant(e.tenantId, async (tx) => {
      if (e.id !== null) {
        const existe = await tx.modeloDeCanje.findFirst({ where: { id: e.id }, select: { id: true } })
        if (!existe) {
          throw new ErrorDeCanje('MODELO_INEXISTENTE', 'Ese modelo ya no está en la tabla. Recargá la pantalla.')
        }
      }

      // La comparación se hace en JavaScript y no con `mode: 'insensitive'`:
      // no está garantizado que Prisma no la compile a `ILIKE`, donde `_` y
      // `%` son comodines — "iPhone_14" chocaría con "iPhoneX14" (hallazgo de
      // la review del ciclo). Un local tiene decenas de modelos, no miles, y
      // `toLowerCase` es la misma regla que el índice `lower(nombre)` de la
      // base, que sigue siendo la garantía final.
      const clave = nombre.toLowerCase()
      const choque = (
        await tx.modeloDeCanje.findMany({
          where: e.id !== null ? { id: { not: e.id } } : {},
          select: { nombre: true },
        })
      ).find((m) => m.nombre.toLowerCase() === clave)
      if (choque) throw repetido(choque.nombre)

      const rangosDelLocal = new Set(
        (await tx.rangoDeBateria.findMany({ select: { id: true } })).map((r) => r.id),
      )
      for (const c of e.valores) {
        if (!rangosDelLocal.has(c.rangoId)) {
          throw new ErrorDeCanje(
            'RANGO_INEXISTENTE',
            'Uno de los rangos cambió mientras editabas la fila. Recargá la pantalla y volvé a cargarla.',
          )
        }
      }

      const { id } =
        e.id === null
          ? await tx.modeloDeCanje.create({ data: { tenantId: e.tenantId, nombre }, select: { id: true } })
          : await tx.modeloDeCanje.update({ where: { id: e.id }, data: { nombre }, select: { id: true } })

      for (const c of e.valores) {
        if (c.valor === null) {
          await tx.valorDeCanje.deleteMany({ where: { modeloId: id, rangoId: c.rangoId } })
        } else {
          await tx.valorDeCanje.upsert({
            where: { modeloId_rangoId: { modeloId: id, rangoId: c.rangoId } },
            create: { tenantId: e.tenantId, modeloId: id, rangoId: c.rangoId, valor: c.valor },
            update: { valor: c.valor },
          })
        }
      }
      return { id }
    })
  } catch (err) {
    if (esP2002(err)) throw repetido(nombre)
    // P2003: el rango se borró en otra pestaña entre la lectura de
    // `rangosDelLocal` y el upsert de la celda (la FK lo frena). Es el mismo
    // hecho que el chequeo de arriba, sólo que llegó tarde: mismo mensaje, y
    // no un 500 (hallazgo de la review del ciclo).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new ErrorDeCanje(
        'RANGO_INEXISTENTE',
        'Uno de los rangos cambió mientras editabas la fila. Recargá la pantalla y volvé a cargarla.',
      )
    }
    throw err
  }
}

/** Borra el modelo y, por el cascade, su fila de valores. Idempotente por lo
 *  mismo que `borrarRango`. */
export async function borrarModelo({ tenantId, id }: { tenantId: string; id: string }): Promise<void> {
  await prismaParaTenant(tenantId).modeloDeCanje.deleteMany({ where: { id } })
}

/**
 * La moneda de toda la tabla. **No convierte los valores**: no hay una
 * cotización guardada de la cual hacerlo, y un "400" que pasa de dólares a
 * pesos sigue diciendo 400. La pantalla lo avisa antes de confirmar; acá sólo
 * se escribe lo que la persona decidió.
 */
export async function cambiarMonedaDeCanje({
  tenantId,
  moneda,
}: {
  tenantId: string
  moneda: MonedaDeCanje
}): Promise<void> {
  if (moneda !== 'ARS' && moneda !== 'USD') {
    throw new ErrorDeCanje('MONEDA_INVALIDA', `Esa moneda no existe: "${String(moneda)}".`)
  }
  await prismaParaTenant(tenantId).configuracionDeCanje.upsert({
    where: { tenantId },
    create: { tenantId, moneda },
    update: { moneda },
  })
}
