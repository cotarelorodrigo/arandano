// SIN 'use client'. La versión anterior lo necesitaba porque recharts mide el
// contenedor del lado del navegador; esta —una lista de barras con un ancho en
// porcentaje— no mide nada: el servidor ya sabe el ancho final. Que este
// archivo se pueda borrar de la lista de componentes cliente es justamente la
// simplificación que motiva el cambio, no un efecto secundario.
import { Info } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { ROTULO_MEDIO, type Composicion } from '@/lib/ventas/medios'
import estilos from './tipografia.module.css'

/**
 * Cada monto como porcentaje ENTERO del total, garantizando que la suma dé
 * exactamente 100 (o todos 0 si no hay total).
 *
 * Redondear cada fracción por separado ("naive rounding") puede dejar la
 * columna en 99 o en 101 por el acarreo de cada barra por separado — con
 * cuatro medios de pago no es un caso de borde raro, es lo esperable. El
 * método del resto mayor (largest remainder) reparte los enteros que sobran
 * —o faltan— entre las barras cuyo resto fue más grande, que es la forma
 * estándar de redondear una distribución de porcentajes sin que la suma se
 * mueva del 100% que el panel promete.
 */
export function porcentajesQueSuman100(
  valores: number[],
  // El total viene por parámetro y no siempre re-sumado acá — `total` default
  // preserva el comportamiento de antes para quien no lo pasa (y para los
  // tests de este archivo). El llamador real (GraficoDeMedios) SÍ lo pasa:
  // `composicion.total` ya es exacto —sale de sumar `Decimal`s, no floats—, así
  // que anclar el reparto a ESE número evita sumar de nuevo en float un valor
  // que ya se sumó bien una vez.
  total: number = valores.reduce((acc, v) => acc + v, 0),
): number[] {
  if (total <= 0) return valores.map(() => 0)

  const brutos = valores.map((v) => (v / total) * 100)
  const pisos = brutos.map(Math.floor)
  const faltan = 100 - pisos.reduce((acc, v) => acc + v, 0)

  // De mayor a menor resto: a esas barras les toca el punto entero que el
  // piso les recortó.
  const ordenPorResto = brutos
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto)

  const resultado = [...pisos]
  for (let k = 0; k < faltan; k++) resultado[ordenPorResto[k].i] += 1
  return resultado
}

/**
 * Cómo entró la plata del período, por medio de pago (design/arandano.pen,
 * nodo `eyqV3`).
 *
 * Un solo color por barra —`--primary`, vía el `Progress` de shadcn— y no dos
 * series apiladas: la maqueta nunca pidió una segunda serie para dólares, eso
 * se decidió escribiendo el código anterior (ver `docs/sistema-de-diseno.md`,
 * sección "Cómo se verifica", el párrafo sobre esta reescritura — la entrada
 * `--chart-2` de `test/maqueta.test.ts` que citaba antes no existe más:
 * `--chart-1` y `--chart-2` se sacaron del repo entero en este mismo ciclo).
 * Los dólares siguen ahí, convertidos a pesos a la cotización de cada pago
 * —por eso la nota del pie—, simplemente no tienen su propio color:
 * `componerPorMedio` ya los suma en el mismo `barra.total` que los pesos.
 *
 * Y sin tabla `sr-only` de respaldo: la versión con recharts la necesitaba
 * porque el SVG no existe hasta que el cliente hidrata. Acá el texto ES el
 * contenido — no hay nada que un lector de pantalla o un navegador sin
 * JavaScript se pierdan.
 */
export function GraficoDeMedios({ composicion }: { composicion: Composicion }) {
  const { barras, total } = composicion
  const porcentajes = porcentajesQueSuman100(barras.map((b) => Number(b.total)), Number(total))

  return (
    // Ancho completo en el teléfono —el `.pen` no dibuja un panel angosto ahí,
    // el panel ocupa todo el ancho del cuerpo apilado— y recién a partir de
    // `lg:` (donde el contenedor pasa a `flex-row`, ver page.tsx) se fija en
    // 344px con `lg:shrink-0`, igual que su equivalente de /ventas/[id]
    // (`lg:w-[324px] lg:shrink-0`): sin esto, un vecino ancho en el mismo row
    // flex podía angostar este panel por debajo de sus 344px de diseño.
    <section className="flex w-full flex-col overflow-hidden rounded-2xl border bg-card lg:w-[344px] lg:shrink-0">
      <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cómo entró la plata</h2>
      </div>
      <div className="flex flex-col gap-[18px] p-[18px]">
        {barras.map((b, i) => (
          <div key={b.medio} className="flex flex-col gap-[7px]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground">
                {ROTULO_MEDIO[b.medio]}
              </span>
              {/* Los importes apilados y alineados a la derecha
                  (design/arandano.pen, nodo `l4Inhd`): los pesos arriba, en
                  13/600; los dólares abajo, en 12/600 y un tono más apagado.
                  Que la línea de dólares sea MÁS CHICA es deliberado, y a
                  propósito distinto del tile "Total del período" de la misma
                  pantalla, donde las dos monedas van a 32 px y al mismo
                  color: allá ninguna manda sobre la otra, acá el número que
                  gobierna la barra es el de pesos y éste es el detalle de
                  qué parte entró en billetes. */}
              <span className="flex flex-col items-end gap-px">
                <span className={`${estilos.archivo} text-[13px] font-semibold text-foreground`}>
                  {formatearPrecio(b.ars)}
                </span>
                {/* Sólo los medios que tuvieron dólares: en el frame,
                    Efectivo y Transferencia la tienen, Débito y Crédito no. */}
                {Number(b.usdCrudo) !== 0 && (
                  <span className={`${estilos.archivo} text-[12px] font-semibold text-foreground-soft`}>
                    {formatearDolares(b.usdCrudo)}
                  </span>
                )}
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
            Cada moneda dice su propio número. La barra compara todo en pesos, a
            la cotización de cada pago.
          </p>
        </div>
      </div>
    </section>
  )
}
