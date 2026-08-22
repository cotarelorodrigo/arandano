import { notFound } from 'next/navigation'
import { Prisma } from '@/generated/prisma/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { FichaDeArticulo, MoverStock } from '../formularios'
import { formatearPrecio, formatearCantidad, formatearFecha } from '@/lib/formato/mostrar'
import { esUuid } from '@/lib/uuid'
import estilos from '../tipografia.module.css'

export const dynamic = 'force-dynamic'

const MOVIMIENTOS_VISIBLES = 50

const NOMBRE_DE_MOTIVO: Record<string, string> = {
  VENTA: 'Venta',
  ANULACION_VENTA: 'Anulación de venta',
  AJUSTE: 'Ajuste',
  INGRESO: 'Ingreso',
}

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

  const [movimientos, ultimoConCosto] = await Promise.all([
    prisma.movimientoStock.findMany({
      where: { articuloId: id },
      orderBy: { creadoEn: 'desc' },
      take: MOVIMIENTOS_VISIBLES,
      select: {
        id: true, delta: true, motivo: true, nota: true, creadoEn: true,
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
          orderBy: { creadoEn: 'desc' },
          select: { costoUnitario: true },
        })
      : null,
  ])

  const ultimoCosto = ultimoConCosto?.costoUnitario ?? null

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
      <section>
        <h2 className="mb-3 text-base font-medium">Historial</h2>
        {movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hubo movimientos de este artículo.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Fecha</th>
                <th>Motivo</th>
                <th className="text-right">Cambio</th>
                <th>Quién</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="py-2">{formatearFecha(m.creadoEn)}</td>
                  <td>{NOMBRE_DE_MOTIVO[m.motivo] ?? m.motivo}</td>
                  <td
                    className={`text-right tabular-nums ${
                      m.delta.lessThan(0) ? 'text-destructive' : ''
                    }`}
                  >
                    {/* El signo explícito en el positivo: la columna se lee de
                        un vistazo como "entró" o "salió". */}
                    {m.delta.greaterThan(0) ? '+' : ''}
                    {formatearCantidad(m.delta.toString())}
                  </td>
                  <td>{m.usuario.nombre}</td>
                  <td className="text-muted-foreground">
                    {m.venta ? `Venta #${m.venta.numero}` : (m.nota ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {movimientos.length === MOVIMIENTOS_VISIBLES && (
          <p className="mt-3 text-sm text-muted-foreground">
            Se muestran los últimos {MOVIMIENTOS_VISIBLES} movimientos.
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
