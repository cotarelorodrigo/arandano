'use client'

import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatearPrecio } from '@/lib/formato/mostrar'
// Desde ./medios y NO desde ./composicion, que importa Prisma: este archivo es
// un componente cliente, y lo que importa viaja en el bundle del navegador.
// Ver el encabezado de lib/ventas/medios.ts — el build de producción falla, y
// ni el typecheck ni los tests lo ven.
import { ROTULO_MEDIO, type Composicion } from '@/lib/ventas/medios'

/**
 * Las dos series. El `color` sale del token y no de un hex escrito acá: los
 * valores viven en app/globals.css y los documenta docs/sistema-de-diseno.md,
 * que es lo único que hace que el contraste medido sea el contraste real.
 */
const CONFIG = {
  ars: { label: 'Pesos', color: 'var(--chart-1)' },
  usd: { label: 'Dólares', color: 'var(--chart-2)' },
} satisfies ChartConfig

/**
 * Lo que llevan las dos series por igual.
 *
 * El separador de 2 px del color de la superficie es lo que impide que los dos
 * tramos de una barra apilada se toquen: entre sí dan 2.02 de contraste, y esa
 * excepción se acepta en scripts/contraste.mts PORQUE hay un separador. Ver
 * `grafico.test.tsx`.
 *
 * Y la animación de entrada va apagada. No es por el test —aunque sin esto
 * recharts no dibuja el rectángulo bajo jsdom y las barras no se pueden
 * afirmar—: es que este panel se mira de reojo mientras se atiende a alguien,
 * y una barra que crece durante medio segundo es medio segundo en el que el
 * número que se está buscando todavía no es el número.
 */
const SERIE = { stroke: 'var(--card)', strokeWidth: 2, isAnimationActive: false }

/** Alto por barra, en px. Cuatro medios entran en 4 × 40 + los márgenes. */
const ALTO_DE_BARRA = 40

/**
 * El importe al final de la barra.
 *
 * Va sobre `total` —la pila entera— y no sobre la serie que lo hospeda: es el
 * número que la barra mide de punta a punta, y el desglose ya lo dan el tooltip
 * y la tabla.
 *
 * En tinta de texto (`fill-muted-foreground`) y nunca en el color de la serie:
 * un número pintado del color de su barra compite con la barra por ser el dato,
 * y encima hereda su contraste, que en la serie de dólares no llega a 3:1.
 */
function ImporteAlFinal() {
  return (
    <LabelList
      dataKey="total"
      position="right"
      offset={8}
      className="fill-muted-foreground"
      fontSize={11}
      formatter={(v: unknown) => formatearPrecio(String(v))}
    />
  )
}

function Leyenda() {
  return (
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
      {(['ars', 'usd'] as const).map((serie) => (
        <span key={serie} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-[2px]"
            style={{ background: CONFIG[serie].color }}
          />
          {CONFIG[serie].label}
        </span>
      ))}
    </div>
  )
}

/**
 * Cómo entró la plata del período, por medio de pago.
 *
 * **La tabla de abajo no es un extra de accesibilidad: es el componente.**
 * recharts no dibuja nada en el servidor —el SVG lo arma el cliente después de
 * medir el contenedor—, así que sin la tabla esta sección sería un rectángulo
 * vacío para cualquiera que llegue antes de que hidrate, con el JavaScript
 * caído o con un lector de pantalla. El gráfico es la capa que se ve; la tabla
 * es la que dice.
 *
 * Y es, además, la mitigación que la excepción de contraste de `--chart-2`
 * declara en scripts/contraste.mts: la serie de dólares no llega a 3:1 contra
 * la superficie, y lo que la vuelve legible igual es que el número esté escrito.
 */
export function GraficoDeMedios({ composicion }: { composicion: Composicion }) {
  const { barras, hayDolares } = composicion

  const datos = barras.map((b) => ({
    medio: ROTULO_MEDIO[b.medio],
    ars: Number(b.ars),
    usd: Number(b.usd),
    total: Number(b.total),
  }))

  return (
    <section className="mb-6 w-full max-w-2xl rounded-lg bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[10px] font-medium tracking-[0.1em] text-primary uppercase">
          Cómo entró la plata
        </h2>
        {/* Sólo con dos series: una leyenda de un ítem repite el título. */}
        {hayDolares && <Leyenda />}
      </div>

      {/* aria-hidden y no un `role="img"` con descripción: lo que hay que leer
          está en la tabla de abajo, completo y en orden. Exponer los dos hace
          que cada importe se anuncie dos veces. */}
      <div aria-hidden="true">
        <ChartContainer
          config={CONFIG}
          className="aspect-auto w-full"
          style={{ height: barras.length * ALTO_DE_BARRA + 16 }}
        >
          <BarChart
            accessibilityLayer
            data={datos}
            layout="vertical"
            margin={{ left: 0, right: 64, top: 4, bottom: 4 }}
          >
            <YAxis
              dataKey="medio"
              type="category"
              tickLine={false}
              axisLine={false}
              width={96}
            />
            <XAxis type="number" hide />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(valor, nombre) => (
                    <>
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ background: `var(--color-${nombre})` }}
                      />
                      {CONFIG[nombre as keyof typeof CONFIG]?.label}
                      <span className="ml-auto font-mono tabular-nums">
                        {formatearPrecio(String(valor))}
                      </span>
                    </>
                  )}
                />
              }
            />
            {/* El importe lo lleva SIEMPRE el tramo de más afuera, que es el de
                dólares cuando los hay y el de pesos cuando no: puesto en el de
                adentro quedaría escrito en medio de la barra. */}
            <Bar
              dataKey="ars"
              stackId="plata"
              fill="var(--color-ars)"
              radius={hayDolares ? 0 : [0, 4, 4, 0]}
              {...SERIE}
            >
              {!hayDolares && <ImporteAlFinal />}
            </Bar>
            {hayDolares && (
              <Bar
                dataKey="usd"
                stackId="plata"
                fill="var(--color-usd)"
                radius={[0, 4, 4, 0]}
                {...SERIE}
              >
                <ImporteAlFinal />
              </Bar>
            )}
          </BarChart>
        </ChartContainer>
      </div>

      <table className="sr-only">
        <caption>Cómo entró la plata del período, por medio de pago</caption>
        <thead>
          <tr>
            <th scope="col">Medio de pago</th>
            {hayDolares && <th scope="col">En pesos</th>}
            {hayDolares && <th scope="col">En dólares, convertido a pesos</th>}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {barras.map((b) => (
            <tr key={b.medio}>
              <th scope="row">{ROTULO_MEDIO[b.medio]}</th>
              {hayDolares && <td>{formatearPrecio(b.ars)}</td>}
              {hayDolares && <td>{formatearPrecio(b.usd)}</td>}
              <td>{formatearPrecio(b.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
