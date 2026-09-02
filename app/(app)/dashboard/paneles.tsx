/**
 * Los cuatro paneles de datos del dashboard —"Ventas por día", "Cómo entró
 * la plata", "Ventas por categoría" y "Lo que más se vendió"— más el
 * selector `$ / US$` que los gobierna a los cuatro.
 *
 * Todos reciben la magnitud YA REDUCIDA a la moneda elegida: nada acá suma
 * pesos con dólares, ni convierte una moneda a la otra — es la misma regla
 * que ya rige "Cómo entró la plata" en /ventas (lib/ventas/composicion.ts).
 * `page.tsx` hace las consultas y arma los números; estos componentes sólo
 * formatean y dibujan.
 */
import Link from 'next/link'
import { Anillo, COLORES_DEL_ANILLO, type Gajo } from '@/components/anillo'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { porcentajesQueSuman100 } from '@/lib/ventas/porcentajes'
import { ROTULO_MEDIO, type Composicion, type MonedaElegida } from '@/lib/ventas/medios'
import type { BarraDeDia } from '@/lib/dashboard/tendencia'
import type { FilaDeTop } from '@/lib/dashboard/composicion'
import estilos from './tipografia.module.css'

function formateadorDe(moneda: MonedaElegida): (v: string) => string {
  return moneda === 'usd' ? formatearDolares : formatearPrecio
}

/**
 * El selector `$ / US$` (design/arandano.pen, mismo control que ya usa
 * "Cómo entró la plata" en /ventas). Acá gobierna los CUATRO paneles a la
 * vez —no uno por panel—, así que vive una sola vez en la pantalla y no
 * dentro de cada card.
 *
 * La regla del producto: un local que no usa dólares no ve NINGUNA
 * diferencia con lo que ya conoce — por eso no se dibuja nada sin
 * `hayDolares`, ni siquiera un control deshabilitado.
 *
 * Dos LINKS y no un control de cliente: el estado vive en `?moneda`, como
 * `?rango`, así que el selector funciona sin JavaScript.
 */
export function SelectorDeMoneda({
  hayDolares, moneda, href,
}: {
  hayDolares: boolean
  moneda: MonedaElegida
  /** El link de cada opción, armado por el llamador: este componente no
   *  conoce el resto del query string (`?rango`). */
  href: (m: MonedaElegida) => string
}) {
  if (!hayDolares) return null
  return (
    <div className="flex gap-0.5 rounded-[9px] bg-muted p-[3px]">
      {(['ars', 'usd'] as const).map((m) => (
        <Link
          key={m}
          href={href(m)}
          aria-current={m === moneda ? 'page' : undefined}
          className={
            m === moneda
              ? 'rounded-[8px] bg-card px-[10px] py-1 text-[11px] font-semibold text-foreground shadow-sm'
              : 'rounded-[8px] px-[10px] py-1 text-[11px] font-semibold text-muted-foreground'
          }
        >
          {m === 'ars' ? '$' : 'US$'}
        </Link>
      ))}
    </div>
  )
}

/**
 * El encabezado de card que comparten los cuatro paneles (design/arandano.pen,
 * nodos `Y1sSh`/`Db1MT`): título en `.tituloDeCard` y, opcionalmente, un dato
 * a la derecha (acá sólo lo usa "Ventas por día", para "últimos 14 días").
 */
function EncabezadoDePanel({ titulo, nota }: { titulo: string; nota?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b px-[14px] py-[12px] lg:px-[18px] lg:py-[13px]">
      <h2 className={`${estilos.tituloDeCard} text-foreground`}>{titulo}</h2>
      {nota && <span className="text-[11px] text-muted-foreground">{nota}</span>}
    </div>
  )
}

/**
 * Ventas por día (design/arandano.pen): catorce barras, ventana FIJA —no seg
 * el chip de rango de arriba, ver lib/dashboard/tendencia.ts—. Por eso el
 * encabezado dice "últimos 14 días" SIEMPRE, tenga o no pie: es lo único
 * que evita que alguien lo lea como el período elegido.
 */
export function VentasPorDia({
  barras, pie, moneda,
}: { barras: BarraDeDia[]; pie: string | null; moneda: MonedaElegida }) {
  const formatear = formateadorDe(moneda)
  // El máximo de la ventana, para escalar cada barra a un porcentaje de
  // ALTURA. Con todo en cero (sin ventas en los catorce días) dividir por el
  // máximo sería dividir por cero: la guarda deja las catorce barras en 0%,
  // nunca en NaN.
  const maximo = Math.max(0, ...barras.map((b) => Number(b.monto)))

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <EncabezadoDePanel titulo="Ventas por día" nota="últimos 14 días" />
      <div className="flex flex-col gap-3 p-[14px] lg:p-[18px]">
        <div className="flex h-[165px] items-end gap-1 lg:h-[190px] lg:gap-[7px]">
          {barras.map((b) => {
            const alto = maximo > 0 ? (Number(b.monto) / maximo) * 100 : 0
            return (
              <div key={b.dia} className="flex h-full flex-1 flex-col items-center gap-[7px] lg:gap-2">
                {/* Un track flex-1 y no un alto fijo en la columna: es lo que
                    le da a la barra una base real contra la que
                    `height: N%` sea un porcentaje de verdad, dejándole a la
                    etiqueta su alto propio debajo — sin este track, un
                    `height` en porcentaje no tendría contra qué resolverse. */}
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={
                      b.esMejor
                        ? 'w-full rounded-t-[5px] bg-primary lg:rounded-t-md'
                        : 'w-full rounded-t-[5px] bg-accent lg:rounded-t-md'
                    }
                    style={{ height: `${alto}%` }}
                  />
                </div>
                <span
                  className={
                    b.esMejor
                      ? 'text-[10px] font-semibold text-foreground-soft'
                      : 'text-[10px] text-muted-foreground'
                  }
                >
                  {b.etiqueta}
                </span>
              </div>
            )
          })}
        </div>
        {pie && <p className="text-[11px] text-muted-foreground">{pie}</p>}
        {/* Las barras son puro color y alto relativo: sin esto, quien no ve
            el gráfico se queda sin el monto de cada día — mismo principio
            que la lista sr-only de Anillo (components/anillo.tsx). */}
        <ul className="sr-only">
          {barras.map((b) => (
            <li key={b.dia}>{`${b.etiqueta}: ${formatear(b.monto)}, ${b.ventas} ventas`}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Un `Anillo` que cambia de diámetro por breakpoint sin tocar el componente
 *  congelado de Task 6 —que sólo acepta un número fijo—: se monta dos veces,
 *  una por tamaño, y CSS decide cuál se ve. `display:none` saca del árbol de
 *  accesibilidad al que no corresponde, así que la lista sr-only de Anillo no
 *  se anuncia dos veces. */
function AnilloResponsivo({
  gajos, centro, movil, escritorio,
}: { gajos: Gajo[]; centro: { valor: string; rotulo: string }; movil: number; escritorio: number }) {
  return (
    <>
      <div className="lg:hidden">
        <Anillo gajos={gajos} centro={centro} diametro={movil} />
      </div>
      <div className="hidden lg:block">
        <Anillo gajos={gajos} centro={centro} diametro={escritorio} />
      </div>
    </>
  )
}

/** La leyenda vertical de gajos, compartida por los dos paneles que dibujan
 *  un anillo. El punto de color repite `COLORES_DEL_ANILLO` en el mismo
 *  orden que `arcosDe` —el gajo `i` del anillo y la fila `i` de la leyenda
 *  son el mismo color. */
function Leyenda({ gajos }: { gajos: Gajo[] }) {
  return (
    <ul className="flex w-full flex-col gap-[10px]">
      {gajos.map((g, i) => (
        <li key={g.rotulo} className="flex items-center justify-between gap-3 text-[12px]">
          <span className="flex min-w-0 items-center gap-[7px] text-foreground">
            <span
              aria-hidden="true"
              className="size-[8px] shrink-0 rounded-full"
              style={{ backgroundColor: COLORES_DEL_ANILLO[i % COLORES_DEL_ANILLO.length] }}
            />
            <span className="truncate">{g.rotulo}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-muted-foreground">{g.porcentaje}%</span>
            <span className={`${estilos.archivo} font-semibold text-foreground`}>{g.monto}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Cómo entró la plata (design/arandano.pen): un anillo por medio de pago, ya
 * en la moneda elegida —`composicion` es UNA pila (`ComposicionPorMoneda.ars`
 * o `.usd`), no las dos—. Los medios de pago son a lo sumo cuatro
 * (`lib/ventas/medios.ts`), así que nunca hace falta `repartirEnGajos`: caben
 * los cuatro sin agrupar cola.
 */
export function AnilloDeMedios({
  composicion, moneda,
}: { composicion: Composicion; moneda: MonedaElegida }) {
  const formatear = formateadorDe(moneda)
  const { barras, total } = composicion
  const porcentajes = porcentajesQueSuman100(barras.map((b) => Number(b.monto)), Number(total))
  const gajos: Gajo[] = barras.map((b, i) => ({
    rotulo: ROTULO_MEDIO[b.medio],
    monto: formatear(b.monto),
    porcentaje: porcentajes[i],
  }))

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border bg-card lg:w-[344px] lg:shrink-0">
      <EncabezadoDePanel titulo="Cómo entró la plata" />
      <div className="flex flex-col items-center gap-[18px] p-[14px] lg:p-[18px]">
        {gajos.length > 0 ? (
          <>
            <AnilloResponsivo
              gajos={gajos}
              centro={{ valor: formatear(total), rotulo: 'cobrado' }}
              movil={148}
              escritorio={132}
            />
            <Leyenda gajos={gajos} />
          </>
        ) : (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            Sin cobros en el período.
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Ventas por categoría (design/arandano.pen): un anillo por rama del árbol
 * —ya recortado a cinco gajos por `repartirEnGajos`, que corre en `page.tsx`
 * porque necesita sumar `Decimal` para agregar la cola—. `porCategoria` llega
 * ya en la moneda elegida y con los importes como `string` (la misma
 * convención que `FilaDeTop.importe`): este componente sólo formatea.
 *
 * El centro muestra el gajo más grande DE VERDAD —no el primero de la
 * lista—: la cola "Otros" que agrega `repartirEnGajos` puede terminar
 * pesando más que la rama que quedó primera, si hay muchas ramas chicas.
 */
export function VentasPorCategoria({
  porCategoria, moneda,
}: { porCategoria: { rotulo: string; importe: string }[]; moneda: MonedaElegida }) {
  const formatear = formateadorDe(moneda)
  const total = porCategoria.reduce((acc, c) => acc + Number(c.importe), 0)
  const porcentajes = porcentajesQueSuman100(porCategoria.map((c) => Number(c.importe)), total)
  const gajos: Gajo[] = porCategoria.map((c, i) => ({
    rotulo: c.rotulo,
    monto: formatear(c.importe),
    porcentaje: porcentajes[i],
  }))
  const mayor = porCategoria.length > 0
    ? porCategoria.reduce((max, c) => (Number(c.importe) > Number(max.importe) ? c : max))
    : null

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border bg-card lg:w-[400px] lg:shrink-0">
      <EncabezadoDePanel titulo="Ventas por categoría" />
      <div className="flex flex-col items-center gap-[18px] p-[14px] lg:p-[18px]">
        {mayor ? (
          <>
            <AnilloResponsivo
              gajos={gajos}
              centro={{ valor: formatear(mayor.importe), rotulo: mayor.rotulo }}
              movil={140}
              escritorio={128}
            />
            <Leyenda gajos={gajos} />
          </>
        ) : (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            Todavía no se vendió nada.
          </p>
        )}
      </div>
    </section>
  )
}

/**
 * Una fila de "Lo que más se vendió": puesto, nombre, barra proporcional al
 * PRIMERO (no al total — `topDeArticulos` ya lo documenta: es un ranking, no
 * una composición), unidades e importe.
 *
 * En el teléfono se parte en dos líneas —nombre/importe arriba,
 * barra/unidades abajo—; en escritorio, una sola fila con la barra ocupando
 * el medio (`lg:flex-1`).
 */
function FilaDeTopFila({
  puesto, fila, formatear,
}: { puesto: number; fila: FilaDeTop; formatear: (v: string) => string }) {
  const esPrimero = puesto === 1
  return (
    <div className="flex flex-col gap-[6px] lg:flex-row lg:items-center lg:gap-3">
      <div className="flex items-center justify-between gap-2 lg:flex-1 lg:justify-normal">
        <div className="flex min-w-0 items-center gap-2 lg:w-[170px] lg:shrink-0">
          <span className="w-[14px] shrink-0 text-[12px] font-semibold text-muted-foreground">
            {puesto}
          </span>
          <span className="truncate text-[13px] font-medium text-foreground">{fila.nombre}</span>
        </div>
        {/* El importe se repite en escritorio (más abajo, a la derecha de la
            barra): son dos posiciones de un mismo dato, cada una visible en
            SU ancho — no dos datos distintos. */}
        <span className={`${estilos.archivo} shrink-0 text-[13px] font-semibold text-foreground lg:hidden`}>
          {formatear(fila.importe)}
        </span>
      </div>
      <div className="flex items-center gap-2 lg:flex-1">
        <div className="h-[10px] flex-1 rounded-full bg-muted">
          <div
            className={esPrimero ? 'h-full rounded-full bg-primary' : 'h-full rounded-full'}
            style={
              esPrimero
                ? { width: `${fila.ancho}%` }
                : { width: `${fila.ancho}%`, backgroundColor: 'var(--marca-soft)' }
            }
          />
        </div>
        <span className="w-[46px] shrink-0 text-[11px] text-muted-foreground">{fila.unidades} u.</span>
      </div>
      <span
        className={
          `${estilos.archivo} hidden shrink-0 text-[13px] font-semibold text-foreground ` +
          'lg:block lg:w-[96px] lg:text-right'
        }
      >
        {formatear(fila.importe)}
      </span>
    </div>
  )
}

export function TopDeArticulos({
  filas, moneda,
}: { filas: FilaDeTop[]; moneda: MonedaElegida }) {
  const formatear = formateadorDe(moneda)
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border bg-card lg:flex-1">
      <EncabezadoDePanel titulo="Lo que más se vendió" />
      {filas.length > 0 ? (
        <div className="flex flex-col gap-3 p-[14px] lg:gap-4 lg:p-[18px]">
          {filas.map((f, i) => (
            <FilaDeTopFila key={i} puesto={i + 1} fila={f} formatear={formatear} />
          ))}
        </div>
      ) : (
        <p className="p-[14px] text-center text-[12px] text-muted-foreground lg:p-[18px]">
          Todavía no se vendió nada.
        </p>
      )}
    </section>
  )
}
