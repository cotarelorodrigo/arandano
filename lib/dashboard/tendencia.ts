import { Prisma } from '@/generated/prisma/client'
import { sumarDias, inicioDelDia } from '@/lib/formato/fechas'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import type { MonedaElegida } from '@/lib/ventas/medios'
// `import type`, no de valor: mismo motivo que en lib/dashboard/metricas.ts —
// acá `prismaParaTenant` sólo aparece dentro de un `ReturnType<typeof ...>`.
// Con un import de valor, un componente cliente que importara `tendencia.ts`
// arrastraría `lib/tenant/prisma.ts` a su bundle.
import type { prismaParaTenant } from '@/lib/tenant/prisma'

type PrismaDeTenant = ReturnType<typeof prismaParaTenant>

/**
 * Catorce días, y la ventana es FIJA: no responde al chip de rango.
 *
 * El único texto de la maqueta sobre este panel es la nota "últimos 14 días"
 * (frame `Móvil / Dashboard`, nodo `ZDHsA`), y con el rango en `hoy` un panel
 * que siguiera al filtro sería UNA SOLA barra, que no es una tendencia. Hay
 * precedente: las seis barras de meses de "Cómo se movió" en
 * /inventario/[id] tampoco responden a ningún filtro.
 *
 * Está escrito acá para que el próximo ciclo no lo "arregle" atándolo al
 * rango.
 */
export const DIAS_DE_TENDENCIA = 14

export type BarraDeDia = {
  /** `YYYY-MM-DD`. */
  dia: string
  /** El número de día sin ceros a la izquierda: "8", "21". */
  etiqueta: string
  monto: string
  ventas: number
  esMejor: boolean
}

/**
 * El día de Buenos Aires de un instante — NUNCA `toISOString().slice(0,10)`,
 * que agrupa por UTC: una venta de las 23:30 del 19 caería en la barra del 20.
 */
function diaDe(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(fecha)
}

export function agregarPorDia(
  ventas: { creadoEn: Date; total: string; totalUsd: string }[],
  hoy: string,
  moneda: MonedaElegida,
): BarraDeDia[] {
  // Los catorce días SIEMPRE, con o sin ventas: un día vacío en el medio es
  // información, y saltearlo dejaría barras contiguas que mienten sobre la
  // continuidad del período.
  const dias: string[] = []
  for (let i = DIAS_DE_TENDENCIA - 1; i >= 0; i--) dias.push(sumarDias(hoy, -i))

  const acumulado = new Map(dias.map((d) => [d, { monto: new Prisma.Decimal(0), ventas: 0 }]))
  for (const v of ventas) {
    const casilla = acumulado.get(diaDe(v.creadoEn))
    // Una venta fuera de la ventana simplemente no entra.
    if (!casilla) continue
    casilla.monto = casilla.monto.add(moneda === 'usd' ? v.totalUsd : v.total)
    casilla.ventas += 1
  }

  // `>=` y no `>`, recorriendo del más viejo al más nuevo: es lo que hace que
  // un empate lo gane el día MÁS RECIENTE, que es el que sirve mirar.
  let mejor: string | null = null
  let maximo = new Prisma.Decimal(0)
  for (const dia of dias) {
    const m = acumulado.get(dia)!.monto
    // Estrictamente mayor que CERO: con todo en cero no hay mejor día, y sin
    // esta guarda la primera barra quedaría resaltada y el pie afirmaría un
    // récord de $ 0.
    if (m.greaterThan(0) && m.greaterThanOrEqualTo(maximo)) {
      maximo = m
      mejor = dia
    }
  }

  return dias.map((dia) => {
    const { monto, ventas: n } = acumulado.get(dia)!
    return {
      dia,
      etiqueta: String(Number(dia.slice(8, 10))),
      monto: monto.toString(),
      ventas: n,
      esMejor: dia === mejor,
    }
  })
}

/**
 * El pie del panel (nodo `TZqEL`).
 *
 * **No dice "del mes"**, aunque la maqueta de escritorio lo diga: la ventana
 * son catorce días, y afirmar el mes sobre catorce días es falso. Los dos
 * frames del `.pen` ya se contradicen entre sí acá (el móvil no lo dice), así
 * que la divergencia queda anotada en
 * docs/correcciones-pendientes-del-pen.md.
 */
export function pieDeTendencia(barras: BarraDeDia[], moneda: MonedaElegida): string | null {
  const mejor = barras.find((b) => b.esMejor)
  if (!mejor) return null
  const nombre = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(mejor.dia))
  const plata = moneda === 'usd' ? formatearDolares(mejor.monto) : formatearPrecio(mejor.monto)
  const ventas = mejor.ventas === 1 ? '1 venta' : `${mejor.ventas} ventas`
  return `El ${nombre} ${mejor.etiqueta} fue el mejor de los últimos ${DIAS_DE_TENDENCIA} días: ${plata} en ${ventas}.`
}

/**
 * Las ventas de la ventana. Acotada por definición —catorce días—, así que no
 * tiene el techo abierto que CLAUDE.md dejó anotado para el panel de horarios.
 */
export function ventasDeLaTendencia(prisma: PrismaDeTenant, hoy: string) {
  return prisma.venta.findMany({
    where: {
      creadoEn: {
        gte: inicioDelDia(sumarDias(hoy, -(DIAS_DE_TENDENCIA - 1))),
        lt: inicioDelDia(sumarDias(hoy, 1)),
      },
      anuladaEn: null,
    },
    select: { creadoEn: true, total: true, totalUsd: true },
  })
}
