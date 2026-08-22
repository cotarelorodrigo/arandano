import { notFound } from 'next/navigation'
import { Prisma } from '@/generated/prisma/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { cn } from '@/lib/utils'
import { FichaDeArticulo, MoverStock, BotonExportarCsv } from '../formularios'
import { ChipMotivo, detalleDeMovimiento, formatearFechaMovimiento, calcularSaldos } from '../historial'
import { GraficoDeRotacion, agregarVentasPorMes } from '../rotacion'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import { esUuid } from '@/lib/uuid'
import estilos from '../tipografia.module.css'

export const dynamic = 'force-dynamic'

const MOVIMIENTOS_VISIBLES = 50

/**
 * Días corridos entre `fecha` y `ahora`, por fecha CALENDARIO de Buenos Aires.
 *
 * Copiado de `diasEnElLocal` (`lib/ordenes-de-trabajo/antiguedad.ts`), no
 * importado desde ahí: son el mismo cálculo pero de dos módulos que no tienen
 * por qué conocerse — servicio técnico y órdenes de trabajo del núcleo son
 * cosas distintas, y esta task no es el ciclo que extrae el duplicado a un
 * lib compartido (mismo criterio que `ventanaDePaginas`, copiada igual entre
 * `/inventario` y `/ventas`).
 */
function diasDesde(fecha: Date, ahora: Date): number {
  const comoDiaDeBuenosAires = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(d)
  const inicio = new Date(`${comoDiaDeBuenosAires(fecha)}T00:00:00-03:00`)
  const hoy = new Date(`${comoDiaDeBuenosAires(ahora)}T00:00:00-03:00`)
  return Math.max(0, Math.round((hoy.getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000)))
}

/**
 * El pie del tile "Precio de venta" (design/arandano.pen, nodo `xEw3t`):
 * "actualizado hace 6 días". Sale de `Articulo.actualizadoEn`, que ya existe
 * — sin migración, sin lector nuevo del schema.
 *
 * `ahora` es un parámetro y no `new Date()` adentro, por lo mismo que
 * `diasEnElLocal`: así se puede testear el cruce de un día sin mockear el
 * reloj del sistema.
 */
export function actualizadoHace(actualizadoEn: Date, ahora: Date = new Date()): string {
  const dias = diasDesde(actualizadoEn, ahora)
  if (dias === 0) return 'actualizado hoy'
  if (dias === 1) return 'actualizado hace 1 día'
  return `actualizado hace ${dias} días`
}

const MARGEN = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * El pie del tile "Último costo" (design/arandano.pen, nodo `U6w59p`):
 * "margen 38,3 %", calculado como `(precio − costo) / precio` — CONTRA el
 * precio de venta ACTUAL, no contra un promedio de costos históricos (la
 * cuenta está verificada en el relevamiento, sección 6: con precio $12.000 y
 * costo $7.400 da exactamente 38,3 %, y `(precio − costo) / costo` daría
 * 62,2 %, que no es el número que muestra la maqueta).
 *
 * `null` en dos casos, nunca un número inventado (CLAUDE.md: "si el artículo
 * no tiene ningún movimiento con costo, no inventes un número"): sin costo
 * cargado, o con un precio que no permite dividir (cero — `exigirPrecio` en
 * `lib/inventario/articulos.ts` prohíbe negativo pero no cero).
 */
export function textoDeMargen(precio: Prisma.Decimal, costo: Prisma.Decimal | null): string | null {
  if (costo === null) return null
  if (precio.lessThanOrEqualTo(0)) return null
  const margen = precio.minus(costo).dividedBy(precio).times(100)
  return `margen ${MARGEN.format(margen.toNumber())} %`
}

/**
 * Un tile de métrica de la ficha (design/arandano.pen, frame `y4tEb`, nodo
 * `X6JFj4`): "En stock", "Precio de venta", "Último costo".
 *
 * `marca` sólo lo pide "En stock": es el ancla de `--marca` que
 * `docs/sistema-de-diseno.md` ya lista para esta pantalla ("Bloque de stock
 * en la ficha de un artículo | Cuánto hay"), así que antes de esta task el
 * código contradecía su propio sistema de diseño escrito — mismo hallazgo que
 * ya cerró el tile de "Total del período" en `/ventas` (`Tile` de
 * `app/(app)/ventas/page.tsx`, mismo patrón, pero acá el valor va en 34 px y
 * no en 32: la maqueta de esta pantalla usa un tamaño distinto para su tile
 * de marca).
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
          className={`${estilos.archivo} text-[34px] leading-none font-semibold tracking-[-0.6px] tabular-nums`}
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
        className={`${estilos.archivo} text-[24px] leading-none font-semibold tracking-[-0.6px] tabular-nums text-foreground`}
      >
        {valor}
      </div>
      {pie && <div className="text-[11px] text-muted-foreground">{pie}</div>}
    </div>
  )
}

export default async function DetalleDeArticulo({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // `notFound()` y no un 500: `/inventario/foo` es algo que alguien escribe en
  // la barra de direcciones, y la respuesta correcta es la misma que para un
  // id de otro tenant — no existe. Sin esto, Prisma rechaza el valor con P2007
  // y la pantalla se cae. Es el mismo criterio que el clamp de `?p` en el
  // listado.
  if (!esUuid(id)) notFound()

  const prisma = prismaParaTenant(sesion.tenant.id)
  const articulo = await prisma.articulo.findUnique({ where: { id } })
  // RLS ya filtró por tenant, así que "no existe" y "es de otro negocio" son el
  // mismo 404 — y tienen que serlo: distinguirlos filtraría qué ids existen.
  if (!articulo) notFound()

  const esDuenio = sesion.usuario.rol === 'DUENO'
  const esProducto = articulo.tipo === 'PRODUCTO'

  // Seis meses de sobra para "Cómo se movió": agregarVentasPorMes() sólo usa
  // los últimos 6, así que traer un poco más de margen (7) cubre el borde de
  // un movimiento del día 1 del mes más viejo en un huso distinto al de la
  // consulta, sin costar nada — son pocas filas por artículo.
  const SIETE_MESES_ATRAS = new Date()
  SIETE_MESES_ATRAS.setUTCMonth(SIETE_MESES_ATRAS.getUTCMonth() - 7)

  const [movimientos, ultimoConCosto, ventasPorMes] = await Promise.all([
    prisma.movimientoStock.findMany({
      where: { articuloId: id },
      // `id` como segundo criterio, no sólo `creadoEn`: `creado_en` es la
      // hora de INICIO de transacción, así que dos movimientos escritos en la
      // misma transacción comparten timestamp y su orden queda indefinido sin
      // desempate — y como el CSV (`acciones.ts`) corre esta misma consulta
      // por separado, la pantalla y el CSV podían mostrar "Queda" distinto
      // para las mismas filas. `id` es `uuid(7)`, ordenable por tiempo.
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      take: MOVIMIENTOS_VISIBLES,
      select: {
        id: true, delta: true, motivo: true, nota: true, creadoEn: true, costoUnitario: true,
        usuario: { select: { nombre: true } },
        venta: { select: { numero: true } },
      },
    }),
    // Un servicio nunca tiene movimientos (lib/inventario/stock.ts los
    // rechaza), así que ni vale consultar: `findFirst` sobre un articuloId sin
    // filas siempre da null igual, pero saltearlo evita una ida a Postgres que
    // ya se sabe vacía.
    esProducto
      ? prisma.movimientoStock.findFirst({
          // El ingreso más reciente puede no tener costo cargado —es opcional,
          // CLAUDE.md— así que el filtro es explícito: el primero CON costo,
          // no el primero a secas.
          where: { articuloId: id, costoUnitario: { not: null } },
          // Mismo desempate que la consulta de movimientos de arriba: dos
          // ingresos de la misma transacción comparten `creadoEn`.
          orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
          select: { costoUnitario: true },
        })
      : null,
    // Mismo motivo que el de arriba: un servicio no vende con movimiento de
    // stock (no tiene), así que "Cómo se movió" no tiene nada que graficar.
    esProducto
      ? prisma.movimientoStock.findMany({
          where: {
            articuloId: id,
            motivo: 'VENTA',
            creadoEn: { gte: SIETE_MESES_ATRAS },
            // Mismo criterio que /ventas (docs/pantallas.md, sección
            // /ventas: "El total NO suma las anuladas"): sin este filtro, una
            // venta anulada seguía sumando sus unidades acá aunque el
            // ANULACION_VENTA le haya devuelto el stock al artículo — el
            // mismo hecho de negocio contado distinto en dos pantallas.
            // Filtrar la fila VENTA por `venta.anuladaEn` hace que la unidad
            // desaparezca del mes en que se vendió, en vez de aparecer
            // restada en el mes en que se anuló (que puede ser otro).
            venta: { anuladaEn: null },
          },
          select: { delta: true, creadoEn: true },
        })
      : [],
  ])

  const ultimoCosto = ultimoConCosto?.costoUnitario ?? null
  // La columna "Queda" (decisión ya tomada, historial.ts: calcularSaldos): se
  // RECONSTRUYE recorriendo los deltas hacia atrás desde el stock actual, no
  // se guarda en ninguna columna nueva.
  const saldos = calcularSaldos(
    movimientos.map((m) => m.delta),
    articulo.stock,
  )
  const meses = agregarVentasPorMes(
    ventasPorMes.map((m) => ({ delta: m.delta.toString(), creadoEn: m.creadoEn })),
  )

  const columnaIzquierda = (
    <>
      <div className="flex gap-4">
        {esProducto && (
          <Tile
            marca
            rotulo="EN STOCK"
            valor={formatearCantidad(articulo.stock.toString())}
            pie="unidades disponibles"
          />
        )}
        <Tile
          rotulo="PRECIO DE VENTA"
          valor={formatearPrecio(articulo.precio.toString())}
          pie={actualizadoHace(articulo.actualizadoEn)}
        />
        {esProducto && (
          <Tile
            rotulo="ÚLTIMO COSTO"
            valor={ultimoCosto ? formatearPrecio(ultimoCosto.toString()) : '—'}
            pie={
              ultimoCosto
                ? (textoDeMargen(articulo.precio, ultimoCosto) ?? 'el precio no permite calcular el margen')
                : 'ningún ingreso cargó el costo todavía'
            }
          />
        )}
      </div>

      {esProducto && !articulo.desactivadoEn && <MoverStock articuloId={articulo.id} />}

      {/* El bloque que responde "por qué tengo 3 y no 5", que es la pregunta
          que un dueño hace cuando el inventario no le cierra. Es para lo que la
          tabla es append-only. */}
      <section className="flex flex-col overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between border-b px-[18px] py-[13px]">
          <h2 className={`${estilos.tituloDeCard} text-foreground`}>Historial de movimientos</h2>
          <BotonExportarCsv articuloId={articulo.id} />
        </div>
        {movimientos.length === 0 ? (
          <p className="p-[18px] text-sm text-muted-foreground">
            Todavía no hubo movimientos de este artículo.
          </p>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="h-auto w-[150px] px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Fecha
                </TableHead>
                <TableHead className="h-auto w-[170px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Motivo
                </TableHead>
                <TableHead className="h-auto px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Detalle
                </TableHead>
                <TableHead className="h-auto w-[110px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Cambio
                </TableHead>
                <TableHead className="h-auto w-[100px] px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Queda
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimientos.map((m, i) => (
                <TableRow key={m.id}>
                  <TableCell className="p-[11px] px-[7px] pl-[18px] text-sm text-foreground">
                    {formatearFechaMovimiento(m.creadoEn)}
                  </TableCell>
                  <TableCell className="p-[11px] px-[7px]">
                    <ChipMotivo motivo={m.motivo} />
                  </TableCell>
                  {/* truncate y no sólo whitespace-nowrap (el default de
                      TableCell): esta celda es la única de ancho flexible, y
                      una nota larga sin truncar se derrama sobre la celda de
                      Cambio en vez de cortarse con "…". */}
                  <TableCell className="max-w-0 truncate p-[11px] px-[7px] text-sm text-muted-foreground">
                    {detalleDeMovimiento(m)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      estilos.archivo,
                      'p-[11px] px-[7px] text-right font-semibold tabular-nums',
                      m.delta.lessThan(0) ? 'text-destructive' : 'text-ok',
                    )}
                  >
                    {/* El signo explícito en el positivo: la columna se lee de
                        un vistazo como "entró" o "salió". */}
                    {m.delta.greaterThan(0) ? '+' : ''}
                    {formatearCantidad(m.delta.toString())}
                  </TableCell>
                  <TableCell
                    className={cn(
                      estilos.archivo,
                      'p-[11px] px-[7px] pr-[18px] text-right font-semibold tabular-nums text-foreground',
                    )}
                  >
                    {formatearCantidad(saldos[i].toString())}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {movimientos.length === MOVIMIENTOS_VISIBLES && (
          <p className="border-t px-[18px] py-3 text-sm text-muted-foreground">
            Se muestran los últimos {MOVIMIENTOS_VISIBLES} movimientos. Exportar CSV trae el
            historial completo.
          </p>
        )}
      </section>
    </>
  )

  return (
    <FichaDeArticulo
      titulo={articulo.nombre}
      subtitulo={
        <>
          SKU {articulo.sku} · {esProducto ? 'Producto' : 'Servicio'}
          {/* La maqueta (design/arandano.pen, nodo `chN9u`) no repite el
              precio acá: ya tiene su propio tile en la columna izquierda, y
              mostrarlo dos veces en la misma pantalla es la clase de
              redundancia que el propio sistema de diseño evita en otros
              lados. */}
          {articulo.categoria && <> · {articulo.categoria}</>}
        </>
      }
      articuloId={articulo.id}
      desactivado={articulo.desactivadoEn !== null}
      esDuenio={esDuenio}
      nombre={articulo.nombre}
      sku={articulo.sku}
      precio={articulo.precio.toString()}
      categoria={articulo.categoria}
      columnaIzquierda={columnaIzquierda}
      columnaDerechaExtra={esProducto ? <GraficoDeRotacion meses={meses} /> : undefined}
    >
      {articulo.desactivadoEn && (
        <Alert>
          <AlertDescription>
            Este artículo está desactivado: no aparece en el listado ni se ofrece para operaciones
            nuevas.
          </AlertDescription>
        </Alert>
      )}
    </FichaDeArticulo>
  )
}
