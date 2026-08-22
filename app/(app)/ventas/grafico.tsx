// SIN 'use client'. La versión anterior lo necesitaba porque recharts mide el
// contenedor del lado del navegador; esta —una lista de barras con un ancho en
// porcentaje— no mide nada: el servidor ya sabe el ancho final. Que este
// archivo se pueda borrar de la lista de componentes cliente es justamente la
// simplificación que motiva el cambio, no un efecto secundario.
import { Info } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { formatearPrecio } from '@/lib/formato/mostrar'
import { ROTULO_MEDIO, type Composicion } from '@/lib/ventas/medios'

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
export function porcentajesQueSuman100(valores: number[]): number[] {
  const total = valores.reduce((acc, v) => acc + v, 0)
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
 * se decidió escribiendo el código anterior (ver test/maqueta.test.ts, entrada
 * `--chart-2`). Los dólares siguen ahí, convertidos a pesos a la cotización de
 * cada pago —por eso la nota del pie—, simplemente no tienen su propio color:
 * `componerPorMedio` ya los suma en el mismo `barra.total` que los pesos.
 *
 * Y sin tabla `sr-only` de respaldo: la versión con recharts la necesitaba
 * porque el SVG no existe hasta que el cliente hidrata. Acá el texto ES el
 * contenido — no hay nada que un lector de pantalla o un navegador sin
 * JavaScript se pierdan.
 */
export function GraficoDeMedios({ composicion }: { composicion: Composicion }) {
  const { barras } = composicion
  const porcentajes = porcentajesQueSuman100(barras.map((b) => Number(b.total)))

  return (
    <section className="flex w-[344px] flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
        <h2
          style={{ fontFamily: 'var(--font-archivo)' }}
          className="text-[15px] font-semibold text-foreground"
        >
          Cómo entró la plata
        </h2>
      </div>
      <div className="flex flex-col gap-[18px] p-[18px]">
        {barras.map((b, i) => (
          <div key={b.medio} className="flex flex-col gap-[7px]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground">
                {ROTULO_MEDIO[b.medio]}
              </span>
              <span
                style={{ fontFamily: 'var(--font-archivo)' }}
                className="text-[13px] font-semibold text-foreground"
              >
                {formatearPrecio(b.total)}
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
            Los pagos en dólares están convertidos a la cotización de cada pago.
          </p>
        </div>
      </div>
    </section>
  )
}
