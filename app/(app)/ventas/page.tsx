import Link from 'next/link'
import { Calendar, Funnel, ShoppingCart } from 'lucide-react'
import { Prisma } from '@/generated/prisma/client'
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
import { redondearDinero } from '@/lib/ventas/totales'
import {
  lineasDeImporte, vendidoDeVenta, cobradoDePagos, cobradoDeGrupos, type LineaDeImporte,
} from '@/lib/ventas/cobrado'
import {
  ROTULO_MEDIO, CONSUMIDOR_FINAL, monedaValida,
  type Medio, type MonedaElegida, type ComposicionPorMoneda,
} from '@/lib/ventas/medios'
import { agregarPorTiempo, vistaValida, type Vista } from '@/lib/ventas/horarios'
import {
  hoyEnArgentina, inicioDelDia, fechaOhoy, fechaLarga, sumarDias, primerDiaDelMes,
} from '@/lib/formato/fechas'
import { ChipEstado } from './chip-estado'
import { GraficoDeMedios } from './grafico'
import { GraficoDeHorarios } from './horarios'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

/** Los tres accesos rápidos de rango del filtro (design/arandano.pen, nodo `SM9Zl`). */
export const RANGOS = ['hoy', '7dias', 'estemes'] as const
export type Rango = (typeof RANGOS)[number]

export const ROTULO_RANGO: Record<Rango, string> = {
  hoy: 'Hoy',
  '7dias': '7 días',
  estemes: 'Este mes',
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
 *
 * Suma `total`, `recargo` y `totalUsd` porque el llamador arma con los tres la
 * magnitud "Vendido" del tile (`total`/`totalUsd`, la mercadería a precio de
 * lista) y el argumento `recargo` de `hayQueDesglosar`. **Lo COBRADO no sale
 * de acá**: sale de `pagosDelPeriodo`, más abajo, porque la plata que entró se
 * apila por la moneda de cada pago y esta tabla no la conoce.
 */
export function totalDelPeriodo(
  prisma: ReturnType<typeof prismaParaTenant>,
  donde: FiltroDePeriodo,
) {
  return prisma.venta.aggregate({
    where: { ...donde, anuladaEn: null },
    _sum: { total: true, recargo: true, totalUsd: true },
  })
}

/**
 * Los pagos del período agrupados por moneda e importe, de un lado o del otro
 * de la anulación.
 *
 * Es la fuente de las dos cifras de "Cobrado" del tile: la del período
 * (`anuladas = false`) y la devuelta (`anuladas = true`).
 *
 * **Exportada y parametrizada a propósito, y no reusando el `groupBy` que ya
 * alimenta "Cómo entró la plata"**, que selecciona exactamente las mismas
 * filas del lado de las no anuladas. Ese `groupBy` está inline en el
 * componente de página —un Server Component `async` que abre sesión—, así que
 * ningún test lo puede llamar, y su `anuladaEn: null` quedaría tan
 * desprotegido como el que el hallazgo I3 de la review del rediseño mostró que
 * se podía borrar dejando 785 tests en verde. La regla "una venta anulada no
 * es plata que entró" tiene que vivir donde la base efímera la pueda
 * ejercitar; es el mismo motivo por el que `totalDelPeriodo` se extrajo.
 *
 * Las dos consultas no pueden desacordar con el panel: la suma de `monto` por
 * moneda es idéntica se agrupe por `['moneda','monto']` o por
 * `['medio','moneda','cotizacion','monto']` —agrupar por más columnas refina
 * los grupos, no cambia la suma— y la cláusula `where` es la misma.
 *
 * `monto` va en la CLAVE con `_count`, y no en un `_sum`, por lo mismo que ya
 * documenta `FilaDePagos` en lib/ventas/composicion.ts: es lo que mantiene el
 * redondeo POR PAGO. Con `_sum` el tile y el panel se separaban por centavos
 * en la misma pantalla.
 *
 * `groupBy` y no `$queryRaw`: la extensión de lib/tenant/prisma.ts intercepta
 * operaciones de MODELO, y un raw sin el `set_config('arandano.tenant_id')`
 * devuelve cero filas EN SILENCIO.
 */
export function pagosDelPeriodo(
  prisma: ReturnType<typeof prismaParaTenant>,
  donde: FiltroDePeriodo,
  anuladas: boolean,
) {
  return prisma.pago.groupBy({
    by: ['moneda', 'monto'],
    where: { venta: { ...donde, anuladaEn: anuladas ? { not: null } : null } },
    _count: true,
  })
}

/**
 * El pie del tile "Ventas cobradas": el promedio por venta cobrada.
 *
 * `cobradoArs` es lo COBRADO EN PESOS —`Σ Pago.monto` de los pagos en pesos,
 * el mismo número que arma `cobradoPeriodo.ars` para el tile de al lado
 * (`pagosDelPeriodo`, más arriba)— y no la mercadería ni `total + recargo`:
 * las dos plata de la misma pantalla tienen que contestar la misma pregunta
 * ("cuánta plata entró"), y desde que un pago en pesos puede cubrir el total
 * en dólares, `total + recargo` dejó de ser esa respuesta.
 *
 * `undefined` y no `NaN` cuando no hubo ninguna cobrada — un período puede
 * anularse entero, y "promedio $ NaN" es peor que no mostrar ningún pie: ver
 * el mismo criterio en `hayFaltanteDeVenta` de punto-de-venta.tsx.
 *
 * **Y `undefined` también cuando lo cobrado EN PESOS es CERO y el período
 * COBRÓ algo en dólares** (`hayDolaresCobrados`): el local que pidió esta
 * feature carga todo su catálogo en dólares y cobra en dólares, así que
 * `cobradoArs` es cero en todas sus ventas — el pie decía `promedio $ 0,00`
 * al lado de un tile que decía `US$ 3.000,00`, o sea afirmaba lo contrario de
 * lo que el tile de al lado mostraba. Un tile sin pie OMITE; un
 * `promedio $ 0,00` AFIRMA, y afirma algo falso — es el mismo modo de falla
 * que ya se corrigió una vez en este ciclo (una línea rotulada con un número
 * que no es el que dice ser). La guarda pregunta "¿se COBRÓ algo en
 * dólares?" y no "¿se VENDIÓ algo en dólares?": lo que el pie podría estar
 * afirmando en falso es sobre plata que entró, no sobre mercadería. Efecto
 * de paso: el período del feedback (una venta en dólares cobrada en pesos)
 * pasa de omitir el pie a decir un promedio real, porque ahí sí entró algo
 * en pesos.
 *
 * Se omite y no se agrega una segunda línea en dólares, que era la otra
 * salida: el promedio en dólares sería `sumaUsd / cobradas`, y en un período
 * MIXTO ese denominador incluye las ventas que no movieron un solo dólar —
 * un cuarto número derivado, en 10px, debajo de un conteo. La regla del
 * ciclo es que fuera de una venta no hay conversión ni número inventado, y
 * acá el número honesto es ninguno.
 *
 * `cobradoArs` en cero SIN dólares cobrados en el período sigue mostrando el
 * pie: ahí `promedio $ 0,00` es cierto.
 */
export function pieDeCobradas(
  cobradoArs: string, cobradas: number, hayDolaresCobrados: boolean,
): string | undefined {
  if (cobradas <= 0) return undefined
  if (hayDolaresCobrados && new Prisma.Decimal(cobradoArs).isZero()) return undefined
  const promedio = redondearDinero(new Prisma.Decimal(cobradoArs).div(cobradas))
  return `promedio ${formatearPrecio(promedio.toString())}`
}

/**
 * El pie del tile "Anuladas": lo DEVUELTO, no el total del período de al
 * lado — dos números independientes, cada uno su propia llamada a
 * `pagosDelPeriodo` (más arriba) con `anuladas` en `false`/`true`: el tile de
 * al lado suma los pagos de las ventas NO anuladas, éste los de las SÍ
 * anuladas. Mezclarlos sería el mismo bug que ya evita `crearVenta` al no
 * reutilizar sumas.
 *
 * `devueltoArs` es `Σ Pago.monto` EN PESOS de esos pagos, no `total +
 * recargo`: `Pago.monto` ya incluye el recargo (`lib/ventas/crear.ts`), así
 * que lo que se anuló —una venta en 3 cuotas que se anula da de baja también
 * el recargo de esa financiación, no sólo el precio de lista— ya viene sumado
 * en el número que entrega `pagosDelPeriodo`, sin que este pie tenga que
 * sumarlo aparte.
 *
 * `undefined` cuando lo devuelto en pesos es cero y las anuladas DEVOLVIERON
 * dólares (`hayDolaresDevueltos`) — mismo criterio y misma razón que
 * `pieDeCobradas`: `$ 0,00 devueltos` sobre una venta anulada de US$ 300 no
 * es una omisión, es una afirmación falsa. La guarda pregunta "¿se devolvió
 * algo en dólares?" y no "¿se vendió algo en dólares?", por el mismo motivo
 * que en `pieDeCobradas`. Efecto de paso: una venta en dólares cobrada en
 * pesos que se anula pasa de omitir el pie a decir un monto devuelto real.
 */
export function pieDeAnuladas(devueltoArs: string, hayDolaresDevueltos: boolean): string | undefined {
  if (hayDolaresDevueltos && new Prisma.Decimal(devueltoArs).isZero()) return undefined
  return `${formatearPrecio(devueltoArs)} devueltos`
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
 * La moneda que el panel "Cómo entró la plata" TERMINA mostrando — con
 * fallback a la pila que sí tiene barras cuando la pedida está vacía EN ESTE
 * PERÍODO.
 *
 * **Arreglo de Ruling H (review de Task 3).** Sin este fallback, un local
 * que sólo cobró en dólares un día en que `?moneda` sigue en su default
 * 'ars' —o un local que eligió US$ y navegó (Ruling G) a un período sin un
 * solo pago en dólares— veía el panel entero: título, selector, nota al pie,
 * y CERO barras. El gate que decide SI se dibuja el panel
 * (`ars.barras.length > 0 || usd.barras.length > 0`, en el componente de
 * página) sólo contesta esa pregunta; no dice CUÁL de las dos pilas mostrar,
 * y las dos pueden contestarse distinto.
 *
 * Devuelve la MONEDA, no la pila, porque el llamador necesita las dos cosas
 * por separado: la pila para `composicion` y la moneda —la efectiva, no la
 * pedida— para la prop `moneda` de `GraficoDeMedios`, que es lo que decide
 * qué opción del selector queda resaltada como activa y con qué formateador
 * se leen los montos. Pasarle la pedida en vez de la efectiva dejaría el
 * selector marcando una moneda con las barras mostrando la otra.
 *
 * **No es la que viaja en la URL.** `?moneda` (la pedida) sigue intacta para
 * el resto de la navegación (Ruling G): este fallback es sólo para ESTE
 * render, no una corrección de la preferencia — un local que eligió US$ y
 * navega a un período sin dólares vuelve a ver US$ apenas entra a un período
 * que sí los tenga.
 */
export function monedaEfectiva(
  composicion: ComposicionPorMoneda, moneda: MonedaElegida,
): MonedaElegida {
  const pilaPedida = moneda === 'usd' ? composicion.usd : composicion.ars
  if (pilaPedida.barras.length > 0) return moneda
  return moneda === 'usd' ? 'ars' : 'usd'
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
 *
 * `lineas` es una sola —el número solo de siempre, y así se ven los dos tiles
 * de conteo— o las dos del desglose "Vendido"/"Cobrado" (ver `lineasDeImporte`
 * en lib/ventas/cobrado.ts). Las dos se dibujan al MISMO tamaño, apoyándose en
 * la regla que este componente ya tenía escrita para las monedas: ninguna pesa
 * más que la otra en esta pantalla, así que ninguna se dibuja más chica —
 * tampoco pesa más lo vendido que lo cobrado.
 *
 * `design/arandano.pen` no dibuja ningún tile con rótulos de línea: es
 * anterior a este ciclo. Anotado en docs/correcciones-pendientes-del-pen.md,
 * entrada 25.
 */
export function Tile({
  rotulo, lineas, pie, marca = false,
}: { rotulo: string; lineas: LineaDeImporte[]; pie?: string; marca?: boolean }) {
  // Paddings y tamaños mobile-first: el teléfono (`nwW2V`) achica el padding
  // y la Valor respecto de lo que ya declaraba escritorio, así que el valor
  // sin prefijo es el del teléfono y `lg:` restaura los números de siempre —
  // el escritorio no puede cambiar de aspecto (mG0u7: padding [15,17], Valor
  // 30px; H6aISK/a7MuT: padding [14,15], Valor 24px).
  if (marca) {
    // La misma clase para las líneas de plata: ninguna moneda ni magnitud
    // pesa más que la otra en esta pantalla, así que ninguna se dibuja más
    // chica — mismo criterio que `estilos.total` en el pie de cobro de
    // /vender (punto-de-venta.tsx), que tampoco distingue tamaño entre la
    // línea de pesos y la de dólares.
    const claseValor = `${estilos.archivo} text-[30px] leading-none font-semibold tracking-[-0.6px] tabular-nums lg:text-[32px]`
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
        <div className="flex flex-col gap-0.5">
          {lineas.map((l) => (
            <div key={l.rotulo ?? '—'} className="flex flex-col">
              {l.rotulo && (
                <div
                  className="text-[10px] font-bold tracking-[1px] uppercase lg:tracking-[1.2px]"
                  style={{ color: 'var(--marca-dim)' }}
                >
                  {l.rotulo}
                </div>
              )}
              <div style={{ color: 'var(--marca-foreground)' }} className={claseValor}>
                {l.valor}
              </div>
            </div>
          ))}
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
      {lineas.map((l) => (
        <div key={l.rotulo ?? '—'} className="flex flex-col">
          {l.rotulo && (
            <div className="text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase lg:tracking-[1.2px]">
              {l.rotulo}
            </div>
          )}
          <div
            className={`${estilos.archivo} text-[24px] leading-none font-semibold tracking-[-0.6px] tabular-nums text-foreground lg:text-[26px]`}
          >
            {l.valor}
          </div>
        </div>
      ))}
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
 *
 * Lleva `vista` como campo oculto (Hallazgo 4 de la review final): sin esto,
 * filtrar por fecha estando en la vista Día del panel de horarios volvía a
 * Hora en silencio, exactamente el argumento que ya vale para los links de
 * rango y de página (ver "preserva la vista" en la consulta de más abajo) —
 * tocar el filtro de fechas no puede devolver el panel a su default sin que
 * nadie lo pida, y éste es justo el camino principal para elegir un rango
 * propio. Un solo `<input type="hidden">` en el componente compartido cubre
 * sus dos ubicaciones de una.
 *
 * Y por el mismo motivo, `moneda` (Task 3 del ciclo del dashboard): un local
 * mirando el panel de medios en US$ que filtra por fecha no puede volver a
 * pesos sin que nadie lo haya pedido — el filtro de fechas es un cambio de
 * PERÍODO, no de moneda.
 */
function FormularioDeFechas({
  dDesde, dHasta, vista, moneda, apilado = false,
}: { dDesde: string; dHasta: string; vista: Vista; moneda: MonedaElegida; apilado?: boolean }) {
  return (
    <form
      method="get"
      className={apilado ? 'flex flex-col gap-3' : 'hidden items-end gap-[10px] lg:flex'}
    >
      {/* Sólo cuando no es la default: un formulario que siempre mandara
          `vista=hora` no cambiaría nada en la práctica, pero ensuciaría la
          URL de cualquiera que ya esté en Hora. Mismo criterio que
          `conPagina`/`hrefRango`/`hrefDeVista`, más abajo. */}
      {vista !== 'hora' && <input type="hidden" name="vista" value={vista} />}
      {moneda !== 'ars' && <input type="hidden" name="moneda" value={moneda} />}
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
  /** Un renglón, o los dos del desglose Vendido/Cobrado — ya resueltos a
   *  texto por `lineasDeImporte()` en el llamador, para que `Listado` no
   *  reciba ningún `Decimal` de Prisma. */
  totalLineas: LineaDeImporte[]
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
 * contenedor  grid grid-cols-1 lg:grid-cols-[84px_110px_1fr_168px_280px_104px]
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
          <div role="table" className="grid grid-cols-1 lg:grid-cols-[84px_110px_1fr_168px_280px_104px]">
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
                    hijos vuelven a ser las celdas Total (280px) y Estado
                    (104px). Total pasó de 140px a 280px: con el desglose
                    Vendido/Cobrado, "$ 155.000,00 + US$ 200,00" no entraba y
                    se partía en dos renglones. El ancho salió de `Cliente`,
                    que es `1fr` y venía quedándose con ~1.150px vacíos. */}
                <div className="flex flex-col items-end gap-1.5 lg:contents">
                  <div
                    role="cell"
                    className={`${estilos.archivo} text-[15px] font-semibold text-foreground tabular-nums lg:border-b lg:p-[11px] lg:px-[7px] lg:text-sm lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}
                  >
                    {/* `lg:items-stretch` para que cada línea ocupe el ancho
                        de la celda y el importe pueda irse al borde derecho.
                        Sin él los hijos encogen a su contenido y `ml-auto` no
                        tendría contra qué empujar. */}
                    <div className="flex flex-col items-end lg:h-full lg:items-stretch lg:justify-center">
                      {f.totalLineas.map((l) => (
                        <div
                          key={l.rotulo ?? '—'}
                          /* Apilado en el teléfono —es lo único que entra a
                             390px— y en línea en escritorio: el rótulo a la
                             izquierda, el importe a la derecha. Con eso una
                             fila desglosada mide dos renglones y no cuatro,
                             y deja de medir el doble que sus vecinas. */
                          className="flex flex-col items-end lg:flex-row lg:items-baseline lg:gap-3"
                        >
                          {/* El rótulo NO hereda el 15px semibold tabular de
                              la celda: se lo pisa explícito. 10px y no 9px:
                              es el mismo rol de rótulo que ya paga el tile
                              chico de arriba, uno que
                              docs/sistema-de-diseno.md ya documenta — un 9px
                              sería un escalón nuevo de la pila que ningún
                              test puede sostener (test/tipografia.test.ts
                              sólo ata los roles con font-stretch, o sea las
                              caras Archivo). */}
                          {l.rotulo && (
                            <span className="text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                              {l.rotulo}
                            </span>
                          )}
                          {/* `ml-auto` y no `justify-between` en el padre:
                              una línea SIN rótulo tiene un solo hijo, y
                              `justify-between` la dejaría a la IZQUIERDA —
                              que es justo el caso común de esta columna. */}
                          <span className="lg:ml-auto">{l.valor}</span>
                        </div>
                      ))}
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
  searchParams: Promise<{ desde?: string; hasta?: string; p?: string; vista?: string; moneda?: string }>
}) {
  const sesion = await exigirSesion()
  const { desde, hasta, p = '1', vista: vistaParam, moneda: monedaParam } = await searchParams

  const hoy = hoyEnArgentina()
  // Una fecha malformada cae en hoy en vez de romper el `new Date`, igual que
  // el clamp de `?p` del listado de inventario: un query string escrito a mano
  // no puede servir un 500.
  const dDesde = fechaOhoy(desde, hoy)
  const dHasta = fechaOhoy(hasta, hoy)
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const vista = vistaValida(vistaParam)
  const moneda = monedaValida(monedaParam)

  const donde = {
    creadoEn: {
      gte: inicioDelDia(dDesde),
      // El día "hasta" entra entero: se corta al inicio del siguiente.
      lt: new Date(inicioDelDia(dHasta).getTime() + 24 * 60 * 60 * 1000),
    },
  }

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [ventas, total, suma, anuladas, pagos, ventasDelPeriodo, pagosCobrados, pagosDevueltos] =
    await Promise.all([
    prisma.venta.findMany({
      where: donde,
      orderBy: { numero: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        // `recargo` entra al select para la columna Total: no se puede sumar
        // el recargo pago por pago acá —sería exactamente el join de pagos
        // que la columna evita, y para eso está el caché en `Venta.recargo`
        // (CLAUDE.md, "El costo del movimiento" — mismo criterio que
        // `Articulo.stock` contra sus movimientos). `totalUsd` (Task 11)
        // entra por lo mismo, para la mitad en dólares de la misma columna.
        id: true, numero: true, total: true, recargo: true, creadoEn: true, anuladaEn: true, totalUsd: true,
        cliente: { select: { nombre: true } },
        // orderBy explícito: rotuloDeMedios() documenta "en el orden en que
        // se cobraron", y sin esto Postgres no promete ningún orden — el
        // resultado podía coincidir con la inserción por accidente, no por
        // contrato.
        pagos: { select: { medio: true, moneda: true, monto: true }, orderBy: { creadoEn: 'asc' } },
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
    // Los pagos del período, para el panel de composición. Se filtran por la
    // VENTA y no por `pago.creadoEn`: es el mismo `donde` que el listado y que
    // los tiles, así que las tres cosas de la pantalla no pueden hablar de
    // períodos distintos.
    //
    // Decisión del ciclo de precios por forma de pago, dejada explícita
    // porque no es obvia mirando sólo este archivo: `Pago.monto` YA es
    // `base + recargo` (`lib/ventas/crear.ts`) — no `Venta.total`, que es
    // sólo mercadería. Este panel suma `monto`, así que "Cómo entró la plata"
    // muestra la plata REAL que entró por cada medio, recargo incluido.
    //
    // **La costura con el tile "Total del período" ya cerró del todo (Task 3
    // del ciclo del dashboard).** Hasta acá, el tile armaba "Cobrado" con
    // `Σ Pago.monto` apilado por `Pago.moneda` —sin convertir— mientras este
    // panel SÍ convertía cada pago a pesos con `Pago.cotizacion`, para poder
    // comparar una barra contra la de al lado. Esa conversión no era sólo una
    // diferencia de criterio con el tile: era un defecto propio. `Pago.cotizacion`
    // vale 1 cuando el pago no cruza monedas (`cotizacionParaElCruce`,
    // app/(app)/vender/punto-de-venta.tsx), así que un iPhone de US$ 300 pagado
    // con 300 dólares en efectivo aportaba **300** al largo de la barra en vez
    // de los ~445.500 que representa — para un local que cobra en dólares en
    // efectivo, todas las barras quedaban cerca de cero y el "N % del total" no
    // decía nada real.
    //
    // `componerPorMedio` (lib/ventas/composicion.ts) ya no convierte: separa
    // en DOS pilas por `Pago.moneda` y ninguna cotización entra en la cuenta,
    // así que ahora coincide con el tile en las dos superficies:
    //
    //   tile  "Total del período"  → Vendido US$ 300,00 / Cobrado $ 623.700,00
    //   panel "Cómo entró la plata" (US$) → Crédito US$ 300,00 · 100 %
    //
    // `groupBy` y no `$queryRaw` con un `SUM(monto)` agrupado, que sería la
    // consulta obvia: la extensión de lib/tenant/prisma.ts intercepta
    // operaciones de MODELO, no raw queries, así que un raw no lleva el
    // `set_config('arandano.tenant_id')` y RLS lo devuelve VACÍO. No falla:
    // devuelve cero filas, que en un panel de plata se lee como "no vendiste
    // nada". La suma por pila se hace en JS sobre estas pocas filas.
    // `monto` va en la clave y se cuenta en vez de sumarse: es lo que mantiene
    // el redondeo POR PAGO, igual que `totalDePagos`. Con `_sum` el panel y el
    // tile "Total del período" se separaban por centavos. Ver composicion.ts.
    prisma.pago.groupBy({
      by: ['medio', 'moneda', 'cotizacion', 'monto'],
      where: { venta: { ...donde, anuladaEn: null } },
      _count: true,
    }),
    // Las fechas de las ventas del período, para "Cuándo vende el local".
    // Sólo `creadoEn`: una columna de timestamps, no filas completas. La
    // agregación por hora y por día se hace en JS (lib/ventas/horarios.ts) —
    // ni Prisma sabe agrupar por hora, ni un `$queryRaw` con `date_trunc`
    // llevaría el `set_config('arandano.tenant_id')` que RLS necesita, y sin
    // él devolvería cero filas EN SILENCIO (mismo motivo que el comentario
    // del `groupBy` de pagos, arriba).
    //
    // Sin techo de filas, con el motivo escrito — y esta anotación cubre a
    // las TRES consultas de este Promise.all que no lo tienen, para no
    // repetirla en cada una: el `groupBy` de pagos de arriba (el panel de
    // medios), ésta, y las dos `pagosDelPeriodo` de más abajo. Son ~1.400
    // filas en un mes de un local activo, y el `count` de arriba ya recorre
    // el mismo conjunto que el listado. Con un rango largo tipeado a mano
    // (`?desde=2020-01-01`) las tres devolverían tantas filas como pagos o
    // ventas haya en el período —decenas de miles—: son lo primero a mirar
    // si esta pantalla se pone lenta.
    prisma.venta.findMany({
      where: { ...donde, anuladaEn: null },
      select: { creadoEn: true },
    }),
    // Las dos mitades del "Cobrado": la plata que entró en el período y la que
    // se devolvió al anular. Ver el docblock de pagosDelPeriodo para por qué
    // no se reusa el groupBy del panel de medios.
    pagosDelPeriodo(prisma, donde, false),
    pagosDelPeriodo(prisma, donde, true),
  ])

  const composicion = componerPorMedio(pagos)
  const horarios = agregarPorTiempo(ventasDelPeriodo.map((v) => v.creadoEn), vista)
  // Las dos magnitudes del período. "Vendido" sale de `Venta` (la mercadería a
  // precio de lista, en sus dos monedas); "Cobrado" sale de `Pago`, apilado
  // por la moneda en que se entregó cada uno. Nada se convierte: son cuatro
  // números y ninguna cotización los cruza.
  const vendidoPeriodo = vendidoDeVenta({
    total: suma._sum.total ?? new Prisma.Decimal(0),
    totalUsd: suma._sum.totalUsd ?? new Prisma.Decimal(0),
  })
  const recargoPeriodo = suma._sum.recargo ?? new Prisma.Decimal(0)
  const cobradoPeriodo = cobradoDeGrupos(pagosCobrados)
  // Lo devuelto por las anuladas: sólo alimenta el pie del tile de anuladas,
  // que muestra un conteo y no plata, así que esta cifra no tiene una segunda
  // línea donde aparecer.
  const devueltoPeriodo = cobradoDeGrupos(pagosDevueltos)
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  // `moneda` viaja en las CUATRO — conPagina, hrefRango, hrefDeVista y
  // hrefDeMoneda—, no sólo en la propia: mismo argumento que ya vale para
  // `vista` (un local mirando el panel en US$ no puede volver a pesos por
  // pasar de página, tocar un chip de rango o cambiar Hora/Día sin pedirlo),
  // y el mismo criterio de no escribirla cuando es la default ('ars') — un
  // link que siempre mandara `moneda=ars` no cambiaría nada en la práctica
  // pero ensuciaría la URL de cualquier local que nunca toca dólares.
  const conPagina = (n: number) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (n > 1) u.set('p', String(n))
    if (vista !== 'hora') u.set('vista', vista)
    if (moneda !== 'ars') u.set('moneda', moneda)
    return `/ventas?${u.toString()}`
  }
  const hrefRango = (r: Rango) => {
    const { desde: d, hasta: h } = rangoDeChip(r, hoy)
    const u = new URLSearchParams({ desde: d, hasta: h })
    if (vista !== 'hora') u.set('vista', vista)
    if (moneda !== 'ars') u.set('moneda', moneda)
    return `/ventas?${u.toString()}`
  }
  // Al cambiar de vista SÍ se pierde `?p` (a propósito): la vista no cambia el
  // listado, pero cambiar de vista es un gesto de mirar el panel, y volver a
  // la página 1 es lo que hace que el listado y el panel hablen de lo mismo
  // al leerlos juntos.
  const hrefDeVista = (v: Vista) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (v !== 'hora') u.set('vista', v)
    if (moneda !== 'ars') u.set('moneda', moneda)
    return `/ventas?${u.toString()}`
  }
  // El selector $ / US$ de "Cómo entró la plata": preserva el resto del
  // filtro —desde/hasta, página y vista— igual que conPagina/hrefRango, y no
  // escribe `moneda` cuando es la default ('ars'), mismo criterio que el
  // resto de estos helpers con SU propio parámetro.
  const hrefDeMoneda = (m: MonedaElegida) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (pagina > 1) u.set('p', String(pagina))
    if (vista !== 'hora') u.set('vista', vista)
    if (m !== 'ars') u.set('moneda', m)
    return `/ventas?${u.toString()}`
  }
  const rangoVigente = chipActivo(dDesde, dHasta, hoy)
  const cobradas = total - anuladas
  // La pila que el panel dibuja: nada se convierte entre las dos, así que la
  // pantalla no tiene un "total" único que ofrecer — sólo la mitad que
  // `?moneda` eligió, CON el fallback de `monedaEfectiva()` (ver su
  // docblock, Ruling H de la review de Task 3) cuando esa mitad está vacía
  // en este período.
  const monedaMostrada = monedaEfectiva(composicion, moneda)
  const composicionElegida = monedaMostrada === 'usd' ? composicion.usd : composicion.ars

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
          <FormularioDeFechas dDesde={dDesde} dHasta={dHasta} vista={vista} moneda={moneda} />
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
                <FormularioDeFechas dDesde={dDesde} dHasta={dHasta} vista={vista} moneda={moneda} apilado />
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
                  lineas={lineasDeImporte(vendidoPeriodo, cobradoPeriodo, recargoPeriodo)}
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
                    lineas={[{ valor: formatearCantidad(String(cobradas)) }]}
                    pie={pieDeCobradas(cobradoPeriodo.ars.toString(), cobradas, !cobradoPeriodo.usd.isZero())}
                  />
                  <Tile
                    rotulo="Anuladas"
                    lineas={[{ valor: formatearCantidad(String(anuladas)) }]}
                    pie={pieDeAnuladas(devueltoPeriodo.ars.toString(), !devueltoPeriodo.usd.isZero())}
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
                // Las dos magnitudes de la venta: la mercadería a precio de
                // lista (`vendidoDeVenta`) y la plata que entró, apilada por
                // la moneda en que se entregó (`cobradoDePagos`). Un renglón
                // cuando coinciden —toda venta en pesos sin plan—, dos
                // rotulados cuando no. Nada se convierte.
                //
                // Una venta ANULADA con plan sigue desglosando acá —"Vendido
                // $ 50.000 / Cobrado $ 70.000" al lado del chip "Anulada"—, y
                // se deja así a propósito, no es un efecto colateral: el chip
                // ya desambigua, y ese número es lo que se cobró ANTES de
                // anular, que es justo lo que este historial tiene que poder
                // responder ("Las anuladas se MUESTRAN", más abajo).
                totalLineas: lineasDeImporte(vendidoDeVenta(v), cobradoDePagos(v.pagos), v.recargo),
                anulada: v.anuladaEn !== null,
              }))}
              total={total}
              pagina={pagina}
              paginas={paginas}
              porPagina={POR_PAGINA}
              conPagina={conPagina}
            />
          </div>

          {/* Colgado de que HAYA barras en ALGUNA de las dos pilas y no de
              `total > 0`, que es lo que gobierna los tiles: un período puede
              tener ventas y ningún pago —todas anuladas— y ahí este panel no
              tiene nada que decir. Dibujarlo vacío sería peor que no
              dibujarlo: un panel en blanco se lee como que algo se rompió. */}
          {(composicion.ars.barras.length > 0 || composicion.usd.barras.length > 0) && (
            <GraficoDeMedios
              composicion={composicionElegida}
              hayDolares={composicion.hayDolares}
              moneda={monedaMostrada}
              hrefDeMoneda={hrefDeMoneda}
            />
          )}
        </div>

        {/* Cuándo vende el local (design/arandano.pen, nodo `t93if9`): a todo
            el ancho, debajo de la fila. Colgado de `total > 0` como los
            tiles y no de que haya ventas no anuladas: un período con todas
            las ventas anuladas SÍ dibuja el panel, y su pie dice que no hubo
            ninguna — que es información, no un panel roto. */}
        {total > 0 && <GraficoDeHorarios horarios={horarios} vista={vista} href={hrefDeVista} />}
      </div>
    </>
  )
}
