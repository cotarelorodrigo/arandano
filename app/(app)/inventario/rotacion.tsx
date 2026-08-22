// SIN 'use client': la reescritura de "Cómo entró la plata" en /ventas
// (app/(app)/ventas/grafico.tsx) ya sentó el precedente — un bloque de barras
// cuyo alto se calcula en el servidor no necesita medir nada del lado del
// navegador. Es el mismo motivo por el que este ciclo puede sacar `recharts`
// del repo entero (ver CLAUDE.md, Task 6): ninguna pantalla lo necesita ya.
import estilos from './tipografia.module.css'

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_LARGOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** `YYYY-MM` de un `Date`, por calendario de Buenos Aires — mismo criterio
 *  que `hoyEnArgentina()` en `/ventas`: el servidor corre en Ashburn, y sin el
 *  huso declarado un movimiento de las 22:00 en Buenos Aires cae en el mes
 *  equivocado. */
function claveMes(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(fecha)
}

/** `claveActual` menos `n` meses, en aritmética entera sobre año/mes — no
 *  `Date.setMonth`, que no hace falta acá y evita cualquier duda sobre cómo
 *  resuelve un mes con menos días que el de partida (irrelevante para
 *  año-mes, pero por qué arriesgarse). */
function mesesAntes(claveActual: string, n: number): string {
  const [anioStr, mesStr] = claveActual.split('-')
  let anio = Number(anioStr)
  let mes = Number(mesStr) - n
  while (mes < 1) {
    mes += 12
    anio -= 1
  }
  return `${anio}-${String(mes).padStart(2, '0')}`
}

export type MesDeVentas = { clave: string; rotulo: string; unidades: number }

/**
 * Los últimos 6 meses (del más viejo al más nuevo, terminando en `ahora`),
 * cada uno con la suma de unidades vendidas ese mes — design/arandano.pen,
 * frame `y4tEb`, nodo `V44Q64` ("Cómo se movió").
 *
 * La agregación se hace acá, EN JAVASCRIPT, y no con un `$queryRaw` con
 * `date_trunc`: la extensión de `lib/tenant/prisma.ts` intercepta
 * operaciones de MODELO (`findMany`, `groupBy`) para setear
 * `arandano.tenant_id` antes de cada consulta, pero NO intercepta raw
 * queries — un `$queryRaw` sin esa variable de sesión choca contra RLS y
 * devuelve cero filas, en silencio (mismo hallazgo que ya dejó anotado
 * `app/(app)/ventas/page.tsx` para el agregado de medios de pago). Los
 * movimientos de un solo artículo en 6 meses son pocos: agregarlos en JS
 * evita ese riesgo sin necesitar ninguna consulta cruda.
 *
 * `movimientos` ya viene filtrado por `motivo: 'VENTA'` desde la consulta
 * (page.tsx) — acá sólo se suma el valor absoluto de cada delta (siempre
 * negativo en una venta) y se descarta cualquier fila que caiga fuera de la
 * ventana de 6 meses, por si el llamador trae de más.
 */
export function agregarVentasPorMes(
  movimientos: { delta: string; creadoEn: Date }[],
  ahora: Date = new Date(),
): MesDeVentas[] {
  const claveActual = claveMes(ahora)
  // Del más viejo (hace 5 meses) al más nuevo (el mes de `ahora`).
  const claves = Array.from({ length: 6 }, (_, i) => mesesAntes(claveActual, 5 - i))

  const totales = new Map<string, number>(claves.map((c) => [c, 0]))
  for (const m of movimientos) {
    const clave = claveMes(m.creadoEn)
    if (!totales.has(clave)) continue
    totales.set(clave, (totales.get(clave) ?? 0) + Math.abs(Number(m.delta)))
  }

  return claves.map((clave) => {
    const mes = Number(clave.split('-')[1])
    return { clave, rotulo: MESES_CORTOS[mes - 1], unidades: totales.get(clave) ?? 0 }
  })
}

// El frame "Barras" del .pen mide h110 en total, pero eso incluye el rótulo
// del mes DEBAJO de cada barra (design/arandano.pen, nodo `Svbi2`): si la
// barra más alta escalara a los 110 enteros, el rótulo se empujaría fuera de
// la caja y el `overflow-hidden` de la card lo recortaría. Se le reserva a la
// barra un poco menos, dejando lugar para el texto del mes (10px) + su gap.
const ALTURA_TOTAL = 110
const ALTURA_MAXIMA_BARRA = 88

/**
 * El pie de "Cómo se movió": el mes actual y cuánto vendió, en unidades. Sin
 * la superlativa "el mejor mes del año" del relevamiento (sección 1.c) — acá
 * sólo se conocen 6 meses, no 12, y afirmar "el mejor del año" con un tercio
 * de los datos sería un dato inventado, justo lo que CLAUDE.md pide evitar.
 */
function pieDeRotacion(meses: MesDeVentas[]): string {
  const actual = meses[meses.length - 1]
  if (!actual || actual.unidades === 0) {
    return `Sin unidades vendidas de este artículo en lo que va de ${nombreLargo(actual)}.`
  }
  return `Unidades vendidas por mes. ${capitalizar(nombreLargo(actual))} va en ${actual.unidades}.`
}

function nombreLargo(mes: MesDeVentas | undefined): string {
  if (!mes) return ''
  return MESES_LARGOS[Number(mes.clave.split('-')[1]) - 1]
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Seis barras, una por mes (design/arandano.pen, nodo `Svbi2`): alto
 * proporcional a las unidades vendidas ese mes, con un piso en 0 —sin
 * ventas, sin barra, no una barra invisible de otra forma— y sin eje ni
 * grilla, que es exactamente lo que dibuja la maqueta. El mes más nuevo
 * (el actual) pinta con `--primary`; los cinco anteriores, con `--accent`
 * (`ar-primary-soft` en el `.pen` — ver `design/LEEME.md`).
 */
export function GraficoDeRotacion({ meses }: { meses: MesDeVentas[] }) {
  const maximo = Math.max(0, ...meses.map((m) => m.unidades))

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-[18px] py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cómo se movió</h2>
      </div>
      <div className="flex flex-col gap-[14px] p-[18px]">
        {/* items-end y NO h-full en cada columna: la fila mide ALTURA_TOTAL
            fija, y cada columna sólo ocupa el alto natural de su barra + su
            rótulo, alineada al piso — así una barra baja no estira su
            columna, y las seis comparten la misma línea de base. */}
        <div className="flex items-end gap-2" style={{ height: ALTURA_TOTAL }}>
          {meses.map((m, i) => {
            const alto =
              maximo > 0 ? Math.round((m.unidades / maximo) * ALTURA_MAXIMA_BARRA) : 0
            const esMesActual = i === meses.length - 1
            return (
              <div key={m.clave} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className={`w-full rounded-t-[6px] ${esMesActual ? 'bg-primary' : 'bg-accent'}`}
                  style={{ height: alto }}
                />
                <span className="text-[10px] text-muted-foreground">{m.rotulo}</span>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] leading-[1.4] text-muted-foreground">{pieDeRotacion(meses)}</p>
      </div>
    </div>
  )
}
