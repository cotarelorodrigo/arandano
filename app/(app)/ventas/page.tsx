import Link from 'next/link'
import { Calendar, Funnel, ShoppingCart } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { formatearPrecio, formatearHora, formatearCantidad } from '@/lib/formato/mostrar'
import { componerPorMedio } from '@/lib/ventas/composicion'
import { ROTULO_MEDIO, CONSUMIDOR_FINAL, type Medio } from '@/lib/ventas/medios'
import { ChipEstado } from './chip-estado'
import { GraficoDeMedios } from './grafico'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

/**
 * El día de hoy en Buenos Aires, como `YYYY-MM-DD`.
 *
 * El servidor está en Ashburn: `new Date()` a las 22:00 de Buenos Aires ya es
 * el día siguiente en UTC, así que "las ventas de hoy" mostraría las de mañana
 * y ninguna de las de la tarde. El huso va declarado, igual que en
 * `formatearFecha`.
 */
function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** `YYYY-MM-DD` al instante en que ese día empieza en Buenos Aires (UTC-3). */
function inicioDelDia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`)
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * La fecha del query string, o hoy.
 *
 * Chequea el `Date` construido y no sólo la forma de los dígitos: `2026-13-45`
 * pasa cualquier regex de `\d{4}-\d{2}-\d{2}` y después da un `Invalid Date`
 * que Prisma rechaza sin que nadie lo atrape — un 500 servido desde algo que
 * alguien tipeó en la barra de direcciones. Es el mismo criterio que el clamp
 * de `?p`: lo malformado cae al default, no explota.
 */
function fechaOhoy(valor: string | undefined, hoy: string): string {
  if (!valor || !ES_FECHA.test(valor)) return hoy
  return Number.isNaN(inicioDelDia(valor).getTime()) ? hoy : valor
}

/**
 * `YYYY-MM-DD` → "13 de agosto de 2026".
 *
 * Con el huso declarado, por lo mismo que `hoyEnArgentina`: sin él, el
 * `Date` de medianoche argentina se formatea en UTC y muestra el día anterior.
 */
function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(iso))
}

/** Los tres accesos rápidos de rango del filtro (design/arandano.pen, nodo `SM9Zl`). */
export const RANGOS = ['hoy', '7dias', 'estemes'] as const
export type Rango = (typeof RANGOS)[number]

export const ROTULO_RANGO: Record<Rango, string> = {
  hoy: 'Hoy',
  '7dias': '7 días',
  estemes: 'Este mes',
}

/**
 * `YYYY-MM-DD` más/menos `dias` días de calendario.
 *
 * A medianoche UTC y no con `inicioDelDia` (que ancla a Buenos Aires): acá lo
 * único que importa son los componentes de la fecha, no el instante, así que
 * cualquier huso fijo sirve con tal de no cruzar un cambio de horario de
 * verano que Argentina no tiene. Usar un huso real metería esa complejidad de
 * vuelta sin necesidad.
 */
function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** El primer día del mes de `iso`, mismo criterio que sumarDias. */
function primerDiaDelMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/**
 * El `[desde, hasta]` que arma cada chip de rango rápido, contra `hoy`.
 *
 * "7dias" resta 6 y no 7: del 15 al 21 son 7 días con el 21 incluido
 * (21,20,19,18,17,16,15), y restar 7 dejaría afuera el propio día de hoy.
 */
export function rangoDeChip(rango: Rango, hoy: string): { desde: string; hasta: string } {
  switch (rango) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    case '7dias':
      return { desde: sumarDias(hoy, -6), hasta: hoy }
    case 'estemes':
      return { desde: primerDiaDelMes(hoy), hasta: hoy }
  }
}

/**
 * Qué chip, si alguno, describe el filtro vigente — para resaltarlo con el
 * mismo tratamiento que la maqueta le da a "Hoy" en su estado activo. Ninguno
 * cuando el rango viene de tipear las fechas a mano.
 */
export function chipActivo(desde: string, hasta: string, hoy: string): Rango | null {
  return RANGOS.find((r) => {
    const rg = rangoDeChip(r, hoy)
    return rg.desde === desde && rg.hasta === hasta
  }) ?? null
}

/** El filtro de rango que arma esta pantalla: el mismo `donde` para el
 *  listado, los tres tiles y el panel de medios. */
type FiltroDePeriodo = { creadoEn: { gte: Date; lt: Date } }

/**
 * El total del tile "Total del período": la suma de lo NO anulado. Una venta
 * anulada no es plata que entró, y esta regla es la única razón de ser de la
 * función — extraída y exportada porque, a diferencia del resto de las
 * funciones de este archivo, ésta SÍ toca la base (no hay forma de probar la
 * regla sin eso), así que el test que la sostiene vive en test/ventas.test.ts,
 * contra la base efímera, y no en page.test.tsx.
 *
 * Antes de esta extracción, sacar `anuladaEn: null` del `where` no rompía
 * ningún test (785/785 en verde) — hallazgo I3 de la review final del
 * rediseño. Que la función exista y se llame desde acá es lo que la deja
 * protegida.
 */
export function totalDelPeriodo(
  prisma: ReturnType<typeof prismaParaTenant>,
  donde: FiltroDePeriodo,
) {
  return prisma.venta.aggregate({ where: { ...donde, anuladaEn: null }, _sum: { total: true } })
}

/**
 * El pie del tile "Ventas cobradas": el promedio por venta cobrada.
 *
 * `undefined` y no `NaN` cuando no hubo ninguna cobrada — un período puede
 * anularse entero, y "promedio $ NaN" es peor que no mostrar ningún pie: ver
 * el mismo criterio en `hayFaltanteDeVenta` de punto-de-venta.tsx.
 */
export function pieDeCobradas(sumaCobradas: string, cobradas: number): string | undefined {
  if (cobradas <= 0) return undefined
  const promedio = Number(sumaCobradas) / cobradas
  return `promedio ${formatearPrecio(promedio.toFixed(2))}`
}

/**
 * El pie del tile "Anuladas": lo DEVUELTO, no el total del período de al
 * lado — son dos agregados distintos (`SUM(total) WHERE anuladaEn IS NOT
 * NULL` acá, `WHERE anuladaEn IS NULL` en el tile de al lado) y mezclarlos
 * sería el mismo bug que ya evita `crearVenta` al no reutilizar sumas.
 */
export function pieDeAnuladas(montoDevuelto: string): string {
  return `${formatearPrecio(montoDevuelto)} devueltos`
}

/**
 * La celda "Medios" del listado: los medios distintos de una venta, en el
 * orden en que se cobraron, cada uno marcado con "· US$" si tuvo algún pago
 * en dólares (fila #1040 del relevamiento: "Efectivo · US$").
 *
 * **Decisión de UI que la maqueta no muestra**: ninguna de las siete filas de
 * ejemplo combina dos medios en la misma venta, así que no hay ninguna pista
 * de cómo resumir un pago partido entre efectivo y tarjeta. Acá se listan
 * los dos, separados por "+" — no es lo único razonable ("Mixto" también lo
 * sería), pero es el que no pierde información, y `Pago` ya admite varios
 * registros por venta a propósito (ver el comentario de ese modelo).
 */
export function rotuloDeMedios(pagos: { medio: Medio; moneda: 'ARS' | 'USD' }[]): string {
  if (pagos.length === 0) return '—'
  const conDolares = new Map<Medio, boolean>()
  for (const p of pagos) {
    conDolares.set(p.medio, (conDolares.get(p.medio) ?? false) || p.moneda === 'USD')
  }
  return [...conDolares.entries()]
    .map(([medio, usd]) => ROTULO_MEDIO[medio] + (usd ? ' · US$' : ''))
    .join(' + ')
}

/**
 * Hasta 5 números de página centrados en `actual`, recortados a `[1, total]`.
 *
 * Sin "…": la maqueta (design/arandano.pen, nodo `KRTvR`) dibuja tres botones
 * fijos sin elipsis, y un total real de más de 5 páginas no tiene ningún
 * ejemplo del que copiar ese tratamiento — se prefirió la ventana simple, sin
 * inventar un símbolo que el diseño no pidió.
 */
export function ventanaDePaginas(actual: number, total: number): number[] {
  if (total <= 0) return []
  const tam = Math.min(5, total)
  const inicioCentrado = actual - Math.floor(tam / 2)
  const fin = Math.min(total, Math.max(tam, inicioCentrado + tam - 1))
  const inicio = fin - tam + 1
  const out: number[] = []
  for (let n = inicio; n <= fin; n++) out.push(n)
  return out
}

/**
 * Un tile del resumen del período.
 *
 * `marca` sólo lo pide el tile de "Total del período": es el ancla de
 * `--marca` que docs/sistema-de-diseno.md ya lista para esta pantalla ("Lo
 * que entró en el período"), así que ANTES de este ciclo el código
 * contradecía su propio sistema de diseño escrito — no sólo la maqueta.
 */
export function Tile({
  rotulo, valor, pie, marca = false,
}: { rotulo: string; valor: string; pie?: string; marca?: boolean }) {
  // Paddings y tamaños mobile-first: el teléfono (`nwW2V`) achica el padding
  // y la Valor respecto de lo que ya declaraba escritorio, así que el valor
  // sin prefijo es el del teléfono y `lg:` restaura los números de siempre —
  // el escritorio no puede cambiar de aspecto (mG0u7: padding [15,17], Valor
  // 30px; H6aISK/a7MuT: padding [14,15], Valor 24px).
  if (marca) {
    return (
      <div
        className="flex flex-1 flex-col gap-[3px] rounded-2xl px-[17px] py-[15px] lg:px-[18px] lg:py-4"
        style={{ backgroundColor: 'var(--marca)' }}
      >
        <div
          className="text-[10px] font-bold tracking-[1px] uppercase lg:tracking-[1.2px]"
          style={{ color: 'var(--marca-soft)' }}
        >
          {rotulo}
        </div>
        <div
          style={{ color: 'var(--marca-foreground)' }}
          className={`${estilos.archivo} text-[30px] leading-none font-semibold tracking-[-0.6px] tabular-nums lg:text-[32px]`}
        >
          {valor}
        </div>
        {pie && (
          <div className="text-[11px]" style={{ color: 'var(--marca-dim)' }}>
            {pie}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col gap-[3px] rounded-2xl border bg-card px-[15px] py-[14px] lg:px-[18px] lg:py-4">
      <div className="text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase lg:tracking-[1.2px]">
        {rotulo}
      </div>
      {/* tabular-nums en los tres, no sólo en el de plata: los tiles están uno
          al lado del otro y un dígito de ancho variable los descalza entre sí. */}
      <div
        className={`${estilos.archivo} text-[24px] leading-none font-semibold tracking-[-0.6px] tabular-nums text-foreground lg:text-[26px]`}
      >
        {valor}
      </div>
      {/* 10px/1.3 en el teléfono (nodos `HvuAw`/`KSKKW`: el pie puede
          envolver a dos líneas en un tile angosto, y sin `leading` explícito
          hereda el 1.5 del preflight, más suelto de lo que pide la maqueta),
          11px/normal en escritorio (`nINsZ`/`W3w2l`) como siempre — la única
          medida de esta función que había quedado sin el par mobile-first. */}
      {pie && <div className="text-[10px] leading-[1.3] text-muted-foreground lg:text-[11px] lg:leading-normal">{pie}</div>}
    </div>
  )
}

/**
 * El formulario de fechas ("Desde"/"Hasta"/"Filtrar"): un solo componente
 * para las dos ubicaciones donde vive —a la vista en escritorio (`hidden
 * lg:flex`) y adentro del `Sheet` que el botón de 38px abre en el teléfono
 * (nodo `e00ToC` del frame `nwW2V`: la fila de Filtros del teléfono no tiene
 * lugar para los tres campos, así que se mudan a una hoja)—. No se escribe
 * dos veces: se llama dos veces con el MISMO componente, y las etiquetas van
 * implícitas (`<label>` envolviendo el campo, sin `id`/`htmlFor`) para que
 * las dos copias no choquen si alguna vez coinciden montadas a la vez — el
 * `Sheet`, sin `forceMount`, sólo monta su contenido cuando se abre, así que
 * en la práctica eso dura apenas el instante en que el teléfono lo tiene
 * abierto.
 */
function FormularioDeFechas({
  dDesde, dHasta, apilado = false,
}: { dDesde: string; dHasta: string; apilado?: boolean }) {
  return (
    <form
      method="get"
      className={apilado ? 'flex flex-col gap-3' : 'hidden items-end gap-[10px] lg:flex'}
    >
      <label className={`flex flex-col gap-[5px] ${apilado ? '' : 'w-[168px]'}`}>
        <span className="text-[11px] font-semibold text-foreground-soft">Desde</span>
        <Input
          name="desde" type="date" defaultValue={dDesde}
          className="h-10 rounded-[9px] border-input bg-card px-[11px] text-sm"
        />
      </label>
      <label className={`flex flex-col gap-[5px] ${apilado ? '' : 'w-[168px]'}`}>
        <span className="text-[11px] font-semibold text-foreground-soft">Hasta</span>
        <Input
          name="hasta" type="date" defaultValue={dHasta}
          className="h-10 rounded-[9px] border-input bg-card px-[11px] text-sm"
        />
      </label>
      <Button
        type="submit" variant="outline" size="sm"
        className={`h-[38px] gap-[7px] rounded-[9px] border-input bg-card px-[15px] text-[13px] font-semibold text-foreground hover:bg-muted ${apilado ? 'w-full' : ''}`}
      >
        <Funnel aria-hidden="true" className="size-[15px]" />
        Filtrar
      </Button>
    </form>
  )
}

/** Una fila ya resuelta a texto, lista para `Listado`: sin `Decimal` de
 *  Prisma ni ningún otro tipo que no cruce limpio a un fixture de test. */
export type FilaDeVenta = {
  id: string
  numero: number
  horaFormateada: string
  clienteNombre: string
  itemsLabel: string
  mediosLabel: string
  totalFormateado: string
  anulada: boolean
}

/**
 * El listado: el patrón que copian las tasks 6, 8 y 10 (Task 4 del ciclo
 * móvil). La fila del teléfono NO es la de escritorio reordenada —el `#` y la
 * `HORA` son una sola línea en el teléfono y dos columnas en escritorio;
 * `MEDIOS` deja de ser columna y se funde en la línea de meta— así que se
 * resuelve con grid + `display: contents`:
 *
 * ```
 * contenedor  grid grid-cols-1 lg:grid-cols-[84px_110px_1fr_168px_140px_104px]
 * encabezado  hidden lg:contents          (cada <div> es un columnheader)
 * fila        flex ... lg:contents        role="row"
 * agrupador   flex ... lg:contents        (el que junta "#1042 · 14:32")
 * celda       role="cell"
 * ```
 *
 * `display: contents` borra al envoltorio de la caja de layout: sus hijos
 * pasan a ser celdas del grid del contenedor, así que en escritorio el mismo
 * marcado vuelve a ser una tabla de 6 columnas — las mismas anchuras que
 * declaraban los `<TableHead>` de antes (84, 110, auto→`1fr`, 168, 140, 104).
 *
 * El costo, real y no disimulado: `display: contents` saca del árbol de
 * accesibilidad a los elementos sin rol explícito, así que `role="table"`,
 * `"row"`, `"columnheader"` y `"cell"` son obligatorios y van en los DOS
 * anchos —no sólo en escritorio—, porque son `<div>`s sin semántica nativa
 * propia con o sin `display:contents`.
 *
 * **El principio completo, para que las tasks 6, 8 y 10 no lo copien a
 * medias (Ronda de arreglos 1 lo encontró aplicado sólo al fondo, no al
 * borde ni al centrado — ver el historial de este archivo y de
 * `app/(app)/vender/punto-de-venta.tsx`): un `display:contents` no genera
 * caja, así que NADA de lo que dependa de una caja puede vivir en la fila —
 * ni el fondo, ni el borde, ni el padding, ni el centrado vertical. Los
 * cuatro van en cada CELDA, nunca en el envoltorio:**
 *
 * - Fondo: `lg:group-hover:bg-muted/50` en cada celda (no `hover:bg-muted/50`
 *   en la fila, que traía gratis `<TableRow>`).
 * - Borde inferior entre filas: `lg:border-b` en cada celda, con
 *   `lg:group-last:border-b-0` para la última fila —no `last:border-b-0` en
 *   la fila, que en escritorio no pinta nada porque la fila no tiene caja.
 *   La fila SIGUE llevando su propio `border-b`/`last:border-b-0` sin
 *   prefijo, porque en el teléfono la fila SÍ es una caja real (no es
 *   `display:contents` ahí) y ese es el borde que se ve.
 * - Centrado vertical: por default, Grid estira cada celda (`align-items:
 *   stretch`) a la altura de la fila más alta, pero el contenido de una
 *   celda de una sola línea queda pegado ARRIBA de esa caja —lo que antes
 *   daba gratis `align-middle` de `<TableCell>`, que `display:contents` no
 *   tiene forma de heredar—. La celda en sí NO se achica con `self-center`:
 *   eso desalinearía su propio borde inferior del borde de las demás celdas
 *   de la fila (una celda más corta y centrada dentro de la fila deja su
 *   borde flotando a mitad de camino, no en el fondo real de la fila). La
 *   celda se queda estirada (el default), y quien centra es un `<div>`
 *   envoltorio ADENTRO de la celda, con `lg:flex lg:h-full lg:items-center`
 *   (más `lg:justify-end` si el contenido va alineado a la derecha) — el
 *   `h-full` resuelve al 100% de la celda estirada porque Grid le da una
 *   altura definida. Esto sólo hace falta en las celdas más cortas que la
 *   más alta de la fila (acá: todas menos "Cliente", que siempre muestra dos
 *   líneas).
 * - Transición del hover: `lg:transition-colors` en cada celda —no en la
 *   fila—, porque `<TableRow>` traía `transition-colors` de fábrica y sin
 *   él el resaltado aparece de golpe en vez de fundirse.
 *
 * No es un componente compartido a propósito: las cuatro tablas del ciclo
 * tienen columnas distintas y una abstracción que las cubra a las cuatro
 * sería peor que cuatro grids (ver el brief de la Task 4).
 */
export function Listado({
  filas, total, pagina, paginas, porPagina, conPagina,
}: {
  filas: FilaDeVenta[]
  total: number
  pagina: number
  paginas: number
  porPagina: number
  conPagina: (n: number) => string
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Últimas ventas</h2>
        {/* SIN "Ver todas →" (I7 de la review final): la maqueta la dibuja
            —probablemente residuo de un card de dashboard reusado, no una
            decisión sobre ESTA pantalla— pero esta pantalla YA es el listado
            completo del período que se está mirando, y no hay ningún destino
            más grande sin sumar un modo sin rango. */}
      </div>

      {filas.length === 0 ? (
        <p className="p-[14px] text-sm text-muted-foreground lg:p-[18px]">
          {/* Los dos vacíos no son el mismo vacío: con `total > 0` la página
              quedó fuera de rango (`?p` se clampea a [1, 1.000.000], no a
              `paginas`), y decir "no hay ventas en ese período" arriba de un
              tile que dice 17 sería contradecirse en la misma pantalla. */}
          {total === 0 ? (
            'No hay ventas en ese período.'
          ) : (
            <>
              Esa página no tiene ventas.{' '}
              <Link href={conPagina(1)} className="underline">
                Volver a la primera
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <>
          <div role="table" className="grid grid-cols-1 lg:grid-cols-[84px_110px_1fr_168px_140px_104px]">
            {/* El encabezado sólo existe en escritorio: `hidden` lo saca del
                todo en el teléfono, `lg:contents` lo disuelve ahí para que
                sus 6 `columnheader` pasen a ser las celdas de la primera fila
                del grid. El fondo se pinta en cada celda y no en el
                envoltorio: un `display:contents` no puede pintar nada. */}
            <div role="row" className="hidden lg:contents">
              <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Número
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Hora
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                {/* "Cliente" y no "Vendió" (I5 de la review final): el dato de
                    esta columna es el comprador. Quién vendió sigue
                    disponible, en el panel Resumen del detalle. */}
                Cliente
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Medios
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Total
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Estado
              </div>
            </div>

            {filas.map((f) => (
              // `group`: un elemento con `display:contents` no genera caja
              // propia, pero sigue en la cadena de ancestros para efectos de
              // `:hover` — así que su `:hover` dispara igual en escritorio, y
              // `lg:group-hover:bg-muted/50` en cada celda (más abajo) es lo
              // que reemplaza el `hover:bg-muted/50` que traía por default
              // `TableRow` (components/ui/table.tsx). Hallazgo de la review
              // de la Task 4: sin esto el resaltado de fila al pasar el mouse
              // desaparecía en escritorio — la regresión más fácil de meter
              // con este patrón, y la que las tasks 6, 8 y 10 iban a copiar.
              //
              // El `border-b`/`last:border-b-0` de acá SIGUEN sin prefijo: en
              // el teléfono la fila es una caja real (todavía no es
              // `display:contents`), así que ahí sí pintan. En escritorio no
              // hacen nada —`display:contents` no genera caja—, y por eso
              // cada celda lleva su PROPIO `lg:border-b`/`lg:group-last:
              // border-b-0` más abajo (Ronda de arreglos 1, Importante 1: acá
              // faltaba, y era el mismo defecto que el docblock de `Listado`
              // ya explicaba sin aplicarlo del todo).
              <div
                key={f.id}
                role="row"
                className="group flex items-center gap-[10px] border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
              >
                {/* "Datos": la mitad izquierda en el teléfono (agrupador +
                    cliente + meta); disuelta en escritorio, donde sus hijos
                    pasan a ser 3 de las 6 celdas de la fila del grid. */}
                <div className="flex flex-1 flex-col gap-[3px] lg:contents">
                  {/* "Agrupador": junta "#1042 · 14:32" en una sola línea en
                      el teléfono; disuelto en escritorio, donde Número y Hora
                      vuelven a ser dos celdas separadas (84px y 110px). */}
                  <div className="flex items-center gap-[7px] lg:contents">
                    <div
                      role="cell"
                      className={`${estilos.archivo} text-[14px] font-semibold text-primary lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}
                    >
                      {/* Envoltorio de centrado (Ronda de arreglos 1,
                          Importante 2): la CELDA se queda estirada (el
                          default de Grid) para que su `border-b` quede a la
                          altura del resto de la fila; quien centra el
                          contenido, sólo en escritorio, es este `<div>`
                          interno con `lg:h-full` (100% de la celda estirada)
                          — ver el docblock de `Listado`, más arriba. */}
                      <div className="lg:flex lg:h-full lg:items-center">
                        <Link href={`/ventas/${f.id}`}>#{f.numero}</Link>
                      </div>
                    </div>
                    <div role="cell" className="text-[11px] text-muted-foreground lg:border-b lg:p-[11px] lg:px-[7px] lg:text-sm lg:text-foreground lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                      <div className="lg:flex lg:h-full lg:items-center">
                        <span aria-hidden="true" className="lg:hidden">· </span>
                        {f.horaFormateada}
                      </div>
                    </div>
                  </div>
                  {/* El envoltorio flex-col + gap-0.5 es el mismo en los dos
                      anchos: en escritorio apila nombre + "N artículos" tal
                      cual lo hacía la TableCell de antes; en el teléfono el
                      subtítulo de acá está `hidden` (la meta de abajo lo
                      reemplaza con el dato de medios sumado), así que sólo
                      queda el nombre.
                      SIN envoltorio de centrado, a propósito: "Cliente" es la
                      celda más alta de la fila (siempre dos líneas), así que
                      ya queda estirada de punta a punta — nada que centrar
                      contra sí misma. */}
                  <div role="cell" className="lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-medium text-foreground lg:text-sm">
                        {f.clienteNombre}
                      </span>
                      {/* Sólo en escritorio: ahí Medios ya tiene su propia
                          celda, así que acá va sólo la cantidad de artículos. */}
                      <span className="hidden text-[11px] text-muted-foreground lg:block">
                        {f.itemsLabel}
                      </span>
                    </div>
                  </div>
                  {/* Sólo en el teléfono: MEDIOS deja de ser columna y se
                      funde en esta línea de meta, junto con la cantidad de
                      artículos — `display:none` la saca del flujo del grid en
                      escritorio, así que no le pisa ninguna de las 6 celdas. */}
                  <div className="text-[11px] text-muted-foreground lg:hidden">
                    {f.itemsLabel} · {f.mediosLabel}
                  </div>
                  {/* Medios: su propia celda, sólo visible en escritorio
                      (`hidden lg:block`) — en el teléfono el dato ya salió
                      arriba, en la meta. El `title` y `truncate` se mudan al
                      envoltorio de centrado: es el que de verdad recorta el
                      texto, así que el tooltip tiene que colgar de él. */}
                  <div
                    role="cell"
                    className="hidden p-[11px] px-[7px] text-sm text-foreground lg:block lg:border-b lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                  >
                    <div title={f.mediosLabel} className="lg:flex lg:h-full lg:items-center lg:truncate">
                      {f.mediosLabel}
                    </div>
                  </div>
                </div>

                {/* "Importe": la mitad derecha en el teléfono (monto + chip,
                    alineados a la derecha); disuelta en escritorio, donde sus
                    hijos vuelven a ser las celdas Total (140px) y Estado
                    (104px). */}
                <div className="flex flex-col items-end gap-1.5 lg:contents">
                  <div
                    role="cell"
                    className={`${estilos.archivo} text-[15px] font-semibold text-foreground tabular-nums lg:border-b lg:p-[11px] lg:px-[7px] lg:text-sm lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}
                  >
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                      {f.totalFormateado}
                    </div>
                  </div>
                  {/* Las anuladas se MUESTRAN: el historial tiene que poder
                      responder qué pasó, y esconderlas sería tapar la
                      respuesta. */}
                  <div role="cell" className="lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                      <ChipEstado anulada={f.anulada} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {paginas > 1 && (
            <nav
              aria-label="Paginación"
              className="flex items-center justify-between border-t px-[14px] py-3 lg:px-[18px]"
            >
              {/* Los tres números con el mismo formateador: antes sólo "de N"
                  pasaba por formatearCantidad y el rango quedaba en dígitos
                  crudos ("1001–1050 de 1.234 ventas") — mezcla de formatos en
                  la misma línea. */}
              <span className="text-[12px] text-muted-foreground">
                {formatearCantidad(String((pagina - 1) * porPagina + 1))}–
                {formatearCantidad(String(Math.min(pagina * porPagina, total)))} de{' '}
                {formatearCantidad(String(total))} {total === 1 ? 'venta' : 'ventas'}
              </span>
              <div className="flex items-center gap-[6px]">
                {ventanaDePaginas(pagina, paginas).map((n) =>
                  n === pagina ? (
                    // `type="button"` y sin `disabled`: un botón disabled no
                    // es focusable, así que quien navega por teclado perdía
                    // de vista en qué página estaba parado apenas la
                    // pestañeaba. `aria-current` es lo que la reemplaza como
                    // señal de "estás acá".
                    <Button
                      key={n}
                      type="button"
                      aria-current="page"
                      size="icon-sm"
                      className={`${estilos.archivo} size-[30px] rounded-lg text-[13px] font-semibold`}
                    >
                      {n}
                    </Button>
                  ) : (
                    <Button
                      key={n}
                      asChild
                      variant="outline"
                      size="icon-sm"
                      className={`${estilos.archivo} size-[30px] rounded-lg text-[13px] font-semibold text-foreground-soft`}
                    >
                      <Link href={conPagina(n)}>{n}</Link>
                    </Button>
                  ),
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

export default async function Ventas({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; p?: string }>
}) {
  const sesion = await exigirSesion()
  const { desde, hasta, p = '1' } = await searchParams

  const hoy = hoyEnArgentina()
  // Una fecha malformada cae en hoy en vez de romper el `new Date`, igual que
  // el clamp de `?p` del listado de inventario: un query string escrito a mano
  // no puede servir un 500.
  const dDesde = fechaOhoy(desde, hoy)
  const dHasta = fechaOhoy(hasta, hoy)
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)

  const donde = {
    creadoEn: {
      gte: inicioDelDia(dDesde),
      // El día "hasta" entra entero: se corta al inicio del siguiente.
      lt: new Date(inicioDelDia(dHasta).getTime() + 24 * 60 * 60 * 1000),
    },
  }

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [ventas, total, suma, anuladas, devueltas, pagos] = await Promise.all([
    prisma.venta.findMany({
      where: donde,
      orderBy: { numero: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, numero: true, total: true, creadoEn: true, anuladaEn: true,
        cliente: { select: { nombre: true } },
        // orderBy explícito: rotuloDeMedios() documenta "en el orden en que
        // se cobraron", y sin esto Postgres no promete ningún orden — el
        // resultado podía coincidir con la inserción por accidente, no por
        // contrato.
        pagos: { select: { medio: true, moneda: true }, orderBy: { creadoEn: 'asc' } },
        _count: { select: { items: true } },
      },
    }),
    prisma.venta.count({ where: donde }),
    // El total del período NO suma las anuladas: una venta anulada no es plata
    // que entró. Se dice en pantalla para que nadie tenga que deducirlo. La
    // regla vive en totalDelPeriodo() y no acá — ver su comentario para el
    // porqué de la extracción.
    totalDelPeriodo(prisma, donde),
    // Se cuentan las anuladas y NO las cobradas: cobradas = total - anuladas es
    // aritmética sobre dos números que ya vienen de la misma transacción, así
    // que no puede dar una suma que no cierre contra el listado.
    prisma.venta.count({ where: { ...donde, anuladaEn: { not: null } } }),
    // Lo DEVUELTO del tile de anuladas: un agregado propio, y no el mismo
    // `suma` de arriba con el filtro invertido reusado a mano — son sumas de
    // conjuntos disjuntos y cada una necesita su propio `_sum`.
    prisma.venta.aggregate({ where: { ...donde, anuladaEn: { not: null } }, _sum: { total: true } }),
    // Los pagos del período, para el panel de composición. Se filtran por la
    // VENTA y no por `pago.creadoEn`: es el mismo `donde` que el listado y que
    // los tiles, así que las tres cosas de la pantalla no pueden hablar de
    // períodos distintos.
    //
    // `groupBy` y no `$queryRaw` con un `SUM(monto * cotizacion)`, que sería la
    // consulta obvia: la extensión de lib/tenant/prisma.ts intercepta
    // operaciones de MODELO, no raw queries, así que un raw no lleva el
    // `set_config('arandano.tenant_id')` y RLS lo devuelve VACÍO. No falla:
    // devuelve cero filas, que en un panel de plata se lee como "no vendiste
    // nada". La multiplicación se hace en JS sobre estas pocas filas.
    // `monto` va en la clave y se cuenta en vez de sumarse: es lo que mantiene
    // el redondeo POR PAGO, igual que `totalDePagos`. Con `_sum` el panel y el
    // tile "Total del período" se separaban por centavos. Ver composicion.ts.
    prisma.pago.groupBy({
      by: ['medio', 'moneda', 'cotizacion', 'monto'],
      where: { venta: { ...donde, anuladaEn: null } },
      _count: true,
    }),
  ])

  const composicion = componerPorMedio(pagos)
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conPagina = (n: number) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (n > 1) u.set('p', String(n))
    return `/ventas?${u.toString()}`
  }
  const hrefRango = (r: Rango) => {
    const { desde: d, hasta: h } = rangoDeChip(r, hoy)
    return `/ventas?${new URLSearchParams({ desde: d, hasta: h }).toString()}`
  }
  const rangoVigente = chipActivo(dDesde, dHasta, hoy)
  const cobradas = total - anuladas

  return (
    <>
      <Encabezado
        titulo="Ventas"
        subtitulo={
          <>
            {dDesde === dHasta ? fechaLarga(dDesde) : `${fechaLarga(dDesde)} — ${fechaLarga(dHasta)}`}
            {/* El conteo sólo si hay algo que contar, igual que el subtítulo de
                /inventario y por la misma razón: un "· 0 ventas" arriba del
                "No hay ventas en ese período" es ruido al lado de un texto de
                vacío que ya lo dice. Dos pantallas del mismo ciclo no pueden
                contestar distinto la misma pregunta. */}
            {total > 0 && (
              <>
                {' · '}
                {total === 1 ? '1 venta' : `${formatearCantidad(String(total))} ventas`}
              </>
            )}
          </>
        }
        acciones={
          <Button asChild size="sm">
            <Link href="/vender">Vender</Link>
          </Button>
        }
        // El shopping-cart de la ranura del teléfono: es a donde ya apunta
        // `acciones` arriba, sólo que en 38px y sin texto (spec del ciclo
        // móvil, §2: "shopping-cart en /ventas").
        accionMovil={{ icono: ShoppingCart, etiqueta: 'Vender', href: '/vender', tono: 'accion' }}
      />
      <div className="flex flex-col gap-3 px-[14px] py-3 lg:gap-4 lg:p-6">
        {/* Filtros: fechas + accesos rápidos de rango (design/arandano.pen,
            nodo `H9Bw1` en escritorio, `ySXAK` en el teléfono). En el
            teléfono los tres campos de fecha no entran en esta fila —la
            maqueta sólo deja lugar para los rangos y un botón de 38px
            (`e00ToC`)—, así que se mudan a un `Sheet`; `FormularioDeFechas`
            es el mismo componente en las dos ubicaciones (ver su comentario). */}
        <div className="flex items-center gap-2 lg:items-end lg:gap-[10px]">
          <FormularioDeFechas dDesde={dDesde} dHasta={dHasta} />
          {/* El espaciador que empuja los Rangos a la derecha en escritorio
              (como hoy); en el teléfono no existe, ahí los Rangos ya son
              `flex-1` y ocupan todo el ancho que dejan libre el resto de la
              fila. */}
          <div className="hidden flex-1 lg:block" />
          {/* Rangos: segmented control de 3 opciones. Links y no botones de
              cliente: el rango vive en la URL, igual que el resto del filtro.
              En el teléfono el grupo entero es `flex-1` (fill_container en
              `av7aj`) y cada chip reparte el ancho a partes iguales. */}
          <div className="flex flex-1 gap-0.5 rounded-[10px] bg-muted p-[3px] lg:flex-none">
            {RANGOS.map((r) => (
              <Link
                key={r}
                href={hrefRango(r)}
                className={
                  r === rangoVigente
                    ? 'flex-1 rounded-lg bg-card px-[13px] py-[7px] text-center text-[12px] font-semibold text-foreground shadow-sm lg:flex-none'
                    : 'flex-1 rounded-lg px-[13px] py-[7px] text-center text-[12px] font-medium text-muted-foreground lg:flex-none'
                }
              >
                {ROTULO_RANGO[r]}
              </Link>
            ))}
          </div>
          {/* El botón de fechas del teléfono (nodo `e00ToC`): abre el Sheet
              con la SEGUNDA llamada a `FormularioDeFechas` (`apilado`). En
              escritorio no existe (`lg:hidden`) — ahí el formulario ya está a
              la vista, a la izquierda de esta misma fila. */}
          <Sheet>
            <SheetTrigger
              aria-label="Elegir fechas"
              className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] bg-card lg:hidden"
            >
              <Calendar aria-hidden="true" className="size-[17px]" />
            </SheetTrigger>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>Fechas</SheetTitle>
                <SheetDescription>Elegí el rango de fechas para filtrar las ventas.</SheetDescription>
              </SheetHeader>
              <div className="p-4">
                <FormularioDeFechas dDesde={dDesde} dHasta={dHasta} apilado />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Fila: las dos columnas — el listado a la izquierda, la composición
            de medios a la derecha (design/arandano.pen, nodo `dP70c`). En el
            teléfono (`nwW2V`) no hay columnas: todo el Cuerpo es una sola
            pila vertical. */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
          <div className="flex flex-1 flex-col gap-3 lg:gap-4">
            {/* Sobre `total`, que es el período, y NO sobre `ventas.length`, que es la
                página: los tres números que muestran estos tiles —total, suma y
                anuladas— salen de agregados sin paginar. Colgados de la página, un
                `/ventas?p=5` sobre un período de una sola página los hacía
                desaparecer, cuando lo que resumen sigue estando ahí. */}
            {total > 0 && (
              <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
                <Tile
                  marca
                  rotulo="Total del período"
                  valor={formatearPrecio((suma._sum.total ?? '0').toString())}
                  pie="sin contar las anuladas"
                />
                {/* "Ventas cobradas" y "Anuladas": su propia fila en el
                    teléfono (`Xrvxn`, fill_container + gap 12), disuelta en
                    escritorio para volver a ser dos tiles más de la MISMA
                    fila de tres que hoy —`flex gap-4` sigue viendo tres hijos
                    directos, byte a byte igual que antes. */}
                <div className="flex gap-3 lg:contents">
                  <Tile
                    rotulo="Ventas cobradas"
                    valor={formatearCantidad(String(cobradas))}
                    pie={pieDeCobradas((suma._sum.total ?? '0').toString(), cobradas)}
                  />
                  <Tile
                    rotulo="Anuladas"
                    valor={formatearCantidad(String(anuladas))}
                    pie={pieDeAnuladas((devueltas._sum.total ?? '0').toString())}
                  />
                </div>
              </div>
            )}

            {/* El listado, dentro de su propia card (design/arandano.pen, nodo
                `niIY5`/`wiMKE`) — antes era una <table> suelta en la
                pantalla, ahora es el patrón grid + `display:contents` de la
                Task 4 (ver el comentario de `Listado`). */}
            <Listado
              filas={ventas.map((v) => ({
                id: v.id,
                numero: v.numero,
                horaFormateada: formatearHora(v.creadoEn),
                clienteNombre: v.cliente?.nombre ?? CONSUMIDOR_FINAL,
                itemsLabel: v._count.items === 1 ? '1 artículo' : `${v._count.items} artículos`,
                mediosLabel: rotuloDeMedios(v.pagos),
                totalFormateado: formatearPrecio(v.total.toString()),
                anulada: v.anuladaEn !== null,
              }))}
              total={total}
              pagina={pagina}
              paginas={paginas}
              porPagina={POR_PAGINA}
              conPagina={conPagina}
            />
          </div>

          {/* Colgado de que HAYA barras y no de `total > 0`, que es lo que
              gobierna los tiles: un período puede tener ventas y ningún pago
              —todas anuladas— y ahí este panel no tiene nada que decir.
              Dibujarlo vacío sería peor que no dibujarlo: un panel en blanco
              se lee como que algo se rompió. */}
          {composicion.barras.length > 0 && <GraficoDeMedios composicion={composicion} />}
        </div>
      </div>
    </>
  )
}
