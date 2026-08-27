import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  formatearPrecio, formatearDolares, formatearCantidad, formatearHora, formatearFechaCorta,
  formatearFecha,
} from '@/lib/formato/mostrar'
import { ROTULO_MEDIO, CONSUMIDOR_FINAL } from '@/lib/ventas/medios'
import { subtotalItem, montoEnPesos } from '@/lib/ventas/totales'
import { ChipEstado } from '../chip-estado'
import { AnularVenta } from '../formularios'
import { esUuid } from '@/lib/uuid'
import estilos from '../tipografia.module.css'

export const dynamic = 'force-dynamic'

const ROTULO_MONEDA: Record<'ARS' | 'USD', string> = { ARS: 'Pesos', USD: 'Dólares' }

/**
 * Si esta persona puede anular ESTA venta: sólo el dueño, y sólo mientras
 * siga cobrada. Extraída y exportada porque es el único pedazo de la regla
 * que se puede probar sin un request real (mismo criterio que las funciones
 * puras de app/(app)/ventas/page.tsx) — el guard de verdad, el que protege,
 * sigue viviendo en `exigirDuenio()` adentro de la action `anular()`; esto es
 * sólo lo que decide si la pantalla ofrece el botón.
 */
export function puedeAnular(rol: string, anuladaEn: Date | null): boolean {
  return rol === 'DUENO' && anuladaEn === null
}

/**
 * La columna "Cotización" de la tabla de pagos: sólo tiene sentido para un
 * pago en dólares — un pago en pesos no se tomó a ninguna cotización, y
 * mostrar "1" ahí sería inventar un dato que el pago no tiene.
 */
export function cotizacionVisible(p: { moneda: 'ARS' | 'USD'; cotizacion: string }): string {
  return p.moneda === 'USD' ? formatearPrecio(p.cotizacion) : '—'
}

/**
 * El subtítulo de un ítem vendido, bajo su nombre: el SKU si es un producto
 * con stock, o "Servicio" si no lo es — un servicio no tiene SKU de stock,
 * mismo criterio que ya usa el buscador de /vender para el mismo artículo.
 */
export function subtituloDeItem(articulo: { sku: string; tipo: 'PRODUCTO' | 'SERVICIO' }): string {
  return articulo.tipo === 'SERVICIO' ? 'Servicio' : `SKU ${articulo.sku}`
}

/**
 * La línea de "meta" de un ítem vendido en el teléfono: el mismo subtítulo
 * que ya calcula `subtituloDeItem`, más cantidad × precio unitario en una
 * sola línea. En escritorio esos dos números tienen su propia columna cada
 * uno (Cantidad, Precio); en el teléfono no hay lugar para dos columnas más,
 * así que se funden acá (design/arandano.pen, frame `WBV5G`, nodos
 * `A2Q2X3`/`rWnNJ`/`hgu3n`: "SKU 000412 · 1 × $ 12.000,00").
 */
export function metaDeItem(i: { subtitulo: string; cantidad: string; precioUnitario: string }): string {
  return `${i.subtitulo} · ${formatearCantidad(i.cantidad)} × ${formatearPrecio(i.precioUnitario)}`
}

/**
 * La línea de "meta" de un pago en el teléfono: la moneda, y sólo si es
 * dólares, la cotización con la que se tomó — un pago en pesos no se tomó a
 * ninguna, mismo criterio que `cotizacionVisible` (design/arandano.pen, frame
 * `WBV5G`, nodos `QUPwD`/`q8yOvI`: "Pesos" / "Dólares · cotización 1.485,00").
 */
export function metaDePago(p: { moneda: 'ARS' | 'USD'; cotizacion: string }): string {
  return p.moneda === 'USD'
    ? `${ROTULO_MONEDA.USD} · cotización ${formatearPrecio(p.cotizacion)}`
    : ROTULO_MONEDA.ARS
}

/**
 * Las cuatro filas de texto del panel Resumen. La quinta —Estado— no es
 * texto: es el `ChipEstado` compartido con el listado, así que queda afuera
 * de esta función y se renderiza aparte.
 */
export function filasDeResumen(v: {
  creadoEn: Date
  usuario: { nombre: string }
  cliente: { nombre: string } | null
}): { fecha: string; vendio: string; cliente: string; comprobante: string } {
  return {
    fecha: `${formatearFechaCorta(v.creadoEn)} · ${formatearHora(v.creadoEn)}`,
    vendio: v.usuario.nombre,
    cliente: v.cliente?.nombre ?? CONSUMIDOR_FINAL,
    // Fijo y no leído de ningún campo: no existe `model Factura` en el schema
    // (CLAUDE.md, "Decisiones abiertas del modelo de datos" y "Queda para el
    // ciclo de ventas: ... Factura"), y hoy NINGUNA venta tiene comprobante
    // fiscal, así que este texto es exactamente cierto para todas. El día que
    // ARCA se integre, este campo pasa a leer de un `facturaId` o similar —
    // no antes, porque hoy no hay ninguna forma de saber qué forma va a tener.
    comprobante: 'Sin factura ARCA',
  }
}
export type ResumenTexto = ReturnType<typeof filasDeResumen>

/**
 * "Anulada el ... por ...": quién y cuándo, no sólo que está anulada.
 *
 * Extraída y exportada por el mismo motivo que el resto de las funciones de
 * este archivo —que un test la sostenga sin sesión ni request real—, y en
 * este caso además porque un rediseño anterior de esta pantalla llegó a
 * borrar el dato entero (el `select` dejó de pedir `anuladaPor` y el bloque
 * que lo mostraba desapareció) sin que nada lo notara: anular revierte stock
 * y da de baja plata cobrada, y `Venta.anuladaEn`/`anuladaPorId` existen en el
 * schema justamente para responder esa pregunta más tarde.
 *
 * Sin nombre —dueño desactivado, o un dato viejo de antes de este campo— no
 * inventa un "por alguien": dice sólo la fecha, igual que ya hacía la versión
 * original de este texto.
 */
export function notaDeAnulacion(v: { anuladaEn: Date; anuladaPor: { nombre: string } | null }): string {
  return `Anulada el ${formatearFecha(v.anuladaEn)}${v.anuladaPor ? ` por ${v.anuladaPor.nombre}` : ''}.`
}

/** Una fila clave/valor del panel Resumen. Mobile-first: 14px de padding
 *  horizontal en el teléfono (cuerpo `padding [12,14]`), 18px en escritorio
 *  —sin cambios ahí— (design/arandano.pen, frame `WBV5G`, nodos
 *  `eRwl3`/`fMtOE`/`WtVJz`/`f2u3zu`/`jjrWA`, `padding [11,14]`). */
function FilaResumen({ clave, children }: { clave: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-[14px] py-[11px] last:border-b-0 lg:px-[18px]">
      <span className="text-[12px] text-muted-foreground">{clave}</span>
      <span className="text-[13px] font-medium text-foreground">{children}</span>
    </div>
  )
}

/** Un ítem vendido, ya resuelto a texto: lo que `Detalle` recibe de verdad,
 *  sin ningún `Decimal` de Prisma cruzando a un fixture de test (mismo
 *  criterio que `FilaDeVenta` en app/(app)/ventas/page.tsx). `subtitulo` y
 *  `meta` son DOS textos distintos con el mismo origen (`subtituloDeItem`):
 *  el primero es lo único que muestra escritorio bajo el nombre; el segundo
 *  —que además suma cantidad × precio— es lo único que muestra el teléfono,
 *  fundido con el subtotal en la meta de la card. */
export type ItemVendido = {
  id: string
  nombre: string
  subtitulo: string
  meta: string
  cantidadFormateada: string
  precioFormateado: string
  subtotalFormateado: string
}

/** Un pago recibido, ya resuelto a texto. `esUsd` decide si el teléfono suma
 *  la línea "entraron $X" bajo la meta —sólo tiene sentido para un pago en
 *  dólares, mismo motivo que `cotizacionVisible`. */
export type PagoRecibido = {
  id: string
  medioLabel: string
  monedaLabel: string
  cotizacionFormateada: string
  montoFormateado: string
  enPesosFormateado: string
  meta: string
  esUsd: boolean
}

/**
 * El cuerpo entero del detalle de una venta: el panel Resumen, las dos
 * tablas ("Qué se vendió", "Cómo se pagó") y la Zona de riesgo — todo lo que
 * `design/arandano.pen` dibuja en `WBV5G` (Móvil / Venta detalle) y en
 * `App / Venta detalle` (escritorio, nodo `NjMl1`).
 *
 * No abre sesión ni toca Prisma —recibe todo ya resuelto a texto—, así que
 * se renderiza directo en el test con `renderToStaticMarkup` (mismo criterio
 * que `Listado` en app/(app)/ventas/page.tsx).
 *
 * **Las dos tablas siguen el patrón `lg:contents` de la Task 4** (ver el
 * docblock de `Listado`, en app/(app)/ventas/page.tsx:344-408): grid en
 * escritorio con las mismas anchuras que hoy declaraban los `<TableHead>`
 * (`[1fr_100px_130px_140px]` para "Qué se vendió",
 * `[1fr_110px_130px_130px_140px]` para "Cómo se pagó"), tarjetas apiladas en
 * el teléfono. Cada columna que el teléfono no muestra por separado
 * (Cantidad/Precio en la primera, Medio/Moneda/Cotización/Monto/En pesos en
 * la segunda) sigue existiendo como celda `hidden lg:block` — el dato no
 * desaparece, se funde en la línea de "meta" de la card (mismo mecanismo que
 * ya usa "Medios" en `Listado`).
 *
 * **El orden se invierte entre anchos, y por eso las dos columnas de
 * escritorio son `contents lg:flex` en vez de `flex lg:flex`.** El teléfono
 * (`WBV5G`) apila Resumen primero, después "Qué se vendió", "Cómo se pagó" y
 * por último la Zona de riesgo — pero escritorio pone "Qué se vendió"/"Cómo
 * se pagó" a la izquierda y Resumen/Zona de riesgo a la derecha, con "Qué se
 * vendió" ANTES que Resumen en el DOM. Un `order` por card sobre el MISMO
 * árbol no alcanza si las dos columnas siguen siendo cajas reales en las dos
 * anchuras, porque `order` sólo reordena hermanos DENTRO del mismo contenedor
 * flex — así que cada columna se disuelve en el teléfono (`contents`, mismo
 * truco que ya usa `app/(app)/vender/caja.tsx` para su variante píldora): sus
 * dos cards pasan a ser hijos directos del `flex-col` externo, cada una con
 * su propio `order-N` (1: Resumen, 2: Qué se vendió, 3: Cómo se pagó, 4: Zona
 * de riesgo). En escritorio (`lg:flex`) cada columna vuelve a ser una caja
 * real y `lg:order-none` restaura el orden natural del DOM adentro de ella
 * (Qué se vendió antes que Cómo se pagó; Resumen antes que Zona de riesgo) —
 * el `order` del teléfono no tiene ningún efecto ahí porque cada columna sólo
 * tiene 2 hijos entre los que reordenar, y los dos ya están en su lugar.
 *
 * **La banda TOTAL pinta con `--marca`, sólo en el teléfono.** El nodo `Cv4xd`
 * de `WBV5G` declara `fill: $ar-primary-deep` (`--marca`, ver
 * `design/LEEME.md`) en vez del `bg-muted` de hoy — la maqueta la trata como
 * el ancla de esta pantalla ("el importe que se dice en voz alta", mismo
 * criterio que ya documenta `docs/sistema-de-diseno.md` para la banda
 * homóloga de `/vender`). Escritorio no cambia: `lg:bg-muted` restaura
 * exactamente el fondo y los colores de hoy.
 */
export function Detalle({
  resumen, anulada, notaDeAnulacionTexto, items, totalFormateado, pagos, puedeAnularVenta, ventaId,
}: {
  resumen: ResumenTexto
  anulada: boolean
  notaDeAnulacionTexto: string | null
  items: ItemVendido[]
  totalFormateado: string
  pagos: PagoRecibido[]
  puedeAnularVenta: boolean
  ventaId: string
}) {
  return (
    <div className="flex flex-col gap-3 px-[14px] py-3 lg:gap-4 lg:p-6">
      {/* Sólo en escritorio: en el teléfono la flecha del Topbar (`atras`
          del Encabezado) ya vuelve a /ventas, y dos flechas de volver en la
          misma pantalla es un error. */}
      <Link
        href="/ventas"
        className="hidden w-fit items-center gap-[6px] text-[12px] font-semibold text-muted-foreground lg:flex"
      >
        <ArrowLeft aria-hidden="true" className="size-[14px]" />
        Ventas
      </Link>

      {/* Fila: las dos columnas — qué se vendió/cómo se pagó a la
          izquierda, resumen y anulación a la derecha (design/arandano.pen,
          nodo `NjMl1`). En el teléfono (`WBV5G`) no hay columnas: una sola
          pila, con Resumen primero — ver el docblock de `Detalle`, arriba,
          para el mecanismo `contents lg:flex` + `order-N`. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
        <div className="contents lg:flex lg:flex-1 lg:flex-col lg:gap-4">
          <div className="order-2 flex flex-col overflow-hidden rounded-2xl border bg-card lg:order-none">
            <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
              <h2 className={`${estilos.tituloDeCard} text-foreground`}>Qué se vendió</h2>
            </div>
            <div role="table" className="grid grid-cols-1 lg:grid-cols-[1fr_100px_130px_140px]">
              <div role="row" className="hidden lg:contents">
                <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Artículo
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Cantidad
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Precio
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Subtotal
                </div>
              </div>

              {/* Los datos CONGELADOS: lo que se cobró ese día, no lo que el
                  artículo vale hoy — VentaItem guarda copia, y todo acá ya
                  llegó formateado desde `DetalleDeVenta` (`subtotalItem()` de
                  lib/ventas/totales.ts, la MISMA función con la que
                  `crearVenta` arma el total). */}
              {items.map((i) => (
                <div
                  key={i.id}
                  role="row"
                  className="group flex flex-col gap-[5px] border-b p-[11px] px-[14px] lg:contents"
                >
                  {/* Nombre + subtítulo (SKU/Servicio): la celda "Artículo"
                      de escritorio, sin cambios — es la más alta de la fila
                      (dos líneas), así que no lleva envoltorio de centrado
                      (mismo criterio que "Cliente" en `Listado`). En el
                      teléfono el subtítulo se oculta: ya va fundido, junto
                      con cantidad y precio, en la meta de más abajo. */}
                  <div role="cell" className="lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                    <div className="flex flex-col gap-0.5 whitespace-normal">
                      <span className="text-[14px] font-medium text-foreground lg:text-sm">{i.nombre}</span>
                      <span className="hidden text-[11px] text-muted-foreground lg:block">{i.subtitulo}</span>
                    </div>
                  </div>

                  {/* Meta del teléfono: subtítulo + cantidad × precio a la
                      izquierda, subtotal a la derecha — oculta en
                      escritorio, donde esos tres números ya tienen su propia
                      celda. */}
                  <div className="flex items-center justify-between gap-[10px] lg:hidden">
                    <span className="text-[11px] text-muted-foreground">{i.meta}</span>
                    <span className={`${estilos.archivo} text-[15px] font-semibold text-foreground tabular-nums`}>
                      {i.subtotalFormateado}
                    </span>
                  </div>

                  {/* Cantidad — su propia celda, sólo escritorio.

                      Las celdas de escritorio de las DOS tablas de esta
                      pantalla llevan `text-sm` propio, sin prefijo. Antes de
                      esta rama lo heredaban del `<Table>` de shadcn
                      (components/ui/table.tsx), que se fue con el grid; acá
                      ningún ancestro lo repone —`.archivo` sólo declara la
                      familia, y el contenedor es un `<div>` con borde, no un
                      `<Card>` de shadcn, que sí lo trae (por eso el carrito
                      de /vender no lo necesitó)—, así que sin esto caerían a
                      los 16 px del navegador. Los 14 px valen en los dos
                      anchos: son los de escritorio de antes de la rama, y en
                      el teléfono estas celdas están ocultas. */}
                  <div role="cell" className={`${estilos.archivo} hidden text-right text-sm text-foreground tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{i.cantidadFormateada}</div>
                  </div>

                  {/* Precio — su propia celda, sólo escritorio. */}
                  <div role="cell" className={`${estilos.archivo} hidden text-right text-sm text-foreground-soft tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{i.precioFormateado}</div>
                  </div>

                  {/* Subtotal — su propia celda, sólo escritorio (el
                      teléfono ya lo mostró arriba, en la meta). */}
                  <div role="cell" className={`${estilos.archivo} hidden text-right text-sm font-semibold text-foreground tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{i.subtotalFormateado}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* La banda TOTAL, a ancho completo: `--marca` en el teléfono
                (design/arandano.pen, nodo `Cv4xd`), `bg-muted` de siempre en
                escritorio — ver el docblock de `Detalle`, arriba. */}
            <div className="flex items-center justify-between bg-[var(--marca)] px-[14px] py-[13px] lg:bg-muted lg:px-[18px] lg:py-[14px]">
              <span className="text-[10px] font-bold tracking-[1px] text-[var(--marca-soft)] uppercase lg:tracking-[1.2px] lg:text-muted-foreground">
                Total
              </span>
              <span className={`${estilos.archivo} text-[22px] font-semibold text-[var(--marca-foreground)] tabular-nums lg:text-foreground`}>
                {totalFormateado}
              </span>
            </div>
          </div>

          <div className="order-3 flex flex-col overflow-hidden rounded-2xl border bg-card lg:order-none">
            <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
              <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cómo se pagó</h2>
            </div>
            <div role="table" className="grid grid-cols-1 lg:grid-cols-[1fr_110px_130px_130px_140px]">
              <div role="row" className="hidden lg:contents">
                <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Medio
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Moneda
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Cotización
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Monto
                </div>
                <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  En pesos
                </div>
              </div>

              {pagos.map((p) => (
                <div
                  key={p.id}
                  role="row"
                  className="group flex flex-col gap-1 border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
                >
                  {/* Fila superior del teléfono: medio + monto — oculta en
                      escritorio, donde cada uno ya tiene su propia celda. */}
                  <div className="flex items-center justify-between gap-[10px] lg:hidden">
                    <span className="text-[14px] font-medium text-foreground">{p.medioLabel}</span>
                    <span className={`${estilos.archivo} text-[15px] font-semibold text-foreground tabular-nums`}>
                      {p.montoFormateado}
                    </span>
                  </div>

                  {/* Medio — su propia celda, sólo escritorio. Todas las
                      celdas de esta tabla son de una sola línea —a
                      diferencia de "Artículo" en la de arriba—, así que
                      TODAS necesitan el envoltorio de centrado (ninguna es
                      "la más alta" de por sí). */}
                  <div role="cell" className="hidden text-sm text-foreground lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                    <div className="lg:flex lg:h-full lg:items-center">{p.medioLabel}</div>
                  </div>

                  {/* Moneda — su propia celda, sólo escritorio (el teléfono
                      la funde en la meta). */}
                  <div role="cell" className="hidden text-sm text-foreground lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors">
                    <div className="lg:flex lg:h-full lg:items-center">{p.monedaLabel}</div>
                  </div>

                  {/* Cotización — su propia celda, sólo escritorio. */}
                  <div role="cell" className={`${estilos.archivo} hidden text-right text-sm text-foreground-soft tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{p.cotizacionFormateada}</div>
                  </div>

                  {/* Monto — su propia celda, sólo escritorio (el teléfono
                      ya lo mostró arriba). Cada moneda con su formateador ya
                      resuelto en `montoFormateado` — `formatearPrecio` ya
                      emite el `$` de pesos, así que anteponerle "US$ " a mano
                      daba "US$ $ 0,80". */}
                  <div role="cell" className={`${estilos.archivo} hidden text-right text-sm text-foreground tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{p.montoFormateado}</div>
                  </div>

                  {/* En pesos — su propia celda, sólo escritorio (el
                      teléfono la muestra abajo, sólo si es un pago en
                      dólares). `montoEnPesos()` de lib/ventas/totales.ts, la
                      MISMA función con la que `componerPorMedio` arma "Cómo
                      entró la plata" en /ventas. */}
                  <div role="cell" className={`${estilos.archivo} hidden text-right text-sm font-semibold text-foreground tabular-nums lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors`}>
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">{p.enPesosFormateado}</div>
                  </div>

                  {/* Meta del teléfono: moneda (+ cotización si es dólares)
                      y, sólo para un pago en dólares, "entraron $X" — un
                      pago en pesos no tiene nada más que decir ahí, mismo
                      motivo que ya explica `cotizacionVisible`. */}
                  <div className="flex items-center justify-between gap-[10px] lg:hidden">
                    <span className="text-[11px] text-muted-foreground">{p.meta}</span>
                    {p.esUsd && (
                      <span className="text-[11px] font-semibold text-foreground-soft">
                        entraron {p.enPesosFormateado}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="contents lg:flex lg:w-[324px] lg:shrink-0 lg:flex-col lg:gap-4">
          <div className="order-1 flex flex-col overflow-hidden rounded-2xl border bg-card lg:order-none">
            <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
              <h2 className={`${estilos.tituloDeCard} text-foreground`}>Resumen</h2>
            </div>
            <div className="flex flex-col">
              <FilaResumen clave="Fecha">{resumen.fecha}</FilaResumen>
              <FilaResumen clave="Vendió">{resumen.vendio}</FilaResumen>
              <FilaResumen clave="Cliente">{resumen.cliente}</FilaResumen>
              <FilaResumen clave="Estado">
                <ChipEstado anulada={anulada} />
              </FilaResumen>
              <FilaResumen clave="Comprobante">{resumen.comprobante}</FilaResumen>
            </div>
          </div>

          {/* Zona de riesgo (design/arandano.pen, nodo `TIlD3`): la maqueta
              sólo dibuja el texto de advertencia, sin ningún botón — no
              existe ningún frame de venta anulada contra el que confirmar si
              el botón va en otro lado, así que se lo deja exactamente donde
              el texto lo ubica (ver relevamiento.md, punto 6). El texto
              queda visible para cualquier rol —explica por qué un empleado
              no tiene el botón—, y el botón mismo sigue restringido al
              dueño.

              Una vez anulada no hay nada que ADVERTIR —la acción ya no se
              puede tomar—, pero sí algo que INFORMAR: quién y cuándo. La
              maqueta no dice nada sobre este estado (no dibuja ningún frame
              de venta anulada, ni de escritorio ni del teléfono), y "no dice
              nada" no es "sacalo": el dato vive en
              `Venta.anuladaEn`/`anuladaPorId` desde el schema original, y una
              venta anulada revierte stock y da de baja plata cobrada —
              perder de vista quién lo hizo y cuándo es perder el único
              rastro de una operación que mueve caja e inventario. Ocupa el
              mismo lugar que la advertencia, así que la columna nunca queda
              con las dos cosas a la vez. */}
          {notaDeAnulacionTexto ? (
            <Alert className="order-4 rounded-2xl bg-destructive-soft px-[14px] py-[14px] lg:order-none lg:px-4 lg:py-4">
              <AlertDescription className="text-[11px] leading-[1.45] text-destructive opacity-85">
                {notaDeAnulacionTexto}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="order-4 flex flex-col gap-[9px] rounded-2xl bg-destructive-soft p-[14px] lg:order-none lg:p-4">
              <div className="flex items-center gap-[7px]">
                <TriangleAlert aria-hidden="true" className="size-[14px] text-destructive" />
                <span className="text-[13px] font-bold text-destructive">Anular la venta</span>
              </div>
              <p className="text-[11px] leading-[1.45] text-destructive opacity-85">
                El stock vuelve al inventario con movimientos compensatorios. Los
                movimientos originales no se borran. Sólo el dueño puede hacerlo.
              </p>
              {puedeAnularVenta && <AnularVenta ventaId={ventaId} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default async function DetalleDeVenta({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // Mismo guard que el detalle de artículo y por el mismo motivo: `/ventas/foo`
  // es algo que alguien escribe en la barra de direcciones, y sin esto Prisma
  // rechaza el valor con P2007 y la pantalla se cae con un 500.
  if (!esUuid(id)) notFound()

  const venta = await prismaParaTenant(sesion.tenant.id).venta.findUnique({
    where: { id },
    select: {
      id: true, numero: true, total: true, creadoEn: true, anuladaEn: true,
      usuario: { select: { nombre: true } },
      // Quién anuló, no sólo que esté anulada: `Venta.anuladaPorId` existe en
      // el schema para responder esa pregunta (CLAUDE.md, el modelo `Pago`
      // vecino explica el mismo criterio para lo que SÍ guarda cada fila), y
      // test/ventas.test.ts la asevera en la base — sin este campo en el
      // select no hay ninguna pantalla que la muestre.
      anuladaPor: { select: { nombre: true } },
      cliente: { select: { nombre: true } },
      items: {
        select: {
          id: true, descripcion: true, cantidad: true, precioUnitario: true,
          articulo: { select: { sku: true, tipo: true } },
        },
      },
      pagos: { select: { id: true, medio: true, moneda: true, monto: true, cotizacion: true } },
    },
  })
  // RLS ya filtró por tenant: "no existe" y "es de otro negocio" son el mismo
  // 404, y tienen que serlo — distinguirlos filtraría qué ids existen.
  if (!venta) notFound()

  const resumen = filasDeResumen(venta)
  const anulada = venta.anuladaEn !== null

  const items: ItemVendido[] = venta.items.map((i) => {
    const subtitulo = subtituloDeItem(i.articulo)
    const cantidad = i.cantidad.toString()
    const precioUnitario = i.precioUnitario.toString()
    return {
      id: i.id,
      nombre: i.descripcion,
      subtitulo,
      meta: metaDeItem({ subtitulo, cantidad, precioUnitario }),
      cantidadFormateada: formatearCantidad(cantidad),
      precioFormateado: formatearPrecio(precioUnitario),
      subtotalFormateado: formatearPrecio(subtotalItem(i.cantidad, i.precioUnitario).toString()),
    }
  })

  const pagos: PagoRecibido[] = venta.pagos.map((p) => {
    const cotizacion = p.cotizacion.toString()
    return {
      id: p.id,
      medioLabel: ROTULO_MEDIO[p.medio],
      monedaLabel: ROTULO_MONEDA[p.moneda],
      cotizacionFormateada: cotizacionVisible({ moneda: p.moneda, cotizacion }),
      montoFormateado: p.moneda === 'USD' ? formatearDolares(p.monto.toString()) : formatearPrecio(p.monto.toString()),
      enPesosFormateado: formatearPrecio(montoEnPesos(p.monto, p.cotizacion).toString()),
      meta: metaDePago({ moneda: p.moneda, cotizacion }),
      esUsd: p.moneda === 'USD',
    }
  })

  return (
    <>
      <Encabezado titulo={`Venta #${venta.numero}`} atras="/ventas" />
      <Detalle
        resumen={resumen}
        anulada={anulada}
        notaDeAnulacionTexto={venta.anuladaEn ? notaDeAnulacion({ anuladaEn: venta.anuladaEn, anuladaPor: venta.anuladaPor }) : null}
        items={items}
        totalFormateado={formatearPrecio(venta.total.toString())}
        pagos={pagos}
        puedeAnularVenta={puedeAnular(sesion.usuario.rol, venta.anuladaEn)}
        ventaId={venta.id}
      />
    </>
  )
}
