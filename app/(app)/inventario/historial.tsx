import { ShoppingCart, Truck, ClipboardList, Undo2, type LucideIcon } from 'lucide-react'
import { Prisma } from '@/generated/prisma/client'
import { Badge } from '@/components/ui/badge'
import { formatearHora, formatearPrecio } from '@/lib/formato/mostrar'

/** Los cuatro motivos de `MovimientoStock.motivo` (prisma/schema.prisma). */
export type Motivo = 'VENTA' | 'ANULACION_VENTA' | 'AJUSTE' | 'INGRESO'

/**
 * El chip de motivo del historial (design/arandano.pen, frame `y4tEb`, celda
 * `dJSBl`): pastilla con ícono, un color por motivo. Los cuatro colores ya
 * existen como tokens (`--ok`, `--warn`, `--destructive` los trae
 * `docs/sistema-de-diseno.md`; `--accent` es el equivalente de `ar-primary-soft`
 * — ver `design/LEEME.md`), así que este chip no suma ningún color nuevo.
 */
const CONFIG_MOTIVO: Record<Motivo, { texto: string; Icono: LucideIcon; clase: string }> = {
  VENTA: { texto: 'Venta', Icono: ShoppingCart, clase: 'bg-accent text-primary' },
  INGRESO: { texto: 'Ingreso', Icono: Truck, clase: 'bg-ok-soft text-ok' },
  AJUSTE: { texto: 'Ajuste', Icono: ClipboardList, clase: 'bg-warn-soft text-warn' },
  ANULACION_VENTA: { texto: 'Anulación', Icono: Undo2, clase: 'bg-muted text-foreground-soft' },
}

/** El texto plano del motivo, sin ícono — lo usa también el CSV (acciones.ts). */
export function textoDeMotivo(motivo: string): string {
  return CONFIG_MOTIVO[motivo as Motivo]?.texto ?? motivo
}

export function ChipMotivo({ motivo }: { motivo: string }) {
  const config = CONFIG_MOTIVO[motivo as Motivo]
  // Sin fallback silencioso: un motivo que este mapa no conoce (el schema
  // sumó uno nuevo y nadie actualizó esto) se ve como texto plano en vez de
  // hacer explotar el render — el mismo criterio que NOMBRE_DE_MOTIVO tenía
  // antes de esta task (`?? m.motivo`).
  if (!config) return <Badge variant="outline">{motivo}</Badge>
  const { Icono, texto, clase } = config
  return (
    <Badge className={`h-auto gap-1 border-transparent px-[9px] py-[3px] text-[11px] font-semibold ${clase}`}>
      <Icono aria-hidden="true" className="size-3" />
      {texto}
    </Badge>
  )
}

// 'en-CA' y `formatToParts`, no 'es-AR' con `.format()` directo: con sólo
// día+mes (sin año) y locale es-AR, Node/ICU elige un patrón que NO respeta
// `month: '2-digit'` y da "21/8" en vez de "21/08" — verificado en runtime.
// 'en-CA' sí lo respeta siempre (es el mismo truco que ya usa `hoyEnArgentina`
// en /ventas para la fecha `YYYY-MM-DD`), así que se arma el string a mano
// desde las partes en vez de confiar en el `.format()` de este locale puntual.
const FECHA_MOVIMIENTO = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Argentina/Buenos_Aires',
})

/**
 * `Date` → "21/08 · 14:28" (design/arandano.pen, celda `jO9XK`): día y mes con
 * cero a la izquierda, SIN año, unidos a la hora con " · ". Ni
 * `formatearFecha` (que da "21/8/26, 14:28", con coma y año a dos dígitos) ni
 * `formatearFechaCorta` (que trae el año) sirven acá — es el mismo criterio
 * por el que `/ventas/[id]` ya tiene su propio armado con `formatearHora`.
 */
export function formatearFechaMovimiento(v: Date): string {
  const partes = FECHA_MOVIMIENTO.formatToParts(v)
  const dia = partes.find((p) => p.type === 'day')?.value ?? ''
  const mes = partes.find((p) => p.type === 'month')?.value ?? ''
  return `${dia}/${mes} · ${formatearHora(v)}`
}

/**
 * La celda "Detalle" (design/arandano.pen, celda `xR9gh`): funde lo que el
 * código de antes de esta task separaba en dos columnas ("Quién" y
 * "Detalle") en un solo texto, y el armado difiere por motivo porque los
 * cuatro ejemplos de la maqueta lo hacen: una VENTA identifica a quién
 * atendió, un AJUSTE identifica a quién contó, pero un INGRESO prioriza la
 * factura y el costo por sobre quién lo recibió (ninguno de los dos ejemplos
 * de INGRESO del relevamiento nombra a la persona).
 */
export function detalleDeMovimiento(
  m: {
    motivo: string
    nota: string | null
    costoUnitario: Prisma.Decimal | null
    usuario: { nombre: string }
    venta: { numero: number } | null
  },
  /**
   * Si esta persona puede ver costos (permiso `COSTOS`).
   *
   * **Sin valor por defecto a propósito.** Un `= true` dejaría que el
   * consumidor que se olvide de pasarlo siga mostrando el costo, que es
   * justamente el modo de falla que el permiso existe para evitar. Obligarlo
   * hace que agregar un tercer consumidor sea un error de tipos y no una
   * filtración silenciosa.
   */
  mostrarCostos: boolean,
): string {
  switch (m.motivo) {
    case 'VENTA':
      // `venta` es siempre no-null en una fila VENTA de verdad (lib/ventas/
      // crear.ts la genera junto con el movimiento); el `?? '?'` es sólo para
      // no reventar si algún día no lo fuera.
      return `Venta #${m.venta?.numero ?? '?'} · ${m.usuario.nombre}`
    case 'ANULACION_VENTA':
      return `Anulación de la venta #${m.venta?.numero ?? '?'}`
    case 'INGRESO': {
      const costo =
        mostrarCostos && m.costoUnitario
          ? `${formatearPrecio(m.costoUnitario.toString())} c/u`
          : null
      const partes = [m.nota, costo].filter((p): p is string => Boolean(p))
      // Ni nota ni costo cargados (o cargado y escondido por el permiso): no
      // puede quedar una celda vacía, así que cae a quién lo hizo — mejor eso
      // que nada, y sin distinguir los dos casos: revelarían por omisión que
      // hay un costo escondido.
      return partes.length > 0 ? partes.join(' · ') : `Ingreso · ${m.usuario.nombre}`
    }
    case 'AJUSTE':
      return m.nota ? `${m.nota} · ${m.usuario.nombre}` : m.usuario.nombre
    default:
      return m.nota ?? ''
  }
}

/**
 * La columna "Queda" del historial — **decisión ya tomada, no a discutir**:
 * SE RECONSTRUYE, no se guarda. `MovimientoStock` no tiene ninguna columna de
 * saldo por fila, y `Articulo.stock` es apenas un CACHÉ de la suma de sus
 * movimientos (comentario del propio schema), no la fuente de verdad de
 * ningún saldo intermedio. El saldo de cada fila sale de recorrer los deltas
 * HACIA ATRÁS desde el stock actual: la fila más nueva (índice 0, porque
 * `movimientos` llega ordenado `creadoEn desc`) queda en el stock de hoy, y
 * cada fila más vieja se obtiene deshaciendo el delta de la fila que la
 * precede en el arreglo.
 *
 * **Si estás por agregarle una columna a `MovimientoStock` para guardar
 * esto: no.** Guardar el saldo por fila obliga a recalcular todas las filas
 * posteriores cada vez que se inserta un movimiento fuera de orden —una
 * corrección tardía, una migración de datos—, y esta función ya resuelve el
 * caso general (incluido ese) sin esa complejidad ni una migración.
 */
export function calcularSaldos(
  deltasDesc: Prisma.Decimal[],
  stockActual: Prisma.Decimal,
): Prisma.Decimal[] {
  const saldos: Prisma.Decimal[] = []
  let saldo = stockActual
  for (const delta of deltasDesc) {
    saldos.push(saldo)
    saldo = saldo.minus(delta)
  }
  return saldos
}
