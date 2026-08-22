import Link from 'next/link'
import { Funnel } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatearPrecio, formatearHora, formatearCantidad } from '@/lib/formato/mostrar'
import { componerPorMedio } from '@/lib/ventas/composicion'
import { ROTULO_MEDIO, CONSUMIDOR_FINAL, type Medio } from '@/lib/ventas/medios'
import { ChipEstado } from './chip-estado'
import { GraficoDeMedios } from './grafico'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

/**
 * El día de hoy en Buenos Aires, como `YYYY-MM-DD`.
 *
 * El servidor está en Ashburn: `new Date()` a las 22:00 de Buenos Aires ya es
 * el día siguiente en UTC, así que "las ventas de hoy" mostraría las de mañana
 * y ninguna de las de la tarde. El huso va declarado, igual que en
 * `formatearFecha`.
 */
function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date())
}

/** `YYYY-MM-DD` al instante en que ese día empieza en Buenos Aires (UTC-3). */
function inicioDelDia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00-03:00`)
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * La fecha del query string, o hoy.
 *
 * Chequea el `Date` construido y no sólo la forma de los dígitos: `2026-13-45`
 * pasa cualquier regex de `\d{4}-\d{2}-\d{2}` y después da un `Invalid Date`
 * que Prisma rechaza sin que nadie lo atrape — un 500 servido desde algo que
 * alguien tipeó en la barra de direcciones. Es el mismo criterio que el clamp
 * de `?p`: lo malformado cae al default, no explota.
 */
function fechaOhoy(valor: string | undefined, hoy: string): string {
  if (!valor || !ES_FECHA.test(valor)) return hoy
  return Number.isNaN(inicioDelDia(valor).getTime()) ? hoy : valor
}

/**
 * `YYYY-MM-DD` → "13 de agosto de 2026".
 *
 * Con el huso declarado, por lo mismo que `hoyEnArgentina`: sin él, el
 * `Date` de medianoche argentina se formatea en UTC y muestra el día anterior.
 */
function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(iso))
}

/** Los tres accesos rápidos de rango del filtro (design/arandano.pen, nodo `SM9Zl`). */
export const RANGOS = ['hoy', '7dias', 'estemes'] as const
export type Rango = (typeof RANGOS)[number]

export const ROTULO_RANGO: Record<Rango, string> = {
  hoy: 'Hoy',
  '7dias': '7 días',
  estemes: 'Este mes',
}

/**
 * `YYYY-MM-DD` más/menos `dias` días de calendario.
 *
 * A medianoche UTC y no con `inicioDelDia` (que ancla a Buenos Aires): acá lo
 * único que importa son los componentes de la fecha, no el instante, así que
 * cualquier huso fijo sirve con tal de no cruzar un cambio de horario de
 * verano que Argentina no tiene. Usar un huso real metería esa complejidad de
 * vuelta sin necesidad.
 */
function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** El primer día del mes de `iso`, mismo criterio que sumarDias. */
function primerDiaDelMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

/**
 * El `[desde, hasta]` que arma cada chip de rango rápido, contra `hoy`.
 *
 * "7dias" resta 6 y no 7: del 15 al 21 son 7 días con el 21 incluido
 * (21,20,19,18,17,16,15), y restar 7 dejaría afuera el propio día de hoy.
 */
export function rangoDeChip(rango: Rango, hoy: string): { desde: string; hasta: string } {
  switch (rango) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    case '7dias':
      return { desde: sumarDias(hoy, -6), hasta: hoy }
    case 'estemes':
      return { desde: primerDiaDelMes(hoy), hasta: hoy }
  }
}

/**
 * Qué chip, si alguno, describe el filtro vigente — para resaltarlo con el
 * mismo tratamiento que la maqueta le da a "Hoy" en su estado activo. Ninguno
 * cuando el rango viene de tipear las fechas a mano.
 */
export function chipActivo(desde: string, hasta: string, hoy: string): Rango | null {
  return RANGOS.find((r) => {
    const rg = rangoDeChip(r, hoy)
    return rg.desde === desde && rg.hasta === hasta
  }) ?? null
}

/** El filtro de rango que arma esta pantalla: el mismo `donde` para el
 *  listado, los tres tiles y el panel de medios. */
type FiltroDePeriodo = { creadoEn: { gte: Date; lt: Date } }

/**
 * El total del tile "Total del período": la suma de lo NO anulado. Una venta
 * anulada no es plata que entró, y esta regla es la única razón de ser de la
 * función — extraída y exportada porque, a diferencia del resto de las
 * funciones de este archivo, ésta SÍ toca la base (no hay forma de probar la
 * regla sin eso), así que el test que la sostiene vive en test/ventas.test.ts,
 * contra la base efímera, y no en page.test.tsx.
 *
 * Antes de esta extracción, sacar `anuladaEn: null` del `where` no rompía
 * ningún test (785/785 en verde) — hallazgo I3 de la review final del
 * rediseño. Que la función exista y se llame desde acá es lo que la deja
 * protegida.
 */
export function totalDelPeriodo(
  prisma: ReturnType<typeof prismaParaTenant>,
  donde: FiltroDePeriodo,
) {
  return prisma.venta.aggregate({ where: { ...donde, anuladaEn: null }, _sum: { total: true } })
}

/**
 * El pie del tile "Ventas cobradas": el promedio por venta cobrada.
 *
 * `undefined` y no `NaN` cuando no hubo ninguna cobrada — un período puede
 * anularse entero, y "promedio $ NaN" es peor que no mostrar ningún pie: ver
 * el mismo criterio en `hayFaltanteDeVenta` de punto-de-venta.tsx.
 */
export function pieDeCobradas(sumaCobradas: string, cobradas: number): string | undefined {
  if (cobradas <= 0) return undefined
  const promedio = Number(sumaCobradas) / cobradas
  return `promedio ${formatearPrecio(promedio.toFixed(2))}`
}

/**
 * El pie del tile "Anuladas": lo DEVUELTO, no el total del período de al
 * lado — son dos agregados distintos (`SUM(total) WHERE anuladaEn IS NOT
 * NULL` acá, `WHERE anuladaEn IS NULL` en el tile de al lado) y mezclarlos
 * sería el mismo bug que ya evita `crearVenta` al no reutilizar sumas.
 */
export function pieDeAnuladas(montoDevuelto: string): string {
  return `${formatearPrecio(montoDevuelto)} devueltos`
}

/**
 * La celda "Medios" del listado: los medios distintos de una venta, en el
 * orden en que se cobraron, cada uno marcado con "· US$" si tuvo algún pago
 * en dólares (fila #1040 del relevamiento: "Efectivo · US$").
 *
 * **Decisión de UI que la maqueta no muestra**: ninguna de las siete filas de
 * ejemplo combina dos medios en la misma venta, así que no hay ninguna pista
 * de cómo resumir un pago partido entre efectivo y tarjeta. Acá se listan
 * los dos, separados por "+" — no es lo único razonable ("Mixto" también lo
 * sería), pero es el que no pierde información, y `Pago` ya admite varios
 * registros por venta a propósito (ver el comentario de ese modelo).
 */
export function rotuloDeMedios(pagos: { medio: Medio; moneda: 'ARS' | 'USD' }[]): string {
  if (pagos.length === 0) return '—'
  const conDolares = new Map<Medio, boolean>()
  for (const p of pagos) {
    conDolares.set(p.medio, (conDolares.get(p.medio) ?? false) || p.moneda === 'USD')
  }
  return [...conDolares.entries()]
    .map(([medio, usd]) => ROTULO_MEDIO[medio] + (usd ? ' · US$' : ''))
    .join(' + ')
}

/**
 * Hasta 5 números de página centrados en `actual`, recortados a `[1, total]`.
 *
 * Sin "…": la maqueta (design/arandano.pen, nodo `KRTvR`) dibuja tres botones
 * fijos sin elipsis, y un total real de más de 5 páginas no tiene ningún
 * ejemplo del que copiar ese tratamiento — se prefirió la ventana simple, sin
 * inventar un símbolo que el diseño no pidió.
 */
export function ventanaDePaginas(actual: number, total: number): number[] {
  if (total <= 0) return []
  const tam = Math.min(5, total)
  const inicioCentrado = actual - Math.floor(tam / 2)
  const fin = Math.min(total, Math.max(tam, inicioCentrado + tam - 1))
  const inicio = fin - tam + 1
  const out: number[] = []
  for (let n = inicio; n <= fin; n++) out.push(n)
  return out
}

/**
 * Un tile del resumen del período.
 *
 * `marca` sólo lo pide el tile de "Total del período": es el ancla de
 * `--marca` que docs/sistema-de-diseno.md ya lista para esta pantalla ("Lo
 * que entró en el período"), así que ANTES de este ciclo el código
 * contradecía su propio sistema de diseño escrito — no sólo la maqueta.
 */
function Tile({
  rotulo, valor, pie, marca = false,
}: { rotulo: string; valor: string; pie?: string; marca?: boolean }) {
  if (marca) {
    return (
      <div
        className="flex flex-1 flex-col gap-[3px] rounded-2xl px-[18px] py-4"
        style={{ backgroundColor: 'var(--marca)' }}
      >
        <div
          className="text-[10px] font-bold tracking-[1.2px] uppercase"
          style={{ color: 'var(--marca-soft)' }}
        >
          {rotulo}
        </div>
        <div
          style={{ color: 'var(--marca-foreground)' }}
          className={`${estilos.archivo} text-[32px] leading-none font-semibold tracking-[-0.6px] tabular-nums`}
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
    <div className="flex flex-1 flex-col gap-[3px] rounded-2xl border bg-card px-[18px] py-4">
      <div className="text-[10px] font-bold tracking-[1.2px] text-muted-foreground uppercase">
        {rotulo}
      </div>
      {/* tabular-nums en los tres, no sólo en el de plata: los tiles están uno
          al lado del otro y un dígito de ancho variable los descalza entre sí. */}
      <div
        className={`${estilos.archivo} text-[26px] leading-none font-semibold tracking-[-0.6px] tabular-nums text-foreground`}
      >
        {valor}
      </div>
      {pie && <div className="text-[11px] text-muted-foreground">{pie}</div>}
    </div>
  )
}

export default async function Ventas({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; p?: string }>
}) {
  const sesion = await exigirSesion()
  const { desde, hasta, p = '1' } = await searchParams

  const hoy = hoyEnArgentina()
  // Una fecha malformada cae en hoy en vez de romper el `new Date`, igual que
  // el clamp de `?p` del listado de inventario: un query string escrito a mano
  // no puede servir un 500.
  const dDesde = fechaOhoy(desde, hoy)
  const dHasta = fechaOhoy(hasta, hoy)
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)

  const donde = {
    creadoEn: {
      gte: inicioDelDia(dDesde),
      // El día "hasta" entra entero: se corta al inicio del siguiente.
      lt: new Date(inicioDelDia(dHasta).getTime() + 24 * 60 * 60 * 1000),
    },
  }

  const prisma = prismaParaTenant(sesion.tenant.id)
  const [ventas, total, suma, anuladas, devueltas, pagos] = await Promise.all([
    prisma.venta.findMany({
      where: donde,
      orderBy: { numero: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, numero: true, total: true, creadoEn: true, anuladaEn: true,
        cliente: { select: { nombre: true } },
        // orderBy explícito: rotuloDeMedios() documenta "en el orden en que
        // se cobraron", y sin esto Postgres no promete ningún orden — el
        // resultado podía coincidir con la inserción por accidente, no por
        // contrato.
        pagos: { select: { medio: true, moneda: true }, orderBy: { creadoEn: 'asc' } },
        _count: { select: { items: true } },
      },
    }),
    prisma.venta.count({ where: donde }),
    // El total del período NO suma las anuladas: una venta anulada no es plata
    // que entró. Se dice en pantalla para que nadie tenga que deducirlo. La
    // regla vive en totalDelPeriodo() y no acá — ver su comentario para el
    // porqué de la extracción.
    totalDelPeriodo(prisma, donde),
    // Se cuentan las anuladas y NO las cobradas: cobradas = total - anuladas es
    // aritmética sobre dos números que ya vienen de la misma transacción, así
    // que no puede dar una suma que no cierre contra el listado.
    prisma.venta.count({ where: { ...donde, anuladaEn: { not: null } } }),
    // Lo DEVUELTO del tile de anuladas: un agregado propio, y no el mismo
    // `suma` de arriba con el filtro invertido reusado a mano — son sumas de
    // conjuntos disjuntos y cada una necesita su propio `_sum`.
    prisma.venta.aggregate({ where: { ...donde, anuladaEn: { not: null } }, _sum: { total: true } }),
    // Los pagos del período, para el panel de composición. Se filtran por la
    // VENTA y no por `pago.creadoEn`: es el mismo `donde` que el listado y que
    // los tiles, así que las tres cosas de la pantalla no pueden hablar de
    // períodos distintos.
    //
    // `groupBy` y no `$queryRaw` con un `SUM(monto * cotizacion)`, que sería la
    // consulta obvia: la extensión de lib/tenant/prisma.ts intercepta
    // operaciones de MODELO, no raw queries, así que un raw no lleva el
    // `set_config('arandano.tenant_id')` y RLS lo devuelve VACÍO. No falla:
    // devuelve cero filas, que en un panel de plata se lee como "no vendiste
    // nada". La multiplicación se hace en JS sobre estas pocas filas.
    // `monto` va en la clave y se cuenta en vez de sumarse: es lo que mantiene
    // el redondeo POR PAGO, igual que `totalDePagos`. Con `_sum` el panel y el
    // tile "Total del período" se separaban por centavos. Ver composicion.ts.
    prisma.pago.groupBy({
      by: ['medio', 'moneda', 'cotizacion', 'monto'],
      where: { venta: { ...donde, anuladaEn: null } },
      _count: true,
    }),
  ])

  const composicion = componerPorMedio(pagos)
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conPagina = (n: number) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (n > 1) u.set('p', String(n))
    return `/ventas?${u.toString()}`
  }
  const hrefRango = (r: Rango) => {
    const { desde: d, hasta: h } = rangoDeChip(r, hoy)
    return `/ventas?${new URLSearchParams({ desde: d, hasta: h }).toString()}`
  }
  const rangoVigente = chipActivo(dDesde, dHasta, hoy)
  const cobradas = total - anuladas

  return (
    <>
      <Encabezado
        titulo="Ventas"
        subtitulo={
          <>
            {dDesde === dHasta ? fechaLarga(dDesde) : `${fechaLarga(dDesde)} — ${fechaLarga(dHasta)}`}
            {/* El conteo sólo si hay algo que contar, igual que el subtítulo de
                /inventario y por la misma razón: un "· 0 ventas" arriba del
                "No hay ventas en ese período" es ruido al lado de un texto de
                vacío que ya lo dice. Dos pantallas del mismo ciclo no pueden
                contestar distinto la misma pregunta. */}
            {total > 0 && (
              <>
                {' · '}
                {total === 1 ? '1 venta' : `${formatearCantidad(String(total))} ventas`}
              </>
            )}
          </>
        }
        acciones={
          <Button asChild size="sm">
            <Link href="/vender">Vender</Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        {/* Filtros: fechas + accesos rápidos de rango (design/arandano.pen,
            nodo `H9Bw1`). method="get": anda sin JavaScript y una URL con el
            rango se comparte. */}
        <form method="get" className="flex items-end gap-[10px]">
          <div className="flex w-[168px] flex-col gap-[5px]">
            <label htmlFor="desde" className="text-[11px] font-semibold text-foreground-soft">
              Desde
            </label>
            <Input
              id="desde" name="desde" type="date" defaultValue={dDesde}
              className="h-10 rounded-[9px] border-input bg-card px-[11px] text-sm"
            />
          </div>
          <div className="flex w-[168px] flex-col gap-[5px]">
            <label htmlFor="hasta" className="text-[11px] font-semibold text-foreground-soft">
              Hasta
            </label>
            <Input
              id="hasta" name="hasta" type="date" defaultValue={dHasta}
              className="h-10 rounded-[9px] border-input bg-card px-[11px] text-sm"
            />
          </div>
          <Button
            type="submit" variant="outline" size="sm"
            className="h-[38px] gap-[7px] rounded-[9px] border-input bg-card px-[15px] text-[13px] font-semibold text-foreground hover:bg-muted"
          >
            <Funnel aria-hidden="true" className="size-[15px]" />
            Filtrar
          </Button>
          <div className="flex-1" />
          {/* Rangos: segmented control de 3 opciones. Links y no botones de
              cliente: el rango vive en la URL, igual que el resto del filtro. */}
          <div className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]">
            {RANGOS.map((r) => (
              <Link
                key={r}
                href={hrefRango(r)}
                className={
                  r === rangoVigente
                    ? 'rounded-lg bg-card px-[13px] py-[7px] text-[12px] font-semibold text-foreground shadow-sm'
                    : 'rounded-lg px-[13px] py-[7px] text-[12px] font-medium text-muted-foreground'
                }
              >
                {ROTULO_RANGO[r]}
              </Link>
            ))}
          </div>
        </form>

        {/* Fila: las dos columnas — el listado a la izquierda, la composición
            de medios a la derecha (design/arandano.pen, nodo `dP70c`). */}
        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-4">
            {/* Sobre `total`, que es el período, y NO sobre `ventas.length`, que es la
                página: los tres números que muestran estos tiles —total, suma y
                anuladas— salen de agregados sin paginar. Colgados de la página, un
                `/ventas?p=5` sobre un período de una sola página los hacía
                desaparecer, cuando lo que resumen sigue estando ahí. */}
            {total > 0 && (
              <div className="flex gap-4">
                <Tile
                  marca
                  rotulo="Total del período"
                  valor={formatearPrecio((suma._sum.total ?? '0').toString())}
                  pie="sin contar las anuladas"
                />
                <Tile
                  rotulo="Ventas cobradas"
                  valor={formatearCantidad(String(cobradas))}
                  pie={pieDeCobradas((suma._sum.total ?? '0').toString(), cobradas)}
                />
                <Tile
                  rotulo="Anuladas"
                  valor={formatearCantidad(String(anuladas))}
                  pie={pieDeAnuladas((devueltas._sum.total ?? '0').toString())}
                />
              </div>
            )}

            {/* El listado, dentro de su propia card (design/arandano.pen, nodo
                `niIY5`) — antes era una <table> suelta en la pantalla. */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
                <h2 className={`${estilos.tituloDeCard} text-foreground`}>Últimas ventas</h2>
                {/* SIN "Ver todas →" (I7 de la review final): la maqueta la
                    dibuja —probablemente residuo de un card de dashboard
                    reusado, no una decisión sobre ESTA pantalla— pero esta
                    pantalla YA es el listado completo del período que se está
                    mirando, y no hay ningún destino más grande sin sumar un
                    modo sin rango (lógica de consulta nueva, fuera de este
                    ciclo). El link apuntaba a `/ventas` pelado, que resuelve a
                    "hoy": parado en "Este mes" con 300 ventas, ese link dejaba
                    con las 12 de hoy — MENOS ventas, no más. Si el
                    razonamiento de por qué no hay un destino mejor es
                    correcto, la conclusión es no dibujar el link, no dibujarlo
                    apuntando a un subconjunto. */}
              </div>

              {ventas.length === 0 ? (
                <p className="p-[18px] text-sm text-muted-foreground">
                  {/* Los dos vacíos no son el mismo vacío, y desde que los tiles cuelgan
                      del período hay que distinguirlos: con `total > 0` la página quedó
                      fuera de rango (`?p` se clampea a [1, 1.000.000], no a `paginas`),
                      y decir "no hay ventas en ese período" arriba de un tile que dice
                      17 sería contradecirse en la misma pantalla. */}
                  {total === 0 ? (
                    'No hay ventas en ese período.'
                  ) : (
                    <>
                      Esa página no tiene ventas.{' '}
                      {/* Load-bearing, y más ahora que antes: el `<nav>` de
                          paginación vive DENTRO de la rama `ventas.length > 0`
                          de más abajo, así que en este vacío por página fuera
                          de rango (`?p` clampeado a [1, 1.000.000], no a
                          `paginas`) no se dibuja ningún control de página —
                          este link es la ÚNICA salida de acá sin editar la
                          URL a mano. */}
                      <Link href={conPagina(1)} className="underline">
                        Volver a la primera
                      </Link>
                      .
                    </>
                  )}
                </p>
              ) : (
                <>
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="bg-muted hover:bg-muted">
                        <TableHead className="h-auto w-[84px] px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                          Número
                        </TableHead>
                        <TableHead className="h-auto w-[110px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                          Hora
                        </TableHead>
                        <TableHead className="h-auto px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                          {/* "Cliente" y no "Vendió" (I5 de la review final):
                              el dato de esta columna es el comprador —más útil
                              en un historial de ventas que quién vendió—, y el
                              rótulo tenía que decir eso, no lo contrario. Quién
                              vendió sigue disponible, en el panel Resumen del
                              detalle. */}
                          Cliente
                        </TableHead>
                        <TableHead className="h-auto w-[168px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                          Medios
                        </TableHead>
                        <TableHead className="h-auto w-[140px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                          Total
                        </TableHead>
                        <TableHead className="h-auto w-[104px] px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                          Estado
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ventas.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell
                            className={`${estilos.archivo} p-[11px] px-[7px] pl-[18px] font-semibold text-primary`}
                          >
                            <Link href={`/ventas/${v.id}`}>#{v.numero}</Link>
                          </TableCell>
                          <TableCell className="p-[11px] px-[7px] text-foreground">
                            {formatearHora(v.creadoEn)}
                          </TableCell>
                          <TableCell className="p-[11px] px-[7px] whitespace-normal">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-medium text-foreground">
                                {v.cliente?.nombre ?? CONSUMIDOR_FINAL}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {v._count.items === 1 ? '1 artículo' : `${v._count.items} artículos`}
                              </span>
                            </div>
                          </TableCell>
                          {/* truncate (I4 de la review final): el pago
                              partido es la norma acá, no la excepción (ver el
                              comentario de `model Pago`), así que
                              "Efectivo + Transferencia" (~155px) es un caso de
                              todos los días, no un borde — y a 155px ya se
                              derramaba sobre "Total" con el ancho viejo de
                              150px. Ensanchar la columna atrasa el problema,
                              no lo cierra: tres medios en la misma venta lo
                              vuelve a desbordar. `title` deja el texto
                              completo a un hover, para no perder el dato que
                              el truncado esconde. */}
                          <TableCell
                            className="truncate p-[11px] px-[7px] text-foreground"
                            title={rotuloDeMedios(v.pagos)}
                          >
                            {rotuloDeMedios(v.pagos)}
                          </TableCell>
                          <TableCell
                            className={`${estilos.archivo} p-[11px] px-[7px] text-right font-semibold text-foreground tabular-nums`}
                          >
                            {formatearPrecio(v.total.toString())}
                          </TableCell>
                          {/* Las anuladas se MUESTRAN: el historial tiene que
                              poder responder qué pasó, y esconderlas sería
                              tapar la respuesta. */}
                          <TableCell className="p-[11px] px-[7px] pr-[18px] text-right">
                            <ChipEstado anulada={v.anuladaEn !== null} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {paginas > 1 && (
                    <nav
                      aria-label="Paginación"
                      className="flex items-center justify-between border-t px-[18px] py-3"
                    >
                      {/* Los tres números con el mismo formateador: antes sólo
                          "de N" pasaba por formatearCantidad y el rango
                          quedaba en dígitos crudos ("1001–1050 de 1.234
                          ventas") — mezcla de formatos en la misma línea. */}
                      <span className="text-[12px] text-muted-foreground">
                        {formatearCantidad(String((pagina - 1) * POR_PAGINA + 1))}–
                        {formatearCantidad(String(Math.min(pagina * POR_PAGINA, total)))} de{' '}
                        {formatearCantidad(String(total))} {total === 1 ? 'venta' : 'ventas'}
                      </span>
                      <div className="flex items-center gap-[6px]">
                        {ventanaDePaginas(pagina, paginas).map((n) =>
                          n === pagina ? (
                            // `type="button"` y sin `disabled`: un botón
                            // disabled no es focusable, así que quien navega
                            // por teclado perdía de vista en qué página
                            // estaba parado apenas la pestañeaba. `aria-current`
                            // es lo que la reemplaza como señal de "estás acá".
                            <Button
                              key={n}
                              type="button"
                              aria-current="page"
                              size="icon-sm"
                              className={`${estilos.archivo} size-[30px] rounded-lg text-[13px] font-semibold`}
                            >
                              {n}
                            </Button>
                          ) : (
                            <Button
                              key={n}
                              asChild
                              variant="outline"
                              size="icon-sm"
                              className={`${estilos.archivo} size-[30px] rounded-lg text-[13px] font-semibold text-foreground-soft`}
                            >
                              <Link href={conPagina(n)}>{n}</Link>
                            </Button>
                          ),
                        )}
                      </div>
                    </nav>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Colgado de que HAYA barras y no de `total > 0`, que es lo que
              gobierna los tiles: un período puede tener ventas y ningún pago
              —todas anuladas— y ahí este panel no tiene nada que decir.
              Dibujarlo vacío sería peor que no dibujarlo: un panel en blanco
              se lee como que algo se rompió. */}
          {composicion.barras.length > 0 && <GraficoDeMedios composicion={composicion} />}
        </div>
      </div>
    </>
  )
}
