/**
 * Un anillo de gajos, en SVG y sin librería.
 *
 * Es un solo círculo por gajo, con `stroke-dasharray` recortándolo al arco que
 * le toca y `stroke-dashoffset` corriéndolo hasta donde termina el anterior.
 * La circunferencia se elige en 100 para que los porcentajes SEAN las
 * longitudes y no haya que multiplicar por 2πr en ningún lado.
 *
 * Sin librería a propósito: el ciclo del rediseño de /inventario sacó recharts
 * del repo entero, y cinco arcos no lo justifican de vuelta.
 */
import estilos from './anillo.module.css'

/** El radio que hace que la circunferencia mida exactamente 100. */
const RADIO = 100 / (2 * Math.PI)

export type Gajo = { rotulo: string; monto: string; porcentaje: number }

/**
 * Los cinco colores, de --marca al más claro (design/arandano.pen, nodos
 * `z7E8t`…`e0EpYe`). Un anillo con más de cinco gajos no existe: los paneles
 * que lo usan agrupan la cola en "Otros".
 */
export const COLORES_DEL_ANILLO = [
  'var(--marca)', 'var(--marca-2)', 'var(--marca-3)',
  'var(--marca-soft)', 'var(--marca-4)',
] as const

export type Arco = { largo: number; offset: number; color: string }

/**
 * Los arcos acumulados, en el orden de los gajos.
 *
 * Los gajos en cero no dibujan arco: un `stroke-dasharray` de 0 no pinta nada
 * pero igual monta un `<circle>`, y con `stroke-linecap` redondeado dejaría un
 * punto de color flotando sobre el arco vecino.
 */
export function arcosDe(porcentajes: number[]): Arco[] {
  const arcos: Arco[] = []
  let acumulado = 0
  porcentajes.forEach((p, i) => {
    if (p > 0) {
      arcos.push({ largo: p, offset: acumulado, color: COLORES_DEL_ANILLO[i % COLORES_DEL_ANILLO.length] })
    }
    acumulado += p
  })
  return arcos
}

export function Anillo({
  gajos, centro, diametro = 132,
}: {
  gajos: Gajo[]
  centro: { valor: string; rotulo: string }
  diametro?: number
}) {
  const arcos = arcosDe(gajos.map((g) => g.porcentaje))
  return (
    <div className="relative shrink-0" style={{ width: diametro, height: diametro }}>
      {/* rotate(-90) arranca el primer gajo arriba en vez de a las 3 en punto,
          que es donde SVG pone el ángulo 0. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="size-full -rotate-90"
      >
        {arcos.map((a, i) => (
          <circle
            key={i}
            cx="16" cy="16" r={RADIO}
            fill="none"
            stroke={a.color}
            // 0.38 del diámetro es el grosor que deja `innerRadius: 0.62` en
            // el .pen: el hueco del medio ocupa el 62 % del radio.
            strokeWidth={RADIO * 2 * 0.38}
            strokeDasharray={`${a.largo} ${100 - a.largo}`}
            strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${estilos.valor} text-foreground`}>{centro.valor}</span>
        <span className="text-[11px] text-muted-foreground">{centro.rotulo}</span>
      </div>
      {/* El anillo es puro color: sin esto, quien no ve el SVG no tiene el
          dato. No es `sr-only` decorativo — es el contenido, y la leyenda que
          los paneles dibujan al lado no siempre repite el porcentaje. */}
      <ul className="sr-only">
        {gajos.map((g) => (
          <li key={g.rotulo}>{`${g.rotulo}: ${g.porcentaje}%, ${g.monto}`}</li>
        ))}
      </ul>
    </div>
  )
}
