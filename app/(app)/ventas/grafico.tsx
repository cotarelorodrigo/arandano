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
 * **Cuelga del tramo que termina la pila, y por eso son dos y no uno.** recharts
 * no emite rectángulo para un punto de valor 0, y sin rectángulo tampoco emite
 * su label: con el importe colgado sólo del tramo de dólares, toda barra
 * cobrada íntegramente en pesos se quedaba sin número. No era un borde — con
 * dólares en efectivo y en transferencia, tarjeta de crédito y débito perdían
 * el suyo. Y no era cosmético: la excepción de contraste de `--chart-2` se
 * acepta declarando que cada barra lleva su importe impreso al lado.
 *
 * El truco es que el rótulo viaje en los DATOS y no en un formatter: cada fila
 * trae `rotuloArs` y `rotuloUsd`, y sólo uno de los dos tiene texto — el del
 * tramo que efectivamente termina esa barra. Así la posición siempre cae al
 * final de la pila sin tener que calcularla.
 *
 * En tinta de texto (`fill-muted-foreground`) y nunca en el color de la serie:
 * un número pintado del color de su barra compite con la barra por ser el dato,
 * y encima hereda su contraste, que en la serie de dólares no llega a 3:1.
 */
function ImporteAlFinal({ campo }: { campo: 'rotuloArs' | 'rotuloUsd' }) {
  return (
    <LabelList
      dataKey={campo}
      position="right"
      offset={8}
      className="fill-muted-foreground"
      fontSize={11}
    />
  )
}

/**
 * Lo que hay que reservar a la derecha para que el importe no se corte.
 *
 * El SVG recorta lo que se sale, así que un margen fijo es una apuesta a que
 * ningún local factura más de lo que ese número aguanta. `$ 1.354.189,00` mide
 * ~73 px en 11 px de cuerpo, y con `right: 64` terminaba PASADO el borde. Se
 * calcula sobre el rótulo más largo que esta pantalla va a dibujar de verdad.
 */
function margenDerecho(rotulos: string[]): number {
  const largo = Math.max(0, ...rotulos.map((r) => r.length))
  // 6.6 px por carácter en 11 px de cuerpo, más el offset de 8 y un respiro.
  return Math.max(64, Math.ceil(largo * 6.6) + 20)
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

  const datos = barras.map((b) => {
    const usd = Number(b.usd)
    const rotulo = formatearPrecio(b.total)
    return {
      medio: ROTULO_MEDIO[b.medio],
      ars: Number(b.ars),
      usd,
      total: Number(b.total),
      // Sólo uno de los dos lleva texto: el del tramo que termina la pila.
      // Ver ImporteAlFinal.
      rotuloArs: usd === 0 ? rotulo : '',
      rotuloUsd: usd === 0 ? '' : rotulo,
    }
  })

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
          {/* Sin `accessibilityLayer`: le pone al SVG `role="application"` y
              `tabindex="0"`, y este SVG vive adentro de un aria-hidden. Eso es
              la violación aria-hidden-focus de axe, y en la práctica una parada
              de tab invisible entre "Filtrar" y el listado — sin foco visible y
              sin nada que anunciar. El camino accesible es la tabla de abajo,
              así que la capa sobra. */}
          <BarChart
            tabIndex={-1}
            role="presentation"
            data={datos}
            layout="vertical"
            margin={{
              left: 0,
              right: margenDerecho(datos.map((d) => d.rotuloArs || d.rotuloUsd)),
              top: 4,
              bottom: 4,
            }}
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
            {/* Los dos tramos llevan su LabelList, y no sólo el de afuera: el
                que "está afuera" cambia FILA POR FILA — una barra cobrada toda
                en pesos termina en el tramo de pesos aunque el período tenga
                dólares. Ver ImporteAlFinal. */}
            <Bar
              dataKey="ars"
              stackId="plata"
              fill="var(--color-ars)"
              radius={hayDolares ? 0 : [0, 4, 4, 0]}
              {...SERIE}
            >
              <ImporteAlFinal campo="rotuloArs" />
            </Bar>
            {hayDolares && (
              <Bar
                dataKey="usd"
                stackId="plata"
                fill="var(--color-usd)"
                radius={[0, 4, 4, 0]}
                {...SERIE}
              >
                <ImporteAlFinal campo="rotuloUsd" />
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
