import Link from 'next/link'
import { GitCompareArrows, ShoppingCart, TrendingDown, TrendingUp } from 'lucide-react'
import { Prisma } from '@/generated/prisma/client'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { Button } from '@/components/ui/button'
import { formatearPrecio, formatearDolares, formatearCantidad } from '@/lib/formato/mostrar'
import { hoyEnArgentina } from '@/lib/formato/fechas'
import {
  RANGOS, ROTULO_RANGO, rangoValido, periodoDeRango, periodoAnterior, rotuloDeComparacion,
  textoDelPeriodo, type Rango,
} from '@/lib/dashboard/rango'
import { metricasDelPeriodo, delta, soloEnDolares, type Delta } from '@/lib/dashboard/metricas'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const PORCENTAJE_MARGEN = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
})

/**
 * El pie que reemplaza al chip de delta cuando el período anterior fue CERO
 * (`delta()` devuelve `null`): "sin ventas en julio", el mismo literal que ya
 * cita el docblock de `delta()` en lib/dashboard/metricas.ts. Reusa el sufijo
 * de `rotuloDeComparacion` —"julio", "2025", "los 7 días previos", "ayer"— en
 * vez de repetir la lógica de qué es el período anterior.
 */
function sinVentasEnPeriodoAnterior(rango: Rango, hoy: string): string {
  const sufijo = rotuloDeComparacion(rango, hoy).replace(/^Comparado con /, '')
  // "hoy" da "ayer": "sin ventas en ayer" suena traducido: el resto de los
  // rangos sí llevan "en" ("en julio", "en 2025", "en los 7 días previos").
  return rango === 'hoy' ? `sin ventas ${sufijo}` : `sin ventas en ${sufijo}`
}

const NUMERO_DELTA = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
})

/**
 * El chip "+18,4%" / "−2,3%" que compara contra el período anterior.
 *
 * `null` no dibuja nada —el llamador ya decidió, en el pie del tile, qué decir
 * cuando no hay con qué comparar (ver `sinVentasEnPeriodoAnterior`)—.
 *
 * El signo lo decide `sube`, no el signo de `porcentaje`: es la misma regla
 * que ya documenta `delta()` (una baja mínima puede redondear a "-0", y
 * `-0 >= 0` da `true` en JS). El menos es U+2212 (menos tipográfico) y no el
 * guion ASCII que da `Intl` con `signDisplay` — la maqueta lo dibuja así.
 *
 * `marca` cambia la paleta: sobre el paño violeta ni `--ok`/`--ok-soft` ni
 * `--destructive` contrastan (el soft casi blanco desaparece, el oscuro no se
 * lee), así que ahí pinta con `--marca-ok` / `--marca-foreground` sobre un
 * fondo translúcido. **No hay `--marca-danger`**: la maqueta no dibuja el
 * chip a la baja sobre este paño, así que se aproxima con el mismo blanco del
 * texto en vez de inventar un rojo — anotado en
 * docs/correcciones-pendientes-del-pen.md.
 */
export function ChipDeDelta({ delta: d, marca = false }: { delta: Delta; marca?: boolean }) {
  if (!d) return null
  const Icono = d.sube ? TrendingUp : TrendingDown
  const texto = `${d.sube ? '+' : '−'}${NUMERO_DELTA.format(Math.abs(d.porcentaje))}%`
  return (
    <span
      className={
        'inline-flex shrink-0 items-center gap-[3px] rounded-full px-[7px] py-[2px] ' +
        'text-[11px] font-semibold' +
        (marca ? '' : d.sube ? ' bg-ok-soft text-ok' : ' bg-destructive-soft text-destructive')
      }
      style={
        marca
          ? {
              backgroundColor: '#FFFFFF1F',
              color: d.sube ? 'var(--marca-ok)' : 'var(--marca-foreground)',
            }
          : undefined
      }
    >
      <Icono aria-hidden="true" className="size-[11px]" />
      {texto}
    </span>
  )
}

/**
 * Un tile del resumen del período (design/arandano.pen, frame `A2Hffo` en
 * escritorio, `OWGzI` en el teléfono).
 *
 * `valor` llega ya resuelto a texto —qué moneda mostrar es una decisión del
 * llamador (ver "El tile de marca invierte", más abajo), no de este
 * componente—. `delta` es opcional y por default `null`: los tiles "Ticket
 * promedio" y "Margen" no lo usan (Ruling M de la review de esta task: sin
 * mediana y sin pie para el primero; el segundo no tiene con qué comparar un
 * porcentaje-sobre-porcentaje de forma que valga la pena).
 */
export function Tile({
  rotulo, valor, pie, delta: d = null, marca = false,
}: { rotulo: string; valor: string; pie?: string; delta?: Delta; marca?: boolean }) {
  if (marca) {
    return (
      <div
        className="flex flex-1 flex-col gap-[3px] rounded-2xl px-[16px] py-[15px]"
        style={{ backgroundColor: 'var(--marca)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div
            className="text-[10px] font-bold tracking-[1.2px] uppercase"
            style={{ color: 'var(--marca-soft)' }}
          >
            {rotulo}
          </div>
          <ChipDeDelta delta={d} marca />
        </div>
        <div
          className={`${estilos.archivo} text-[29px] font-semibold tracking-[-0.6px] tabular-nums lg:text-[30px]`}
          style={{ color: 'var(--marca-foreground)' }}
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
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase lg:tracking-[1.2px]">
          {rotulo}
        </div>
        <ChipDeDelta delta={d} />
      </div>
      <div
        className={`${estilos.archivo} text-[24px] font-semibold tracking-[-0.6px] tabular-nums text-foreground lg:text-[26px]`}
      >
        {valor}
      </div>
      {pie && <div className="text-[10px] text-muted-foreground lg:text-[11px]">{pie}</div>}
    </div>
  )
}

/**
 * Los cuatro chips del rango (design/arandano.pen, nodo `AP9E6`).
 *
 * El activo NO se linkea a sí mismo: navegar a su propia URL con el parámetro
 * puesto de más no compra nada, y es la misma regla que ya usa la paginación
 * de `Listado` en /ventas (el número actual es un `<span>` con
 * `aria-current`, no un `Link`). Los otros tres sí, con el `href` que arma el
 * llamador —y que en la pantalla real omite `?rango=` cuando el destino es el
 * default, mismo criterio que el resto de los helpers de `/ventas`—.
 */
export function SegmentadoDeRango({
  activo, href,
}: { activo: Rango; href: (r: Rango) => string }) {
  return (
    <div className="flex flex-1 gap-0.5 rounded-[10px] bg-muted p-[3px] lg:flex-none">
      {RANGOS.map((r) =>
        r === activo ? (
          <span
            key={r}
            aria-current="page"
            className="flex-1 rounded-lg bg-card px-[13px] py-[7px] text-center text-xs font-semibold text-foreground lg:flex-none"
          >
            {ROTULO_RANGO[r]}
          </span>
        ) : (
          <Link
            key={r}
            href={href(r)}
            className="flex-1 rounded-lg px-[13px] py-[7px] text-center text-xs font-medium text-muted-foreground lg:flex-none"
          >
            {ROTULO_RANGO[r]}
          </Link>
        ),
      )}
    </div>
  )
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string }>
}) {
  const sesion = await exigirSesion()
  const { rango: rangoParam } = await searchParams
  const rango = rangoValido(rangoParam)
  const hoy = hoyEnArgentina()
  const periodo = periodoDeRango(rango, hoy)
  const periodoPrevio = periodoAnterior(rango, hoy)

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [metricas, metricasPrevias, puedeCostos] = await Promise.all([
    metricasDelPeriodo(prisma, periodo),
    metricasDelPeriodo(prisma, periodoPrevio),
    puedeConSesion(sesion, 'COSTOS'),
  ])

  // El tile de marca invierte cuando no entró ni un peso pero sí entraron
  // dólares: sin esto, un local que carga y cobra TODO su catálogo en dólares
  // abriría el dashboard con "$ 0,00" de titular. El delta compara la MISMA
  // magnitud que se muestra —pesos contra pesos, o dólares contra dólares—,
  // nunca una cruzada con la otra. `soloEnDolares` (lib/dashboard/metricas.ts)
  // y no un `if` propio acá: es la MISMA regla que ya usa `ticketPromedio`
  // para decidir su `null`, y las dos copias no pueden desincronizarse
  // (Important 1 de la review de esta task).
  const invertido = soloEnDolares(metricas.cobrado)
  const valorMarca = invertido
    ? formatearDolares(metricas.cobrado.usd.toString())
    : formatearPrecio(metricas.cobrado.ars.toString())
  const deltaMarca = invertido
    ? delta(metricas.cobrado.usd, metricasPrevias.cobrado.usd)
    : delta(metricas.cobrado.ars, metricasPrevias.cobrado.ars)
  // El pie de este tile tiene DOS trabajos que no compiten entre sí: avisar
  // que también entraron dólares (cuando no está invertido) siempre pesa más
  // que explicar la falta de comparación, porque es plata real que el pie de
  // al lado no menciona en ningún otro lado.
  const pieMarca = invertido
    ? undefined
    : !metricas.cobrado.usd.isZero()
      ? `${formatearDolares(metricas.cobrado.usd.toString())} aparte`
      : deltaMarca === null
        ? sinVentasEnPeriodoAnterior(rango, hoy)
        : undefined

  const deltaCobradas = delta(
    new Prisma.Decimal(metricas.cobradas),
    new Prisma.Decimal(metricasPrevias.cobradas),
  )
  const pieCobradas = deltaCobradas === null ? sinVentasEnPeriodoAnterior(rango, hoy) : undefined

  // Sólo se escribe `?rango` cuando no es el default —mismo criterio que
  // `hrefRango` en /ventas—: un link que siempre mandara `rango=estemes` no
  // cambiaría nada en la práctica pero ensuciaría la URL de cualquiera que ya
  // esté mirando el default.
  const hrefRango = (r: Rango) => {
    const u = new URLSearchParams()
    if (r !== 'estemes') u.set('rango', r)
    const qs = u.toString()
    return qs ? `/dashboard?${qs}` : '/dashboard'
  }

  return (
    <>
      <Encabezado
        titulo="Dashboard"
        // `textoDelPeriodo(periodo)` y no un mes suelto: con `esteanio` o con
        // `7dias` cruzando un corte de mes, "Agosto 2026" mentiría sobre el
        // rango real que el subtítulo dice contar (Important 3 de la review
        // de esta task). Es también el ÚNICO texto de período que ve el
        // teléfono: la fila de abajo lo repite, pero sólo en escritorio
        // (`hidden lg:block`).
        subtitulo={`${textoDelPeriodo(periodo)} · ${
          metricas.cobradas === 1
            ? '1 venta cobrada'
            : `${formatearCantidad(String(metricas.cobradas))} ventas cobradas`
        }`}
        acciones={
          <>
            {/* Sin funcionalidad todavía: la baja real llega en la Task 12
                del ciclo ("Exportar CSV"), que reemplaza este botón por
                `BotonDeExportar`. Éste sólo deja el lugar y el estilo que la
                maqueta pide. */}
            <Button variant="outline" size="sm">
              Exportar CSV
            </Button>
            <Button asChild size="sm">
              <Link href="/vender">
                <ShoppingCart aria-hidden="true" />
                Vender
              </Link>
            </Button>
          </>
        }
        /* SIN accionMovil (Important 2 de la review de esta task):
           `Encabezado` documenta esa ranura como SIEMPRE una navegación real
           a un href, nunca un control que no navega — un `href="#"` sin
           destino de verdad consumía la única entrada de historial del
           Topbar del teléfono sin bajar ningún archivo, dejando el próximo
           Atrás sin efecto visible. Vuelve en la Task 12, con
           `BotonDeExportar` en `controlMovil` (que sí puede ser un control
           sin navegación) en vez de acá. Hasta entonces el teléfono no
           pierde nada que esta pantalla ya ofreciera. */
      />
      <div className="flex flex-col gap-3 p-[14px] lg:gap-4 lg:p-6">
        {/* Fila de rango: en el teléfono, sólo el segmentado a ancho
            completo. En escritorio suma —a la izquierda del segmentado— el
            texto del período, un espaciador que lo empuja todo a la derecha,
            y el chip de comparación (nodo `unJCa`). */}
        <div className="flex items-center gap-2 lg:gap-[10px]">
          <span className="hidden text-sm text-muted-foreground lg:block">
            {textoDelPeriodo(periodo)}
          </span>
          <div className="hidden flex-1 lg:block" />
          <div className="hidden items-center gap-[5px] rounded-full bg-muted px-[10px] py-[5px] text-[11px] font-medium text-muted-foreground lg:flex">
            <GitCompareArrows aria-hidden="true" className="size-[12px]" />
            {rotuloDeComparacion(rango, hoy)}
          </div>
          <SegmentadoDeRango activo={rango} href={hrefRango} />
        </div>

        {/* Tiles: en el teléfono el de marca va solo y los otros tres en una
            grilla de dos columnas; en escritorio los cuatro vuelven a ser
            hermanos de una sola fila gracias a `lg:contents` en el
            envoltorio — mismo patrón que ya usa /ventas para su tile de
            marca y los dos de al lado. */}
        <div className="flex flex-col gap-3 lg:h-[116px] lg:flex-row lg:gap-4">
          <Tile
            marca
            rotulo="Total del período"
            valor={valorMarca}
            pie={pieMarca}
            delta={deltaMarca}
          />
          <div className="grid grid-cols-2 gap-3 lg:contents">
            <Tile
              rotulo="Ventas cobradas"
              valor={formatearCantidad(String(metricas.cobradas))}
              pie={pieCobradas}
              delta={deltaCobradas}
            />
            {/* Sin pie y sin chip, a propósito (Ruling M de la review de esta
                task): la mediana que dibujaba la maqueta mezclaba una
                magnitud distinta ("vendido" en vez de "cobrado") bajo el
                mismo tile, y afirmaba "$ 0,00" exactamente cuando
                `ticketPromedio` ya decide que afirmar eso sería falso. Ver
                docs/correcciones-pendientes-del-pen.md. */}
            <Tile
              rotulo="Ticket promedio"
              valor={metricas.ticket ? formatearPrecio(metricas.ticket.toString()) : '—'}
            />
            {/* Detrás de COSTOS: es el mismo permiso que ya protege el costo y
                el margen en /inventario/[id] — mostrarlo acá sin el permiso
                sería no protegerlo en absoluto. */}
            {puedeCostos && (
              <Tile
                rotulo="Margen"
                valor={
                  metricas.margen
                    ? `${PORCENTAJE_MARGEN.format(metricas.margen.porcentaje.toNumber())}%`
                    : '—'
                }
                pie={
                  metricas.margen
                    ? `${formatearPrecio(metricas.margen.monto.toString())} de margen`
                    : 'sin ventas con costo cargado en el período'
                }
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
