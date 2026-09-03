import { notFound } from 'next/navigation'
import { Prisma } from '@/generated/prisma/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { exigirSesion } from '@/lib/auth/sesion'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { FichaDeArticulo, MoverStock, BotonExportarCsv } from '../formularios'
import { CardDeUnidades, SwitchDeSerie } from '../unidades'
import { calcularSaldos, filaDeMovimiento, HistorialDeMovimientos } from '../historial'
import { GraficoDeRotacion, agregarVentasPorMes } from '../rotacion'
import { formatearPrecio, formatearCantidad, precioEnSuMoneda } from '@/lib/formato/mostrar'
import { esUuid } from '@/lib/uuid'
import { planesDelTenant, type PlanVisible } from '@/lib/planes/consultar'
import { arbolDeCategorias } from '@/lib/inventario/categorias'
import { unidadesLibres } from '@/lib/inventario/unidades'
import { precioConPlan } from '@/lib/planes/precio'
import { ROTULO_MEDIO } from '@/lib/ventas/medios'
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
 * `null` en tres casos, nunca un número inventado (CLAUDE.md: "si el
 * artículo no tiene ningún movimiento con costo, no inventes un número"):
 * sin costo cargado, con un precio que no permite dividir (cero —
 * `exigirPrecio` en `lib/inventario/articulos.ts` prohíbe negativo pero no
 * cero), o con el artículo cargado en dólares. Este tercer caso es la
 * costura con la deuda del costo (CLAUDE.md, "Decisiones abiertas del
 * modelo de datos"): `MovimientoStock.costoUnitario` se guarda siempre en
 * PESOS, y este ciclo no lo cambia — comparar un costo en pesos contra un
 * precio en dólares exigiría inventar una cotización, y eso es peor que no
 * mostrar nada.
 */
export function textoDeMargen(
  precio: Prisma.Decimal,
  costo: Prisma.Decimal | null,
  moneda: 'ARS' | 'USD',
): string | null {
  if (moneda === 'USD') return null
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
 *
 * **Task 7 del ciclo móvil**: el tile de marca ("En stock") cambia de eje en
 * el teléfono (design/arandano.pen, frame `T5gME`, nodo `dnE5C`) — ahí es una
 * FILA (rótulo+pie a la izquierda, el valor grande a la derecha,
 * `justify-between`), mientras que en escritorio sigue siendo la columna de
 * siempre (rótulo arriba, valor, pie abajo). El envoltorio de rótulo+pie es
 * `contents` en escritorio para que sus dos hijos vuelvan a ser hermanos
 * directos del valor —con `lg:order-1`/`lg:order-2`/`lg:order-3` restaurando
 * el orden vertical—, mismo mecanismo que `Detalle` en
 * app/(app)/ventas/[id]/page.tsx. Exportado (antes no lo estaba) para que
 * este cambio se pueda cubrir por render real, no por FUENTE. Los tiles sin
 * marca también cambian: 19px de valor en el teléfono contra 24px en
 * escritorio (`I0TWua`/`eB6Wd` de `T5gME`).
 */
export function Tile({
  rotulo, valor, pie, marca = false,
}: { rotulo: string; valor: string; pie?: string; marca?: boolean }) {
  if (marca) {
    return (
      <div
        className="flex flex-1 items-center justify-between rounded-2xl px-[17px] py-[15px] lg:flex-col lg:items-stretch lg:justify-start lg:gap-[3px] lg:px-[18px] lg:py-4"
        style={{ backgroundColor: 'var(--marca)' }}
      >
        <div className="flex flex-col gap-[2px] lg:contents">
          <div
            className="text-[10px] font-bold tracking-[1.2px] uppercase lg:order-1"
            style={{ color: 'var(--marca-soft)' }}
          >
            {rotulo}
          </div>
          {pie && (
            <div className="text-[11px] lg:order-3" style={{ color: 'var(--marca-dim)' }}>
              {pie}
            </div>
          )}
        </div>
        <div
          style={{ color: 'var(--marca-foreground)' }}
          className={`${estilos.archivo} text-[34px] leading-none font-semibold tracking-[-0.6px] tabular-nums lg:order-2`}
        >
          {valor}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col gap-[3px] rounded-2xl border bg-card px-[15px] py-[14px] lg:px-[18px] lg:py-4">
      <div className="text-[10px] font-bold tracking-[1.2px] text-muted-foreground uppercase">
        {rotulo}
      </div>
      {/* tabular-nums en los tres, no sólo en el de plata: los tiles están uno
          al lado del otro y un dígito de ancho variable los descalza entre sí. */}
      <div
        className={`${estilos.archivo} text-[19px] leading-none font-semibold tracking-[-0.6px] tabular-nums text-foreground lg:text-[24px]`}
      >
        {valor}
      </div>
      {pie && <div className="text-[11px] text-muted-foreground">{pie}</div>}
    </div>
  )
}

/**
 * "Precios por forma de pago": el pedido original del cliente ("un precio
 * para crédito y otro para débito/efectivo/transferencia") hecho visible, sin
 * haber guardado un segundo número en ningún lado. Una fila por plan ACTIVO,
 * con el precio derivado calculado con `precioConPlan` (Task 3) — la MISMA
 * función que después usa el cobro en `/vender`, no una cuenta propia: si acá
 * se calculara distinto, la ficha podría estar mintiéndole al mostrador.
 *
 * `design/arandano.pen` no dibuja este panel — es posterior a los planes de
 * pago — y la deuda queda anotada en `docs/correcciones-pendientes-del-pen.md`
 * en vez de inventarle un frame.
 *
 * **Sin planes cargados, no hay panel** (`null`, no una card con una sola
 * fila): un local que no usa planes no tiene nada que mirar acá, y repetir el
 * precio de venta de arriba en una card aparte sería ruido.
 *
 * **Sin permiso, a propósito.** Es de sólo lectura, sobre el precio que la
 * misma ficha ya muestra en el tile de arriba, y quien cobra necesita poder
 * decirle a un cliente el precio en cuotas. `COSTOS` sigue tapando el costo y
 * el margen, que son otra cosa — no hay motivo para gatear esto detrás de él.
 *
 * **Task 8 (ciclo de USD): el precio derivado se muestra en la moneda del
 * artículo.** El recargo es un porcentaje puro, así que aplicarlo sobre un
 * precio en dólares da un resultado en dólares — US$ 300 al 40 % son
 * US$ 420, el mismo equivalente que el mostrador cobraría en pesos. No hay
 * conversión acá adentro, sólo el formateo: `precioConPlan` no sabe de
 * monedas y no tiene por qué saberlo.
 */
export function PanelPreciosPorFormaDePago({
  precio,
  moneda,
  planes,
}: {
  precio: Prisma.Decimal
  moneda: 'ARS' | 'USD'
  planes: PlanVisible[]
}) {
  if (planes.length === 0) return null
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      {/* Mobile-first, igual que todas sus cards hermanas de esta pantalla
          (`CardDelFormulario`, `GraficoDeRotacion`, el historial): 14 px de
          padding horizontal en el teléfono, 18 en escritorio. Sin esto la card
          quedaba 4 px más adentro que sus vecinas — esta pantalla SÍ está
          adaptada, así que acá no hay deuda a la que apuntar. */}
      <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Precios por forma de pago</h2>
      </div>
      <div className="flex flex-col divide-y">
        {planes.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-3 px-[14px] py-[11px] lg:px-[18px]"
          >
            <div className="flex flex-col gap-[2px]">
              <span className="text-[13px] font-medium text-foreground">{p.nombre}</span>
              <span className="text-[11px] text-muted-foreground">
                {ROTULO_MEDIO[p.medio]} · {p.cuotas === 1 ? '1 cuota' : `${p.cuotas} cuotas`}
              </span>
            </div>
            <span
              className={`${estilos.archivo} shrink-0 text-[13px] font-semibold tabular-nums text-foreground`}
            >
              {precioEnSuMoneda(
                precioConPlan(precio, new Prisma.Decimal(p.porcentaje)).toString(),
                moneda,
              )}
            </span>
          </div>
        ))}
      </div>
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

  const puedeEditar = await puedeConSesion(sesion, 'ARTICULOS_EDITAR')
  const puedeCostos = await puedeConSesion(sesion, 'COSTOS')
  const esProducto = articulo.tipo === 'PRODUCTO'

  // Seis meses de sobra para "Cómo se movió": agregarVentasPorMes() sólo usa
  // los últimos 6, así que traer un poco más de margen (7) cubre el borde de
  // un movimiento del día 1 del mes más viejo en un huso distinto al de la
  // consulta, sin costar nada — son pocas filas por artículo.
  const SIETE_MESES_ATRAS = new Date()
  SIETE_MESES_ATRAS.setUTCMonth(SIETE_MESES_ATRAS.getUTCMonth() - 7)

  const [movimientos, ultimoConCosto, ventasPorMes, planes, arbol, unidades] = await Promise.all([
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
    // ya se sabe vacía. Mismo criterio con `puedeCostos`: sin el permiso el
    // tile no se renderea (ver más abajo), así que el resultado nunca se usa
    // — no es una fuga, es un round-trip de más a Postgres.
    esProducto && puedeCostos
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
    // Sólo activos: un plan dado de baja ya no se ofrece al cobrar, así que
    // tampoco tiene sentido cotizarlo acá. Producto o servicio por igual —el
    // recargo por forma de pago es del medio, no del tipo de artículo—.
    planesDelTenant(sesion.tenant.id),
    // `verInactivos: true` a propósito, igual que en el alta: acá el árbol es
    // una LISTA DE OPCIONES, no un informe. Un rubro cuyos artículos están
    // todos dados de baja sigue siendo una opción válida, y esconderlo
    // obligaría a recrearlo con el mismo nombre — que chocaría contra el índice
    // único. Sólo se consulta si esta persona puede editar: sin
    // `ARTICULOS_EDITAR` la card "Datos" no se renderiza y el árbol no se usa.
    puedeEditar ? arbolDeCategorias(sesion.tenant.id, { verInactivos: true }) : [],
    // Task 6 del ciclo "unidades sin identificar": ya NO va condicionada a
    // `articulo.llevaSerie`. El ciclo anterior la condicionaba para no pagar
    // una ida a Postgres por cada artículo del catálogo, y el precio de eso
    // era el caso huérfano que su review dejó parked: un artículo con
    // unidades cargadas y el switch apagado no mostraba las unidades EN
    // NINGÚN LADO — invisibles, sin forma de darlas de baja ni de saber que
    // están. La consulta corre dentro del mismo `Promise.all` que ya dispara
    // otras seis, así que el costo real es una consulta en paralelo, no un
    // round-trip extra en serie.
    unidadesLibres(sesion.tenant.id, articulo.id),
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

  // Mismo motivo que el resto de la columna derecha: sin nada que mostrar en
  // ninguna de las dos secciones, `columnaDerechaExtra` tiene que quedar en
  // `undefined` — no un fragmento vacío, truthy igual, que dejaría la columna
  // de 324 px reservando un hueco sin contenido (ver el comentario de
  // `FichaDeArticulo` en `../formularios.tsx`).
  const hayPanelPrecios = planes.length > 0
  // `CardDeUnidades` recibe las unidades TAL COMO vienen, con su `imei`
  // nullable: desde la Task 6 la card es la que sabe qué hacer con las que
  // todavía no tienen número —el bloque de captura de arriba—, así que
  // filtrarlas acá volvería a esconderlas. El ternario que obligaba al `as
  // UnidadLibre[]` de la consulta se fue con la condición de arriba.

  const columnaDerechaExtra =
    hayPanelPrecios || esProducto || articulo.llevaSerie || unidades.length > 0 ? (
      <>
        {hayPanelPrecios && (
          <PanelPreciosPorFormaDePago precio={articulo.precio} moneda={articulo.moneda} planes={planes} />
        )}
        {/* La card "Unidades". Con el switch prendido siempre; y también con
            el switch APAGADO si quedaron unidades cargadas, que es la salida
            al caso huérfano (Task 6): sin este `||`, esas unidades no se
            verían en ningún lado ni habría forma de darlas de baja. Un
            servicio nunca tiene ninguna de las dos cosas, así que no hace
            falta sumar `esProducto`. */}
        {(articulo.llevaSerie || unidades.length > 0) && (
          <CardDeUnidades articuloId={articulo.id} unidades={unidades} />
        )}
        {esProducto && <GraficoDeRotacion meses={meses} />}
      </>
    ) : undefined

  // Task 7 del ciclo móvil: cada movimiento, ya resuelto a texto (fecha,
  // detalle, cambio con signo, queda), indexado contra `saldos` — el resto
  // de la lógica (ChipMotivo, el patrón grid) vive en `HistorialDeMovimientos`
  // (historial.tsx), que se renderiza sin Prisma ni sesión.
  //
  // `puedeCostos` viaja hasta acá (ciclo de permisos, 2026-08-26) porque el
  // texto de la celda "Detalle" de un INGRESO incluye el costo unitario: la
  // fila se resuelve a texto ANTES de renderizarse, así que el permiso tiene
  // que decidirse en el armado y no en el JSX — esconderlo después sería
  // mandarlo igual al HTML.
  const filasHistorial = movimientos.map((m, i) => filaDeMovimiento(m, saldos[i], puedeCostos))

  const columnaIzquierda = (
    <>
      {/* El grupo de tiles se apila en el teléfono (Task 7 del ciclo móvil,
          frame `T5gME`): "En stock" ocupa su propia fila completa (con su
          propio quiebre de eje, ver el docblock de `Tile`), y "Precio de
          venta"/"Último costo" comparten la fila siguiente — el envoltorio
          interno es `contents` en escritorio para que sus dos Tile se sumen
          a la fila de "En stock" y quede la misma fila de tres de siempre. */}
      <div className="order-1 flex flex-col gap-3 lg:order-none lg:flex-row lg:gap-4">
        {esProducto && (
          <Tile
            marca
            rotulo="EN STOCK"
            valor={formatearCantidad(articulo.stock.toString())}
            pie="unidades disponibles"
          />
        )}
        <div className="flex gap-3 lg:contents">
          <Tile
            rotulo="PRECIO DE VENTA"
            valor={precioEnSuMoneda(articulo.precio.toString(), articulo.moneda)}
            pie={actualizadoHace(articulo.actualizadoEn)}
          />
          {/* Sin el permiso COSTOS, el tile no se renderea — no se pone en
              '—': ese guión afirma que ningún ingreso cargó el costo, que es
              una afirmación distinta y falsa cuando lo que pasa es que a esta
              persona no se le muestra.

              En el teléfono eso deja a "Precio de venta" solo en su fila, y
              está bien: los dos Tile son `flex-1`, así que el que queda ocupa
              el ancho entero — el mismo resultado que ya se ve para un
              SERVICIO, que tampoco lleva "Último costo". */}
          {esProducto && puedeCostos && (
            <Tile
              rotulo="ÚLTIMO COSTO"
              // El costo SIEMPRE en pesos, sea cual sea la moneda del
              // artículo: `MovimientoStock.costoUnitario` no distingue
              // moneda (deuda del costo, CLAUDE.md) — mostrarlo en dólares
              // sería inventar una cotización que no existe.
              valor={ultimoCosto ? formatearPrecio(ultimoCosto.toString()) : '—'}
              pie={
                ultimoCosto
                  ? (textoDeMargen(articulo.precio, ultimoCosto, articulo.moneda) ??
                      // Dos situaciones distintas detrás del mismo `??`: acá
                      // SÍ hay costo y precio, pero el costo está en pesos y
                      // el precio en dólares — no es que "no se pueda
                      // calcular", es que no hay con qué comparar sin
                      // cotización (ver el docblock de textoDeMargen).
                      (articulo.moneda === 'USD'
                        ? 'el costo está en pesos: sin margen para un artículo en dólares'
                        : 'el precio no permite calcular el margen'))
                  : 'ningún ingreso cargó el costo todavía'
              }
            />
          )}
        </div>
      </div>

      {esProducto && !articulo.desactivadoEn && (
        <div className="order-3 lg:order-none">
          <MoverStock
            articuloId={articulo.id}
            puedeCostos={puedeCostos}
            llevaSerie={articulo.llevaSerie}
          />
        </div>
      )}

      {/* El bloque que responde "por qué tengo 3 y no 5", que es la pregunta
          que un dueño hace cuando el inventario no le cierra. Es para lo que la
          tabla es append-only. */}
      <div className="order-5 lg:order-none">
        <HistorialDeMovimientos
          filas={filasHistorial}
          limiteAlcanzado={movimientos.length === MOVIMIENTOS_VISIBLES}
          limiteVisible={MOVIMIENTOS_VISIBLES}
          accion={<BotonExportarCsv articuloId={articulo.id} />}
        />
      </div>
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
      puedeEditar={puedeEditar}
      nombre={articulo.nombre}
      sku={articulo.sku}
      precio={articulo.precio.toString()}
      moneda={articulo.moneda}
      arbol={arbol}
      categoriaId={articulo.categoriaId}
      columnaIzquierda={columnaIzquierda}
      columnaDerechaExtra={columnaDerechaExtra}
    >
      {/* Task 8 del ciclo de unidades por IMEI: el switch, en `children` y no
          en ninguna de las dos columnas — es ancho completo, como el
          `<Alert>` de desactivado que ya vive acá. Sólo para productos
          activos: un servicio no puede llevar serie, y un artículo
          desactivado no se ofrece para operaciones nuevas. */}
      {esProducto && !articulo.desactivadoEn && (
        <SwitchDeSerie
          articuloId={articulo.id}
          llevaSerie={articulo.llevaSerie}
          puedeEditar={puedeEditar}
        />
      )}
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
