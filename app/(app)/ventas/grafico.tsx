// SIN 'use client'. La versión anterior lo necesitaba porque recharts mide el
// contenedor del lado del navegador; esta —una lista de barras con un ancho en
// porcentaje— no mide nada: el servidor ya sabe el ancho final. Que este
// archivo se pueda borrar de la lista de componentes cliente es justamente la
// simplificación que motiva el cambio, no un efecto secundario.
import { Info } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { porcentajesQueSuman100 } from '@/lib/ventas/porcentajes'
import { ROTULO_MEDIO, type Composicion, type MonedaElegida } from '@/lib/ventas/medios'
import estilos from './tipografia.module.css'

/**
 * Cómo entró la plata del período, por medio de pago (design/arandano.pen,
 * nodo `eyqV3`), UNA MONEDA POR VEZ.
 *
 * **Esto ARREGLA un defecto que estuvo en producción, no es una feature.** La
 * versión anterior mezclaba pesos y dólares en una sola barra, convirtiendo
 * cada pago con `Pago.cotizacion` — que vale 1 cuando el pago no cruza
 * monedas (`cotizacionParaElCruce`, app/(app)/vender/punto-de-venta.tsx), así
 * que un pago de US$ 300 en efectivo aportaba 300 al largo de la barra en vez
 * de los ~445.500 que representa. Para un local que cobra en dólares en
 * efectivo, todas las barras quedaban cerca de cero y el "N % del total" no
 * decía nada real. `componerPorMedio` (lib/ventas/composicion.ts) ya no
 * convierte: separa en dos pilas por `Pago.moneda`, y este componente dibuja
 * UNA de las dos a la vez.
 *
 * Un solo color por barra —`--primary`, vía el `Progress` de shadcn—, igual
 * que antes: la maqueta nunca pidió una segunda serie (ver
 * `docs/sistema-de-diseno.md`, sección "Cómo se verifica").
 *
 * El selector `$ / US$` sólo se dibuja **si hubo pagos en dólares en el
 * período** (`hayDolares`): un local que nunca cobró en dólares no puede ver
 * un control que elige entre dos pilas cuando una de las dos siempre está
 * vacía — mismo principio que ya rige el resto de esta pantalla ("un local
 * que no usa dólares no ve ninguna diferencia", CLAUDE.md). Son dos LINKS y
 * no un control de cliente: el estado vive en `?moneda`, como el resto de los
 * filtros de esta pantalla (`?rango`, `?vista`), así que el panel funciona sin
 * JavaScript.
 *
 * Y sin tabla `sr-only` de respaldo: la versión con recharts la necesitaba
 * porque el SVG no existe hasta que el cliente hidrata. Acá el texto ES el
 * contenido — no hay nada que un lector de pantalla o un navegador sin
 * JavaScript se pierdan.
 */
export function GraficoDeMedios({
  composicion, hayDolares, moneda, hrefDeMoneda,
}: {
  composicion: Composicion
  hayDolares: boolean
  moneda: MonedaElegida
  /** El link de cada opción del selector, armado por la pantalla: este
   *  componente no conoce el resto del query string. */
  hrefDeMoneda: (m: MonedaElegida) => string
}) {
  const { barras, total } = composicion
  const formatear = moneda === 'ars' ? formatearPrecio : formatearDolares
  const porcentajes = porcentajesQueSuman100(barras.map((b) => Number(b.monto)), Number(total))

  return (
    // Ancho completo en el teléfono —el `.pen` no dibuja un panel angosto ahí,
    // el panel ocupa todo el ancho del cuerpo apilado— y recién a partir de
    // `lg:` (donde el contenedor pasa a `flex-row`, ver page.tsx) se fija en
    // 344px con `lg:shrink-0`, igual que su equivalente de /ventas/[id]
    // (`lg:w-[324px] lg:shrink-0`): sin esto, un vecino ancho en el mismo row
    // flex podía angostar este panel por debajo de sus 344px de diseño.
    <section className="flex w-full flex-col overflow-hidden rounded-2xl border bg-card lg:w-[344px] lg:shrink-0">
      <div className="flex items-center justify-between gap-2 border-b px-[18px] py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cómo entró la plata</h2>
        {hayDolares && (
          <div className="flex gap-0.5 rounded-[9px] bg-muted p-[3px]">
            {(['ars', 'usd'] as const).map((m) => (
              <a
                key={m}
                href={hrefDeMoneda(m)}
                aria-current={m === moneda ? 'page' : undefined}
                className={
                  m === moneda
                    ? 'rounded-[8px] bg-card px-[10px] py-1 text-[11px] font-semibold text-foreground shadow-sm'
                    : 'rounded-[8px] px-[10px] py-1 text-[11px] font-semibold text-muted-foreground'
                }
              >
                {m === 'ars' ? '$' : 'US$'}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-[18px] p-[18px]">
        {barras.map((b, i) => (
          <div key={b.medio} className="flex flex-col gap-[7px]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground">
                {ROTULO_MEDIO[b.medio]}
              </span>
              <span className={`${estilos.archivo} text-[13px] font-semibold text-foreground`}>
                {formatear(b.monto)}
              </span>
            </div>
            <Progress value={porcentajes[i]} className="h-[10px] bg-muted" />
            <span className="text-[11px] text-muted-foreground">
              {porcentajes[i]}% del total
            </span>
          </div>
        ))}
        <div className="flex gap-2 rounded-[10px] bg-background p-[11px]">
          <Info aria-hidden="true" className="size-[14px] shrink-0 text-muted-foreground" />
          <p className="text-[11px] leading-[1.4] text-muted-foreground">
            Cada moneda dice su propio número. Nada se convierte: no hay tipo
            de cambio guardado en una venta cobrada en dólares.
          </p>
        </div>
      </div>
    </section>
  )
}
