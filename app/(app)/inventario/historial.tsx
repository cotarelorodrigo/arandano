import type { ReactNode } from 'react'
import { ShoppingCart, Truck, ClipboardList, Undo2, type LucideIcon } from 'lucide-react'
import { Prisma } from '@/generated/prisma/client'
import { Badge } from '@/components/ui/badge'
import { formatearHora, formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import estilos from './tipografia.module.css'

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
export function detalleDeMovimiento(m: {
  motivo: string
  nota: string | null
  costoUnitario: Prisma.Decimal | null
  usuario: { nombre: string }
  venta: { numero: number } | null
}): string {
  switch (m.motivo) {
    case 'VENTA':
      // `venta` es siempre no-null en una fila VENTA de verdad (lib/ventas/
      // crear.ts la genera junto con el movimiento); el `?? '?'` es sólo para
      // no reventar si algún día no lo fuera.
      return `Venta #${m.venta?.numero ?? '?'} · ${m.usuario.nombre}`
    case 'ANULACION_VENTA':
      return `Anulación de la venta #${m.venta?.numero ?? '?'}`
    case 'INGRESO': {
      const costo = m.costoUnitario ? `${formatearPrecio(m.costoUnitario.toString())} c/u` : null
      const partes = [m.nota, costo].filter((p): p is string => Boolean(p))
      // Ni nota ni costo cargados: no puede quedar una celda vacía, así que
      // cae a quién lo hizo — mejor eso que nada.
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

/**
 * Una fila del historial ya resuelta a texto — Task 7 del ciclo móvil, mismo
 * criterio que `FilaDeArticulo`/`ItemVendido` en `/inventario`/`/ventas`: sin
 * ningún `Decimal` de Prisma ni otro tipo que no cruce limpio a un fixture de
 * test, así `HistorialDeMovimientos` (más abajo) se renderiza con
 * `renderToStaticMarkup` en vez de por `readFileSync`.
 */
export type FilaDeMovimiento = {
  id: string
  fechaTexto: string
  /** El código crudo (`VENTA`, `INGRESO`, …), no el texto — `ChipMotivo` lo
   *  necesita para elegir ícono y color. */
  motivo: string
  detalleTexto: string
  /** Ya con el signo puesto ("+24" o "-1"), calculado UNA vez acá y
   *  reutilizado tanto por la fila del teléfono como por la celda "Cambio"
   *  de escritorio, en vez de recalcularlo dos veces. */
  cambioTexto: string
  /** El color de "Cambio" (destructive/ok) no se puede derivar del texto
   *  formateado (`Intl` puede usar un signo menos que no sea "-"), así que
   *  viaja aparte, calculado con el `Decimal` real. */
  negativo: boolean
  quedaTexto: string
}

/**
 * Arma una `FilaDeMovimiento` a partir de un movimiento de Prisma y el saldo
 * que le corresponde (`calcularSaldos`, más arriba) — la única función de
 * este archivo que todavía ve un `Prisma.Decimal`, para que
 * `HistorialDeMovimientos` no tenga que hacerlo.
 */
export function filaDeMovimiento(
  m: {
    id: string
    delta: Prisma.Decimal
    motivo: string
    nota: string | null
    creadoEn: Date
    costoUnitario: Prisma.Decimal | null
    usuario: { nombre: string }
    venta: { numero: number } | null
  },
  saldo: Prisma.Decimal,
): FilaDeMovimiento {
  return {
    id: m.id,
    fechaTexto: formatearFechaMovimiento(m.creadoEn),
    motivo: m.motivo,
    detalleTexto: detalleDeMovimiento(m),
    // El signo explícito en el positivo: la columna se lee de un vistazo
    // como "entró" o "salió" — mismo criterio que ya usaba la celda "Cambio"
    // antes de esta task.
    cambioTexto: `${m.delta.greaterThan(0) ? '+' : ''}${formatearCantidad(m.delta.toString())}`,
    negativo: m.delta.lessThan(0),
    quedaTexto: formatearCantidad(saldo.toString()),
  }
}

/**
 * La card completa de "Historial de movimientos" (design/arandano.pen, frame
 * `y4tEb` en escritorio y `T5gME` en el teléfono) — Task 7 del ciclo móvil.
 *
 * Extraída de `[id]/page.tsx` como componente puro (sin Prisma, sin sesión),
 * mismo criterio que `Listado` de este mismo módulo (docblock de cabecera de
 * `page.tsx`): quien la usa arma `filas` ya resuelto a texto, y esto sólo
 * renderiza — así un test puede afirmar sobre el HTML real en vez de sobre el
 * FUENTE, que es lo que dos reviews de este ciclo ya marcaron como hallazgo
 * para el patrón anterior (`<Table>` de shadcn, que no admite el quiebre a
 * tarjetas del teléfono).
 *
 * `accion` (el botón "Exportar CSV →") se recibe YA ARMADO — mismo criterio
 * que `panelCategorias` en `FiltrosDeInventario` (`page.tsx`): quien lo arma
 * necesita `articuloId`, un dato que esta función no usa para nada más.
 *
 * **Sigue el patrón grid + `display:contents` de la Task 4** (docblock de
 * referencia en `app/(app)/ventas/page.tsx:344-408`): roles ARIA explícitos,
 * el borde y el fondo en las celdas (nunca en la fila, que con
 * `display:contents` no pinta nada propio), el centrado vertical con un
 * envoltorio interno (`lg:flex lg:h-full lg:items-center`) y todo
 * `group-hover`/`transition` con el prefijo `lg:`.
 */
export function HistorialDeMovimientos({
  filas,
  limiteAlcanzado,
  limiteVisible,
  accion,
}: {
  filas: FilaDeMovimiento[]
  limiteAlcanzado: boolean
  limiteVisible: number
  accion?: ReactNode
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Historial de movimientos</h2>
        {accion}
      </div>
      {filas.length === 0 ? (
        <p className="p-[14px] text-sm text-muted-foreground lg:p-[18px]">
          Todavía no hubo movimientos de este artículo.
        </p>
      ) : (
        <div role="table" className="grid grid-cols-1 lg:grid-cols-[150px_170px_1fr_110px_100px]">
          <div role="row" className="hidden lg:contents">
            <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Fecha
            </div>
            <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Motivo
            </div>
            <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Detalle
            </div>
            <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Cambio
            </div>
            <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
              Queda
            </div>
          </div>

          {filas.map((f) => (
            <div
              key={f.id}
              role="row"
              className="group flex flex-col gap-[6px] border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
            >
              {/* Fila superior del teléfono: chip de motivo + fecha + cambio
                  (design/arandano.pen, `T5gME`, nodo "Fila"). */}
              <div className="flex items-center gap-[10px] lg:hidden">
                <ChipMotivo motivo={f.motivo} />
                <span className="flex-1 truncate text-[11px] text-muted-foreground">{f.fechaTexto}</span>
                <span
                  className={`${estilos.archivo} text-[15px] font-bold tabular-nums ${
                    f.negativo ? 'text-destructive' : 'text-ok'
                  }`}
                >
                  {f.cambioTexto}
                </span>
              </div>
              {/* Fila inferior del teléfono: detalle + queda (nodo "Meta"). */}
              <div className="flex items-center gap-[10px] lg:hidden">
                <span className="flex-1 truncate text-[12px] text-muted-foreground">{f.detalleTexto}</span>
                <span className="shrink-0 text-[11px] font-semibold text-foreground-soft">
                  queda {f.quedaTexto}
                </span>
              </div>

              {/* Celdas de escritorio: cada una su propia columna del grid,
                  ocultas en el teléfono (ya fundidas arriba). */}
              <div role="cell" className="hidden text-sm text-foreground lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                <div className="lg:flex lg:h-full lg:items-center">{f.fechaTexto}</div>
              </div>
              <div role="cell" className="hidden lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                <div className="lg:flex lg:h-full lg:items-center">
                  <ChipMotivo motivo={f.motivo} />
                </div>
              </div>
              {/* lg:min-w-0 en la celda: la única columna de ancho flexible
                  (1fr) — sin min-width:0 un item de grid no se achica por
                  debajo del contenido, y `lg:truncate` (adentro) nunca corta
                  nada. Sin ningún `max-w-0`: ese truco es de `table-fixed`
                  (el `<TableCell>` de antes de esta task), no de Grid. */}
              <div role="cell" className="hidden text-sm text-muted-foreground lg:block lg:min-w-0 lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                <div className="lg:flex lg:h-full lg:min-w-0 lg:items-center lg:truncate">
                  {f.detalleTexto}
                </div>
              </div>
              <div
                role="cell"
                className={`${estilos.archivo} hidden text-right font-semibold tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors ${
                  f.negativo ? 'text-destructive' : 'text-ok'
                }`}
              >
                <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{f.cambioTexto}</div>
              </div>
              <div role="cell" className={`${estilos.archivo} hidden text-right font-semibold text-foreground tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{f.quedaTexto}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {limiteAlcanzado && (
        <p className="border-t px-[14px] py-3 text-sm text-muted-foreground lg:px-[18px]">
          Se muestran los últimos {limiteVisible} movimientos. Exportar CSV trae el historial
          completo.
        </p>
      )}
    </section>
  )
}
