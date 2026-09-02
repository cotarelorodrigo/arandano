import Link from 'next/link'
import {
  Download, GitCompareArrows, Loader2, ShoppingCart, TrendingDown, TrendingUp,
} from 'lucide-react'
import { Prisma } from '@/generated/prisma/client'
import { Encabezado, CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { Button, buttonVariants } from '@/components/ui/button'
import { formatearPrecio, formatearDolares, formatearCantidad } from '@/lib/formato/mostrar'
import { hoyEnArgentina } from '@/lib/formato/fechas'
import {
  RANGOS, ROTULO_RANGO, rangoValido, periodoDeRango, periodoAnterior, rotuloDeComparacion,
  textoDelPeriodo, filtroDe, type Rango,
} from '@/lib/dashboard/rango'
import { metricasDelPeriodo, delta, soloEnDolares, type Delta } from '@/lib/dashboard/metricas'
import { agregarPorDia, pieDeTendencia, ventasDeLaTendencia } from '@/lib/dashboard/tendencia'
import {
  itemsDelPeriodo, ramaPorArticulo, agruparPorArticulo, repartirEnGajos, gajoMasGrande,
  topDeArticulos, TOP_DE_ARTICULOS, SIN_CATEGORIA,
} from '@/lib/dashboard/composicion'
import { componerPorMedio } from '@/lib/ventas/composicion'
import { monedaValida, type MonedaElegida } from '@/lib/ventas/medios'
import {
  VentasPorDia, AnilloDeMedios, VentasPorCategoria, TopDeArticulos, SelectorDeMoneda,
} from './paneles'
import { BotonDeExportar } from './exportar'
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

/**
 * La moneda que los tres paneles de composición —"Cómo entró la plata",
 * "Ventas por categoría" y "Lo que más se vendió"— TERMINAN mostrando, con
 * fallback a la que sí tuvo actividad en el período cuando la pedida está
 * vacía.
 *
 * **Ruling H de /ventas (Task 3 de este ciclo), portado acá — Critical de la
 * review de Task 11.** Sin este fallback había DOS formas de quedarse
 * varado, alcanzables sin escribir una URL a mano:
 *
 * 1. `hrefRango` arrastra `?moneda`: desde `/dashboard?moneda=usd` en un mes
 *    con dólares, un click en el chip "Hoy" —un día sin ninguno— deja
 *    `hayDolares` en `false` para ESE período. El selector, gateado por
 *    `hayDolares`, no se dibuja: nada en la pantalla ofrece volver a pesos,
 *    mientras los tiles de arriba siguen mostrando pesos reales y los tres
 *    paneles de abajo leen "sin datos" en una moneda que no tiene nada.
 * 2. Un local que sólo cobró en dólares HOY abre el `/dashboard` pelado —el
 *    default es `'ars'`— y ve la misma contradicción de entrada: el tile de
 *    marca ya invierte a US$ (`soloEnDolares`) pero los tres paneles de abajo
 *    arrancan vacíos, aunque acá sí hay selector para corregirlo a mano.
 *
 * Cubre pagos e ÍTEMS juntos —`huboEnPesos`/`huboEnDolares` los combina el
 * llamador—, no cada uno por separado: alcanza con que CUALQUIERA de los dos
 * haya tenido algo en la moneda pedida para respetarla.
 *
 * **NO cubre "Ventas por día".** Esa ventana es fija a 14 días —independiente
 * del período elegido, ver lib/dashboard/tendencia.ts— y puede tener
 * actividad en una moneda que el período elegido no tiene, o al revés. Este
 * dashboard igual le aplica la misma `monedaMostrada` que a los otros tres
 * paneles, por simplicidad: es un gap conocido y no uno nuevo (Minor 2 de la
 * review de Task 11), sin el modo de falla del Critical de arriba — nadie
 * queda varado, en el peor caso una barra de esos 14 días queda mostrando 0
 * en vez de un monto que sólo existe en la otra moneda.
 *
 * `?moneda` (la pedida) sigue intacta para el resto de la navegación —los
 * `href` la preservan, no la efectiva—: este fallback es sólo para ESTE
 * render, no una corrección de la preferencia.
 */
export function monedaEfectiva(
  moneda: MonedaElegida, huboEnPesos: boolean, huboEnDolares: boolean,
): MonedaElegida {
  const huboEnPedida = moneda === 'usd' ? huboEnDolares : huboEnPesos
  if (huboEnPedida) return moneda
  return moneda === 'usd' ? 'ars' : 'usd'
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ rango?: string; moneda?: string }>
}) {
  const sesion = await exigirSesion()
  const { rango: rangoParam, moneda: monedaParam } = await searchParams
  const rango = rangoValido(rangoParam)
  const moneda = monedaValida(monedaParam)
  const hoy = hoyEnArgentina()
  const periodo = periodoDeRango(rango, hoy)
  const periodoPrevio = periodoAnterior(rango, hoy)

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [
    metricas, metricasPrevias, puedeCostos, ventasTendenciaCrudo, itemsPeriodo, pagosPorMedio,
  ] = await Promise.all([
    metricasDelPeriodo(prisma, periodo),
    metricasDelPeriodo(prisma, periodoPrevio),
    puedeConSesion(sesion, 'COSTOS'),
    ventasDeLaTendencia(prisma, hoy),
    itemsDelPeriodo(prisma, periodo),
    // El desglose por MEDIO de "Cómo entró la plata": pagosDelPeriodo (arriba,
    // dentro de metricasDelPeriodo) agrupa sólo por moneda, lo que alcanza
    // para el tile pero no para separar Efectivo de Transferencia. Mismo
    // groupBy que ya arma este mismo panel en /ventas/page.tsx.
    prisma.pago.groupBy({
      by: ['medio', 'moneda', 'cotizacion', 'monto'],
      where: { venta: { ...filtroDe(periodo), anuladaEn: null } },
      _count: true,
    }),
  ])

  const composicionMedios = componerPorMedio(pagosPorMedio)

  // El selector `$ / US$` (visibilidad): se dibuja si CUALQUIERA de las dos
  // magnitudes que muestran los paneles —lo cobrado (pagos) o lo vendido
  // (ítems)— tuvo algo en dólares. Un local puede cobrar un total en dólares
  // enteramente en pesos (un plan de pago cubriendo USD, ver CLAUDE.md), y
  // ahí `composicionMedios.hayDolares` da `false` aunque sí haya mercadería
  // en dólares para mostrar en "Ventas por categoría" o "Lo que más se
  // vendió" — por eso el OR y no sólo la mitad de pagos.
  //
  // NO cubre "Ventas por día" (Minor 2 de la review de Task 11): esa ventana
  // es fija a 14 días —independiente del período elegido, ver
  // lib/dashboard/tendencia.ts— y puede tener dólares que el período elegido
  // no tiene, o al revés. Un shop cuya única venta en dólares fue hace seis
  // días, mirando `rango=hoy`, no ve selector (hoy no tuvo nada en ninguna
  // moneda) aunque el gráfico de 14 días sí tenga una barra en US$ que nadie
  // puede pedir ver — inofensivo hoy (esa barra simplemente se muestra en
  // pesos, en $0 si `monedaMostrada` cae en 'ars'), pero un lector futuro no
  // debería asumir que esta bandera cubre los cuatro paneles.
  const hayDolares = composicionMedios.hayDolares || itemsPeriodo.some((f) => f.moneda === 'USD')
  const huboEnPesos = composicionMedios.ars.barras.length > 0
    || itemsPeriodo.some((f) => f.moneda === 'ARS')
  // La moneda que ESTE render termina mostrando en los tres paneles de
  // composición (y, por simplicidad, también en "Ventas por día" — ver el
  // comentario de `hayDolares` de arriba): con fallback a la que sí tuvo
  // actividad, para no quedar varado en una pila vacía. Ver el docblock de
  // `monedaEfectiva`. `?moneda` (la pedida, `moneda`) sigue intacta para los
  // `href` — sólo `monedaMostrada` gobierna qué se calcula y se dibuja.
  const monedaMostrada = monedaEfectiva(moneda, huboEnPesos, hayDolares)

  // agregarPorDia() pide `total`/`totalUsd` como STRING —lo documenta su
  // firma en lib/dashboard/tendencia.ts—, y Prisma los devuelve como
  // `Decimal`: la conversión pasa acá, en el borde entre la consulta y la
  // función pura, la misma convención que ya usa `aComposicion` en
  // lib/ventas/composicion.ts.
  const ventasTendencia = ventasTendenciaCrudo.map((v) => ({
    creadoEn: v.creadoEn, total: v.total.toString(), totalUsd: v.totalUsd.toString(),
  }))
  const barrasTendencia = agregarPorDia(ventasTendencia, hoy, monedaMostrada)
  const pieTendencia = pieDeTendencia(barrasTendencia, monedaMostrada)

  const composicionElegida = monedaMostrada === 'usd' ? composicionMedios.usd : composicionMedios.ars

  // Lo vendido del período, YA en la moneda elegida: alimenta tanto "Ventas
  // por categoría" como "Lo que más se vendió", ordenado de mayor a menor
  // importe (agruparPorArticulo ya lo deja así).
  const vendidoElegido = agruparPorArticulo(itemsPeriodo, monedaMostrada)
  const idsVendidos = vendidoElegido.map((v) => v.articuloId)
  const idsTop = vendidoElegido.slice(0, TOP_DE_ARTICULOS).map((v) => v.articuloId)

  // Dependen de los IDs que recién salieron de itemsPeriodo, así que no
  // pueden ir en el Promise.all de arriba — es una segunda ronda porque hay
  // una dependencia real entre las dos, no una que se pueda evitar.
  const [ramas, articulosTop] = await Promise.all([
    ramaPorArticulo(prisma, idsVendidos),
    prisma.articulo.findMany({ where: { id: { in: idsTop } }, select: { id: true, nombre: true } }),
  ])

  const nombres = new Map(articulosTop.map((a) => [a.id, a.nombre]))
  const filasTop = topDeArticulos(vendidoElegido, nombres)

  // Importe por rama, de mayor a menor: repartirEnGajos asume esa entrada ya
  // ordenada. La suma es en Decimal —no en la vista de string que consumen
  // los paneles— porque repartirEnGajos necesita sumar la cola de verdad, y
  // porque el total y el gajo más grande se resuelven ACÁ, con `Decimal`
  // exacto, y no en `paneles.tsx` re-sumando o comparando en float (Minor 1
  // de la review de Task 11 — `AnilloDeMedios` ya seguía esta regla con
  // `composicion.total`, ahora `VentasPorCategoria` también).
  const sumaPorRama = new Map<string, Prisma.Decimal>()
  for (const v of vendidoElegido) {
    const rama = ramas.get(v.articuloId) ?? SIN_CATEGORIA
    sumaPorRama.set(rama, (sumaPorRama.get(rama) ?? new Prisma.Decimal(0)).add(v.importe))
  }
  const porCategoriaOrdenado = [...sumaPorRama.entries()]
    .map(([rotulo, importe]) => ({ rotulo, importe }))
    .sort((a, b) => b.importe.comparedTo(a.importe))
  const gajosDeCategoria = repartirEnGajos(porCategoriaOrdenado)
  // El gajo más grande DE VERDAD —no `gajosDeCategoria[0]`—: repartirEnGajos
  // agrega la cola "Otros" al FINAL sin reordenar, así que esa cola puede
  // pesar más que la rama que quedó primera. Ver el docblock de
  // `gajoMasGrande` (Minor 3 de la review de Task 11).
  const mayorCategoria = gajoMasGrande(gajosDeCategoria)
  const totalPorCategoria = gajosDeCategoria.reduce(
    (acc, c) => acc.add(c.importe), new Prisma.Decimal(0),
  )
  const porCategoria = gajosDeCategoria.map((c) => ({ rotulo: c.rotulo, importe: c.importe.toString() }))

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
  // esté mirando el default. `moneda` viaja también acá —no sólo en su propio
  // helper— por lo mismo que en /ventas: un local mirando los paneles en US$
  // no puede volver a pesos por tocar un chip de rango sin pedirlo.
  const hrefRango = (r: Rango) => {
    const u = new URLSearchParams()
    if (r !== 'estemes') u.set('rango', r)
    if (moneda !== 'ars') u.set('moneda', moneda)
    const qs = u.toString()
    return qs ? `/dashboard?${qs}` : '/dashboard'
  }
  // El selector `$ / US$` de los cuatro paneles: preserva `?rango` igual que
  // hrefRango preserva `?moneda`, y no escribe `moneda=ars` cuando es el
  // default — mismo criterio en las dos direcciones.
  const hrefDeMoneda = (m: MonedaElegida) => {
    const u = new URLSearchParams()
    if (rango !== 'estemes') u.set('rango', rango)
    if (m !== 'ars') u.set('moneda', m)
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
            {/* Wireado en la Task 12 ("Exportar CSV"): `buttonVariants` y no
                el `<Button>` de shadcn directo, porque `BotonDeExportar` es
                un `<button>` pelado —no puede envolver a `Button` sin perder
                el control del contenido que `children(exportando)` necesita
                (el mismo componente sirve a esta copia y a la del teléfono,
                ver su docblock en ./exportar.tsx)—, así que recibe la MISMA
                clase que `Button` calcularía para "outline"/"sm". */}
            <BotonDeExportar rango={rango} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              {(exportando) => (exportando ? 'Exportando…' : 'Exportar CSV')}
            </BotonDeExportar>
            <Button asChild size="sm">
              <Link href="/vender">
                <ShoppingCart aria-hidden="true" />
                Vender
              </Link>
            </Button>
          </>
        }
        // La ranura del teléfono (Task 12): `controlMovil` y no `accionMovil`
        // —`Encabezado` documenta esa ranura como SIEMPRE una navegación real
        // a un href, y un `href="#"` sin destino de verdad (lo que Task 10
        // dejó afuera a propósito) consumía la única entrada de historial del
        // Topbar del teléfono sin bajar ningún archivo—. `CLASES_RANURA_MOVIL`
        // es la misma caja de 38×38 que ya usa `accionMovil`: sin ella, esta
        // copia quedaría de un tamaño distinto al resto de las ranuras del
        // teléfono. El texto "Exportando…"/"Exportar CSV" viaja como
        // `sr-only` —el ícono solo no tiene nombre accesible— en vez de
        // reemplazar al ícono, que desbordaría los 38 px de la caja.
        controlMovil={
          <BotonDeExportar rango={rango} className={`${CLASES_RANURA_MOVIL} bg-muted text-foreground`}>
            {(exportando) => (
              <>
                {exportando ? (
                  <Loader2 aria-hidden="true" className="size-[19px] animate-spin" />
                ) : (
                  <Download aria-hidden="true" className="size-[19px]" />
                )}
                <span className="sr-only">{exportando ? 'Exportando…' : 'Exportar CSV'}</span>
              </>
            )}
          </BotonDeExportar>
        }
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

        {/* Los cuatro paneles: el selector $/US$ los gobierna a los cuatro a
            la vez, así que vive una sola vez acá arriba y no dentro de cada
            card — a diferencia de /ventas, donde un solo panel lo necesita.
            "Ventas por día" ocupa su propia fila —el gráfico de catorce
            barras pide ancho completo—; los otros tres comparten la
            segunda fila, apilados en el teléfono y en una sola fila desde
            `lg:`. */}
        <div className="flex flex-col gap-3 lg:gap-4">
          {hayDolares && (
            <div className="flex justify-end">
              {/* `monedaMostrada`, no `moneda`: si la pedida cayó vacía y el
                  fallback la corrigió, el selector tiene que resaltar la
                  opción que REALMENTE está en pantalla — resaltar la pedida
                  mentiría sobre qué se está mirando. */}
              <SelectorDeMoneda hayDolares={hayDolares} moneda={monedaMostrada} href={hrefDeMoneda} />
            </div>
          )}
          <VentasPorDia barras={barrasTendencia} pie={pieTendencia} moneda={monedaMostrada} />
          <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
            <AnilloDeMedios composicion={composicionElegida} moneda={monedaMostrada} />
            <VentasPorCategoria
              porCategoria={porCategoria}
              total={totalPorCategoria.toString()}
              mayor={mayorCategoria ? { rotulo: mayorCategoria.rotulo, importe: mayorCategoria.importe.toString() } : null}
              moneda={monedaMostrada}
            />
            <TopDeArticulos filas={filasTop} moneda={monedaMostrada} />
          </div>
        </div>
      </div>
    </>
  )
}
