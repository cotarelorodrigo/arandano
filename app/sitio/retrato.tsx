import { formatearPrecio, formatearCantidad, montoSinSigno } from '@/lib/formato/mostrar'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Minus, Plus, TriangleAlert, X } from 'lucide-react'
import estilos from '@/components/importe.module.css'
import tipografia from './tipografia.module.css'

/**
 * El producto, mostrado en vez de contado.
 *
 * NO es una captura de pantalla y no debería serlo nunca: un PNG se ve borroso
 * en pantalla densa, pesa, y —lo peor— se pudre en silencio cuando la pantalla
 * cambia. Esto reusa los componentes de shadcn (`Card`, `Table`, `Badge`) y el
 * MISMO formateo de plata que el punto de venta (`lib/formato/mostrar.ts`), así
 * que un cambio de formato llega hasta acá solo.
 *
 * Lo que NO reusa es `app/(app)/vender/punto-de-venta.tsx` en sí: ese archivo
 * lleva 'use client', y un export de un módulo cliente le llega a un componente
 * de SERVIDOR como un proxy que no se puede invocar directo —el mismo motivo
 * que documenta el comentario de encabezado de `lib/formato/mostrar.ts`, que
 * existe justamente para poder compartirse desde acá sin ese problema—. Por
 * eso el marcado del carrito se reconstruye acá con los mismos componentes y
 * clases visuales que ese archivo, pero SIN estado ni handlers: cada línea es
 * un dato fijo, no una prop.
 *
 * Tampoco es la pantalla: no hay botones ni campos de verdad —el stepper y el
 * ícono de "quitar" son sólo su dibujo, sin `<button>` ni `<input>` reales—.
 * Es un retrato, con datos fijos, y `app/sitio/retrato.test.tsx` lo afirma para
 * que nadie lo convierta de a poco en una demo a medias.
 *
 * Los cuatro ítems, el aviso de stock y el resumen del total copian
 * exactamente el frame `Sitio / Landing` → Hero → Muestra → `Carrito real`
 * de design/arandano.pen (nodo `qjo7l`), consultado en vivo para esta task.
 * La maqueta ya no dibuja el cartel con el nombre del local adentro de esta
 * card —el "Carrito real" arranca directo en el encabezado hundido—: ese dato
 * se mudó a la barra de navegador que envuelve a este componente (nodo
 * `gnbEL`, con la URL "flor.arandano.app/vender"), que arma
 * `app/sitio/secciones.tsx` alrededor de este retrato. Por eso ya no importa
 * `cartel.module.css`.
 */

type Item = {
  descripcion: string
  // null: es un servicio, no lleva SKU de stock — mismo criterio que la fila
  // real de `/vender` (que muestra "Servicio" en su lugar).
  sku: string | null
  cantidad: string
  precio: string
  subtotal: string
  sinStockSuficiente?: boolean
}

const ITEMS: Item[] = [
  { descripcion: 'Vidrio templado 9H · iPhone 13', sku: '000412', cantidad: '1', precio: '12000', subtotal: '12000' },
  { descripcion: 'Cargador 20W USB-C Baseus', sku: '000198', cantidad: '2', precio: '18500', subtotal: '37000' },
  {
    descripcion: 'Funda silicona iPhone 13 · Negra',
    sku: '000233',
    cantidad: '1',
    precio: '9900',
    subtotal: '9900',
    sinStockSuficiente: true,
  },
  { descripcion: 'Cambio de módulo · Mano de obra', sku: null, cantidad: '1', precio: '45000', subtotal: '45000' },
]

// 12.000 + 37.000 + 9.900 + 45.000 = 103.900, el mismo total que el .pen.
const TOTAL = '103900'

// El resumen de la banda ("N artículos · N unidades") se deriva de ITEMS en
// vez de escribirse aparte a mano: así un cambio en la lista de arriba no
// puede desincronizar la cuenta de abajo.
const ARTICULOS = ITEMS.length
const UNIDADES = ITEMS.reduce((acumulado, item) => acumulado + Number(item.cantidad), 0)

export function Retrato() {
  return (
    <Card
      className="w-full gap-0 rounded-[16px] border py-0 ring-0"
      role="img"
      aria-label="Una venta en el punto de venta de Arándano: cuatro artículos, uno con aviso de stock insuficiente, total de ciento tres mil novecientos pesos."
    >
      <div aria-hidden="true">
        {/* `min-w`: las cuatro columnas de la derecha miden en PÍXELES (son
            las mismas de /vender), así que lo único elástico es la del
            nombre — y cuando el contenedor se angosta, se lleva todo el
            recorte ella sola. A 1440px de viewport la Muestra mide los 720
            del `.pen` y sobran 306 para el nombre; abajo de ~1100 quedaban
            33, y "Vidrio templado 9H · iPhone 13" se leía una palabra por
            renglón. El piso de 520 le deja siempre ~148 —dos renglones
            legibles— y por debajo de eso el envoltorio de `Table` scrollea,
            que es exactamente lo que hace la tabla de verdad en /vender.
            Una tabla cortada se lee como una ventana angosta; una tabla con
            la columna colapsada se lee como un producto roto. */}
        <Table className="table-fixed lg:min-w-[520px]">
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead className="h-auto px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Artículo
              </TableHead>
              <TableHead className="h-auto w-[104px] px-[7px] py-3 text-center text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Cantidad
              </TableHead>
              <TableHead className="h-auto w-[110px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Precio
              </TableHead>
              <TableHead className="h-auto w-[130px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Subtotal
              </TableHead>
              {/* La columna de "Quitar" queda vacía en el encabezado, igual que en /vender. */}
              <TableHead className="h-auto w-7 px-[7px] py-3 pr-[18px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ITEMS.map((item) => (
              <TableRow key={item.descripcion}>
                <TableCell className="p-[11px] px-[7px] pl-[18px] whitespace-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{item.descripcion}</span>
                    {/* `flex-wrap`: el chip de stock no entra al lado del SKU cuando
                        la columna se angosta, y sin esto se desbordaba sobre el stepper. */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* El SKU bajo el nombre, o "Servicio" si no tiene —
                          mismo texto que ya usa la lista de resultados y las
                          filas del carrito real. */}
                      <span className="text-[11px] text-muted-foreground">
                        {item.sku ? `SKU ${item.sku}` : 'Servicio'}
                      </span>
                      {item.sinStockSuficiente && (
                        <Badge
                          variant="outline"
                          className="h-auto gap-[5px] border-transparent bg-warn-soft px-[7px] py-[2px] text-[10px] font-semibold text-warn"
                        >
                          <TriangleAlert aria-hidden="true" />
                          sin stock suficiente
                        </Badge>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="p-[11px] px-[7px]">
                  {/* El stepper [-] [valor] [+], dibujado y no interactivo: son
                      spans e íconos, no <button>/<input> — este archivo NO es
                      la pantalla, es su retrato (ver el comentario de arriba). */}
                  <div className="flex h-9 w-[104px] items-center rounded-[9px] border border-input">
                    <span className="flex h-full w-8 items-center justify-center text-foreground-soft">
                      <Minus aria-hidden="true" className="size-[13px]" />
                    </span>
                    <span
                      className={`flex h-full flex-1 items-center justify-center text-center font-semibold text-foreground ${estilos.importe}`}
                    >
                      {formatearCantidad(item.cantidad)}
                    </span>
                    <span className="flex h-full w-8 items-center justify-center text-foreground-soft">
                      <Plus aria-hidden="true" className="size-[13px]" />
                    </span>
                  </div>
                </TableCell>
                <TableCell className={`p-[11px] px-[7px] text-right text-foreground-soft ${estilos.importe}`}>
                  {formatearPrecio(item.precio)}
                </TableCell>
                <TableCell
                  className={`p-[11px] px-[7px] pr-[18px] text-right text-[15px] font-semibold text-foreground ${estilos.importe}`}
                >
                  {formatearPrecio(item.subtotal)}
                </TableCell>
                <TableCell className="p-[11px] pr-[18px] pl-[7px] text-right">
                  <span className="ml-auto flex size-7 items-center justify-center text-muted-foreground">
                    <X aria-hidden="true" className="size-[15px]" />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* La banda del total: mismo patrón que la de /vender —color de
            marca sólido vía var(), signo "$" como elemento propio separado
            del monto, cada uno con su propio rol tipográfico de Archivo. */}
        <div className="flex items-center justify-between px-[22px] py-5" style={{ backgroundColor: 'var(--marca)' }}>
          <div className="flex flex-col gap-0.5">
            <span
              className="text-[10px] font-bold tracking-[1.4px] uppercase"
              style={{ color: 'var(--marca-soft)' }}
            >
              Total
            </span>
            <span className="text-xs" style={{ color: 'var(--marca-dim)' }}>
              {ARTICULOS} artículos · {UNIDADES} unidades
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={estilos.signo} style={{ color: 'var(--marca-soft)' }}>
              $
            </span>
            <span className={estilos.total} style={{ color: 'var(--marca-foreground)' }}>
              {montoSinSigno(formatearPrecio(TOTAL))}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

/**
 * El mismo carrito, redibujado como cards para el teléfono — Task 11 del
 * ciclo móvil (design/arandano.pen, frame `Móvil / Sitio · Landing`, nodo
 * `TVNp5`, "Carrito real" dentro de la sección `Muestra` de
 * `app/sitio/secciones.tsx`).
 *
 * NO es `Retrato` con clases responsive: la maqueta del teléfono no colapsa
 * la tabla, la REEMPLAZA por una lista de ítems (nombre + quitar, meta con
 * SKU/precio y el aviso de stock, y una fila de stepper + subtotal), sin
 * encabezado de columnas. Mismo dato (`ITEMS`/`TOTAL`/`ARTICULOS`/
 * `UNIDADES`) que `Retrato`, para que las dos versiones nunca puedan
 * desincronizarse — es la misma razón por la que `Retrato` lee
 * `formatearPrecio`/`formatearCantidad` en vez de escribir los números a
 * mano.
 *
 * Vive en un componente aparte (no adentro de `Retrato`) porque cada uno se
 * usa desde un lugar de la página distinto según el ancho —`Retrato` adentro
 * del Hero, oculto abajo de 1024; éste en la sección `Muestra`, oculta desde
 * 1024— y esa es la sección que decide cuál mostrar, no este archivo.
 */
export function RetratoMovil() {
  return (
    <Card
      className="w-full gap-0 overflow-hidden rounded-[16px] border py-0 ring-0"
      role="img"
      aria-label="Una venta en el punto de venta de Arándano: cuatro artículos, uno con aviso de stock insuficiente, total de ciento tres mil novecientos pesos."
    >
      <div aria-hidden="true">
        <div className="flex items-center justify-between border-b px-[14px] py-[11px]">
          <span className={`${tipografia.archivo} text-sm font-semibold text-foreground`}>
            Carrito
          </span>
          <span className="text-xs font-semibold text-muted-foreground">Vaciar</span>
        </div>

        {ITEMS.map((item) => (
          <div key={item.descripcion} className="flex flex-col gap-2 border-b p-[11px] px-[14px]">
            <div className="flex items-center gap-[10px]">
              <span className="flex-1 text-sm font-medium text-foreground">{item.descripcion}</span>
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[8px] text-muted-foreground">
                <X aria-hidden="true" className="size-[15px]" />
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {item.sku ? `SKU ${item.sku}` : 'Servicio'} · {formatearPrecio(item.precio)} c/u
              </span>
              {item.sinStockSuficiente && (
                <Badge
                  variant="outline"
                  className="h-auto gap-[5px] border-transparent bg-warn-soft px-[7px] py-[2px] text-[10px] font-semibold text-warn"
                >
                  <TriangleAlert aria-hidden="true" />
                  sin stock
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-[10px]">
              <div className="flex h-[34px] w-[106px] items-center rounded-[9px] bg-muted">
                <span className="flex h-full w-8 items-center justify-center text-foreground-soft">
                  <Minus aria-hidden="true" className="size-[13px]" />
                </span>
                <span
                  className={`flex h-full flex-1 items-center justify-center text-center font-semibold text-foreground ${estilos.importe}`}
                >
                  {formatearCantidad(item.cantidad)}
                </span>
                <span className="flex h-full w-8 items-center justify-center text-foreground-soft">
                  <Plus aria-hidden="true" className="size-[13px]" />
                </span>
              </div>
              <span
                className={`ml-auto text-[15px] font-semibold text-foreground ${estilos.importe}`}
              >
                {formatearPrecio(item.subtotal)}
              </span>
            </div>
          </div>
        ))}

        {/* La banda del total: mismo patrón que en Retrato, con el padding
            propio del teléfono (nodo ZevtA: [14,16] contra [20,22] en
            escritorio). */}
        <div className="flex items-center justify-between px-4 py-[14px]" style={{ backgroundColor: 'var(--marca)' }}>
          <div className="flex flex-col gap-0.5">
            <span
              className="text-[10px] font-bold tracking-[1.4px] uppercase"
              style={{ color: 'var(--marca-soft)' }}
            >
              Total
            </span>
            <span className="text-xs" style={{ color: 'var(--marca-dim)' }}>
              {ARTICULOS} artículos · {UNIDADES} unidades
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={estilos.signo} style={{ color: 'var(--marca-soft)' }}>
              $
            </span>
            <span className={estilos.total} style={{ color: 'var(--marca-foreground)' }}>
              {montoSinSigno(formatearPrecio(TOTAL))}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

export { TOTAL, ARTICULOS, UNIDADES, ITEMS }
