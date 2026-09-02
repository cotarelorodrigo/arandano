'use client'

import type { ReactNode } from 'react'
import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Package, Wrench, Info, Check, Ban, RotateCcw } from 'lucide-react'
import {
  altaArticulo,
  guardarArticulo,
  bajaArticulo,
  reactivarArticuloAccion,
  ingresarMercaderia,
  corregirPorConteo,
  exportarHistorialCsv,
  type EstadoInventario,
} from './acciones'
import { Encabezado } from '@/components/shell/encabezado'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import type { RamaConHijas } from '@/lib/inventario/categorias'
import { SelectorDeCategoria } from './selector-categoria'
import { SelectorDeMoneda } from '@/components/selector-de-moneda'
import { ListaDeImeis } from './lista-de-imeis'
import estilos from './tipografia.module.css'

// Acá y no en acciones.ts: aquel archivo es 'use server' y sólo puede exportar
// funciones async. Mismo lugar que en usuarios y en login.
const INICIAL: EstadoInventario = { error: null, aviso: null }

function Resultado({ estado }: { estado: EstadoInventario }) {
  if (estado.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{estado.error}</AlertDescription>
      </Alert>
    )
  }
  if (estado.aviso) {
    return (
      <Alert>
        <AlertDescription>{estado.aviso}</AlertDescription>
      </Alert>
    )
  }
  return null
}

/**
 * Una card del formulario de alta: encabezado con el título en Archivo +
 * contenido, mismo patrón que las cards de `/ventas` (design/arandano.pen,
 * nodos `vRxEk`/`zNQkx`/`mDj1p`) — no el `Card` de shadcn que usa el resto
 * de este archivo, porque acá el encabezado necesita su propio borde
 * inferior y la cara de display, y son tres cards idénticas en estructura.
 */
function CardDelFormulario({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      {/* Mobile-first (Task 7 del ciclo móvil, design/arandano.pen: los
          Encabezado de card de `m34Naf`/`T5gME` miden padding [12,14], contra
          los [13,18] de escritorio, sin cambios) — mismo patrón que ya usan
          las cards de `/ventas` (app/(app)/ventas/[id]/page.tsx, "Qué se
          vendió"). */}
      <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>{titulo}</h2>
      </div>
      <div className="flex flex-col gap-3 p-[14px] lg:gap-[14px] lg:p-[18px]">{children}</div>
    </div>
  )
}

/** Clases compartidas por las dos tarjetas seleccionables Producto/Servicio.
 *  `has-[:checked]` y `group-has-[:checked]` hacen que el estado visual
 *  ("seleccionada" o no) sea CSS puro sobre el radio real: funciona sin
 *  JavaScript, a diferencia de la visibilidad del bloque de Stock inicial
 *  más abajo, que si necesita `onChange` porque decide si otra card entera
 *  se monta o no. */
// p-3 lg:p-[14px]: el nodo "Producto"/"Servicio" de `m34Naf` mide padding 12,
// contra los 14 de escritorio (design/arandano.pen) — Task 7 del ciclo móvil.
const TARJETA_TIPO =
  'group flex flex-1 cursor-pointer items-start gap-[11px] rounded-xl border border-input bg-card p-3 lg:p-[14px] has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring'
const TITULO_TARJETA_TIPO =
  'text-sm font-semibold text-foreground group-has-[:checked]:text-primary'
const DETALLE_TARJETA_TIPO = 'text-[11px] text-muted-foreground group-has-[:checked]:text-primary'
// size-5 (20px) en el teléfono, size-[19px] en escritorio — mismo mecanismo
// que el resto de este archivo, aunque acá la diferencia sea de 1px.
const ICONO_TARJETA_TIPO = 'size-5 text-muted-foreground group-has-[:checked]:text-primary lg:size-[19px]'

// El pie del teléfono, compartido por FormularioDeAlta y FichaDeArticulo
// (design/arandano.pen, nodo "Pie" de `m34Naf`/`T5gME`): 50px de alto y radio
// 12 para el botón — Task 7 del ciclo móvil.
const CLASES_BOTON_PIE = 'h-[50px] rounded-[12px]'

/**
 * Alta de artículo, en tres cards (design/arandano.pen, frame `B4O7t`): qué
 * se está cargando, los datos y el stock inicial.
 *
 * Los campos de stock se ocultan al elegir "servicio" — un servicio no lleva
 * stock. **Sin JavaScript se ven igual**, y por eso `altaArticulo` los ignora
 * cuando el tipo es SERVICIO en vez de rechazar el alta: la pantalla mejora
 * con JS, no depende de él.
 *
 * **"Cancelar" y "Guardar artículo" viven en el Topbar**, no al pie del
 * formulario (design/arandano.pen, frame `B4O7t`, nodos "Botón · Cancelar" /
 * "Botón · Guardar artículo") — por eso este componente arma también el
 * `<Encabezado>`, algo que antes resolvía `nuevo/page.tsx`. El `<form>`
 * envuelve encabezado y cuerpo por igual, con `className="contents"` para no
 * sumarle un bloque al layout de flex de `SidebarInset`: un
 * `<button type="submit">` necesita ser descendiente del `<form>` que
 * dispara, y acá el botón vive arriba.
 */
export function FormularioDeAlta({
  proximoSku,
  arbol,
  puedeCostos,
}: {
  proximoSku: string
  arbol: RamaConHijas[]
  puedeCostos: boolean
}) {
  const [estado, accion, pendiente] = useActionState(altaArticulo, INICIAL)
  const [tipo, setTipo] = useState<'PRODUCTO' | 'SERVICIO'>('PRODUCTO')
  // Apagado por default: la mayoría de los artículos no llevan IMEI. Un
  // SERVICIO no puede llevar serie — el switch se deshabilita al elegirlo, y
  // el servidor lo rechaza igual (crearArticulo), porque una pantalla que
  // esconde un control no es la guarda, sólo el servidor lo es.
  const [llevaSerie, setLlevaSerie] = useState(false)

  return (
    <form action={accion} className="contents">
      <Encabezado
        titulo="Artículo nuevo"
        subtitulo="Se agrega al catálogo del local"
        atras="/inventario"
        acciones={
          <>
            <Button asChild variant="ghost">
              <Link href="/inventario">Cancelar</Link>
            </Button>
            <Button type="submit" disabled={pendiente}>
              <Check aria-hidden="true" className="size-[15px]" />
              {pendiente ? 'Creando…' : 'Guardar artículo'}
            </Button>
          </>
        }
      />
      {/* Dos columnas, como el frame `B4O7t` de design/arandano.pen: a la
          izquierda "Qué es" y "Datos del artículo", a la derecha el stock
          inicial en 420 fijos. Antes era una sola columna de 760 centrada.
          Mobile-first (Task 7 del ciclo móvil, frame `m34Naf`): en el
          teléfono las dos columnas se apilan — el DOM ya trae "Stock inicial"
          DESPUÉS de las otras dos cards, que es exactamente el orden que pide
          la maqueta, así que alcanza con `flex-col lg:flex-row`, sin el
          mecanismo `contents`+`order-N` que sí hace falta en FichaDeArticulo
          (ver su docblock). */}
      <div className="flex flex-col gap-3 p-[14px] lg:flex-row lg:items-start lg:gap-4 lg:p-6">
        <div className="flex flex-1 flex-col gap-3 lg:gap-4">
          <CardDelFormulario titulo="Qué estás cargando">
            <div className="flex flex-col gap-3 lg:flex-row">
              {/* Dos tarjetas seleccionables y no un <select>: la maqueta pide
                  esto explícitamente (design/arandano.pen, nodos `eBTjd`/`Pqbdd`).
                  Son radios reales (`name="tipo"`), no botones con onClick: así
                  el valor llega al servidor sin depender de JavaScript. Se
                  apilan en el teléfono (`m34Naf`) y quedan lado a lado en
                  escritorio (Task 7 del ciclo móvil). */}
              <label className={TARJETA_TIPO}>
                <input
                  type="radio"
                  name="tipo"
                  value="PRODUCTO"
                  defaultChecked
                  className="sr-only"
                  onChange={() => setTipo('PRODUCTO')}
                />
                <Package aria-hidden="true" className={ICONO_TARJETA_TIPO} />
                <div className="flex flex-col gap-[3px]">
                  <span className={TITULO_TARJETA_TIPO}>Producto</span>
                  <span className={DETALLE_TARJETA_TIPO}>Lleva stock y se descuenta al vender</span>
                </div>
              </label>
              <label className={TARJETA_TIPO}>
                <input
                  type="radio"
                  name="tipo"
                  value="SERVICIO"
                  className="sr-only"
                  // Un servicio no lleva stock, así que tampoco puede llevar
                  // serie: apagar el switch acá evita que quede prendido y
                  // deshabilitado a la vez, mandando `llevaSerie=on` con un
                  // <Switch disabled> que ya no se puede destildar.
                  onChange={() => {
                    setTipo('SERVICIO')
                    setLlevaSerie(false)
                  }}
                />
                <Wrench aria-hidden="true" className={ICONO_TARJETA_TIPO} />
                <div className="flex flex-col gap-[3px]">
                  <span className={TITULO_TARJETA_TIPO}>Servicio</span>
                  <span className={DETALLE_TARJETA_TIPO}>
                    No lleva stock. Mano de obra, reparaciones
                  </span>
                </div>
              </label>
            </div>
            {/* Sin frame en design/arandano.pen: es anterior a esta feature
                (docs/superpowers/specs/2026-09-02-unidades-por-imei-design.md).
                Al lado del selector de tipo, en la misma card, porque sólo
                tiene sentido con PRODUCTO — deshabilitado y apagado con
                SERVICIO, misma razón por la que un servicio no lleva stock. El
                servidor (`crearArticulo`) rechaza igual la combinación: que
                la pantalla esconda o deshabilite un control nunca es la
                guarda, sólo lo es el servidor. */}
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-background p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="llevaSerie">Lleva IMEI o número de serie</Label>
                <p className="text-[11px] text-muted-foreground">
                  Cada unidad se identifica y se vende por separado
                </p>
              </div>
              <Switch
                id="llevaSerie"
                name="llevaSerie"
                checked={llevaSerie}
                disabled={tipo === 'SERVICIO'}
                onCheckedChange={setLlevaSerie}
              />
            </div>
          </CardDelFormulario>

          <CardDelFormulario titulo="Datos del artículo">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" name="nombre" required autoFocus className="h-10 rounded-[9px]" />
            </div>
            {/* El par de selectores vive en su propio componente desde el ciclo
                de la categoría en la ficha: la ficha usa el MISMO, que es lo
                que impide que las dos pantallas vuelvan a divergir. */}
            <SelectorDeCategoria arbol={arbol} />
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="sku">Código (SKU)</Label>
                <Input id="sku" name="sku" placeholder="Se genera solo si lo dejás vacío" className="h-10 rounded-[9px]" />
              </div>
              <div className="flex w-60 flex-col gap-2">
                <Label htmlFor="precio">Precio de venta</Label>
                {/* El input va COMO HIJO del selector, no al lado: el
                    componente es el campo compuesto entero (fila + aviso), y
                    ponerlos como hermanos es lo que partía el campo al medio
                    en cuanto el aviso aparecía. */}
                <SelectorDeMoneda id="moneda" name="moneda" valorInicial="ARS">
                  {/* type="text" con inputMode="decimal" y no type="number": el
                      teclado numérico aparece igual en el celular, pero la coma
                      llega sin que el navegador la descarte. El parseo lo hace
                      lib/formato/numeros.ts. */}
                  <Input
                    id="precio"
                    name="precio"
                    inputMode="decimal"
                    placeholder="15000,50"
                    required
                    className="h-10 flex-1 rounded-l-none rounded-r-[9px]"
                  />
                </SelectorDeMoneda>
              </div>
            </div>
            {/* El número real, no un texto genérico: sale de
                Tenant.proximoSkuArticulo, leído sin incrementarlo (page.tsx). Si
                alguien más da de alta un artículo primero, este número puede
                quedar desactualizado — el que de verdad cuenta se pide recién al
                guardar, adentro de crearArticulo. */}
            <p className="text-[11px] leading-[1.4] text-muted-foreground">
              El próximo código libre es el {proximoSku}. Puede haber huecos en la numeración: es a
              propósito.
            </p>
          </CardDelFormulario>

          <Resultado estado={estado} />
        </div>

        <div className="flex flex-col gap-3 lg:w-[420px] lg:shrink-0 lg:gap-4">
          {tipo === 'PRODUCTO' && (
            <CardDelFormulario titulo="Stock inicial">
              {/* Prendido el switch, la Cantidad se reemplaza por la lista de
                  IMEI: el stock deja de ser un número que se tipea y pasa a
                  ser cuántas unidades hay en la lista. El costo unitario se
                  mantiene en los dos casos, así que va en su propia fila y no
                  adentro de este condicional. */}
              {llevaSerie ? (
                <div className="flex flex-col gap-2">
                  <Label>IMEI o número de serie</Label>
                  <ListaDeImeis />
                </div>
              ) : (
                <div className="flex w-[220px] flex-col gap-2">
                  <Label htmlFor="stockInicial">Cantidad (opcional)</Label>
                  <Input id="stockInicial" name="stockInicial" inputMode="decimal" className="h-10 rounded-[9px]" />
                </div>
              )}
              {/* Sin el permiso COSTOS, el campo no se dibuja. El
                  blindaje real está en el servidor (altaArticulo,
                  acciones.ts): esconderlo acá es sólo la UI. */}
              {puedeCostos && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="costoUnitario">Costo unitario (opcional)</Label>
                  <Input
                    id="costoUnitario"
                    name="costoUnitario"
                    inputMode="decimal"
                    className="h-10 rounded-[9px]"
                  />
                </div>
              )}
              {/* El tercer campo que la maqueta dibuja en esta card
                  (design/arandano.pen, frame `B4O7t`). **No es una columna
                  nueva**: va como nota del movimiento de stock inicial, que es
                  exactamente para lo que `MovimientoStock.nota` existe y lo
                  que el ingreso de mercadería de la ficha ya hace. */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="facturaProveedor">Factura del proveedor (opcional)</Label>
                <Input
                  id="facturaProveedor"
                  name="facturaProveedor"
                  placeholder="A 0001-00023456"
                  className="h-10 rounded-[9px]"
                />
              </div>
              <div className="flex items-start gap-[9px] rounded-[10px] bg-background p-3">
                <Info
                  aria-hidden="true"
                  className="mt-0.5 size-[15px] shrink-0 text-muted-foreground"
                />
                <p className="text-[11px] leading-[1.45] text-muted-foreground">
                  El stock inicial entra como movimiento, no como un número suelto: el historial del
                  artículo arranca explicando de dónde salió cada unidad.
                </p>
              </div>
            </CardDelFormulario>
          )}
        </div>
      </div>

      {/* El pie del teléfono (design/arandano.pen, nodo "Pie" de `m34Naf`):
          los mismos "Cancelar"/"Guardar artículo" del Topbar, repetidos —
          `lg:hidden`, el Topbar ya los muestra en escritorio (`hidden
          lg:flex`, adentro de `acciones`). Los dos viven dentro del MISMO
          `<form>` que envuelve toda la pantalla (className="contents" en el
          `<form>` de arriba), así que ninguno necesita el atributo `form=`:
          alcanza con ser descendiente. "Cancelar" cambia de variant acá
          — `outline`, con el borde que la maqueta dibuja (`stroke:
          $ar-line-strong`) — porque el `ghost` de escritorio no tiene fondo
          ni borde, y sin ninguno de los dos un botón "Cancelar" al pie de un
          teléfono es un área táctil invisible. */}
      <div className="sticky bottom-0 z-10 flex items-center gap-[10px] border-t bg-card p-[14px] lg:hidden">
        <Button asChild variant="outline" className={`shrink-0 ${CLASES_BOTON_PIE}`}>
          <Link href="/inventario">Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pendiente} className={`flex-1 ${CLASES_BOTON_PIE}`}>
          <Check aria-hidden="true" className="size-[15px]" />
          {pendiente ? 'Creando…' : 'Guardar artículo'}
        </Button>
      </div>
    </form>
  )
}

// Los dos <form> que "Guardar cambios" y "Desactivar"/"Reactivar" disparan
// desde el Topbar (ver el comentario de FichaDeArticulo). Constantes y no
// strings sueltos en cada lugar que los usa: el id del <form> y el `form=`
// del botón tienen que coincidir siempre, en las dos puntas.
const FORM_EDITAR_ARTICULO = 'form-editar-articulo'
const FORM_BAJA_ARTICULO = 'form-baja-articulo'

/**
 * La ficha entera de un artículo: el `<Encabezado>` con sus acciones, el
 * `<form>` invisible que dispara desactivar/reactivar, y la card "Datos" que
 * edita — más lo que `page.tsx` ya arma para las columnas (`columnaIzquierda`,
 * `columnaDerechaExtra`) y cualquier aviso que tenga que ir arriba de todo
 * (`children`, p. ej. el `<Alert>` de "artículo desactivado").
 *
 * **Por qué es UN SOLO componente y no dos, como antes de este ciclo**
 * (`FormularioDeEdicion` + `AccionesDeArticulo` separados). La maqueta
 * (design/arandano.pen, frame `y4tEb`) pone "Guardar cambios" y "Desactivar"
 * en el Topbar, mientras que sus campos y su `<form>` real viven en el
 * Cuerpo, dos secciones que en el DOM final quedan lejos una de la otra. Un
 * `<button type="submit">` que no es descendiente del `<form>` que dispara
 * necesita el atributo HTML `form={id}` para asociarse — eso resuelve la
 * distancia física—, pero el estado de `useActionState` (`pendiente`, el
 * error) sólo lo conoce el componente que llamó al hook. Si el botón del
 * Topbar y el `<form>` del Cuerpo fueran dos instancias de React separadas,
 * cada una con su propio `useActionState`, terminarían con estados
 * DESINCRONIZADOS: el `<form>` real se entera del submit y cambia de estado,
 * pero el botón —que llamó a un hook distinto— nunca se entera y se queda
 * mostrando "Guardar cambios" para siempre. La única forma de que el mismo
 * `pendiente` gobierne los dos lugares es que sea UN SOLO componente el que
 * llame al hook una vez y reparta el resultado.
 */
export function FichaDeArticulo({
  titulo,
  subtitulo,
  articuloId,
  desactivado,
  puedeEditar,
  nombre,
  sku,
  precio,
  moneda,
  arbol,
  categoriaId,
  columnaIzquierda,
  columnaDerechaExtra,
  children,
}: {
  titulo: string
  subtitulo: ReactNode
  articuloId: string
  desactivado: boolean
  puedeEditar: boolean
  nombre: string
  sku: string
  precio: string
  moneda: 'ARS' | 'USD'
  arbol: RamaConHijas[]
  categoriaId: string | null
  columnaIzquierda: ReactNode
  columnaDerechaExtra?: ReactNode
  children?: ReactNode
}) {
  const [estadoEditar, accionEditar, editando] = useActionState(guardarArticulo, INICIAL)
  const [estadoBaja, accionBaja, dandoBaja] = useActionState(
    desactivado ? reactivarArticuloAccion : bajaArticulo,
    INICIAL,
  )

  return (
    <>
      <Encabezado
        titulo={titulo}
        subtitulo={subtitulo}
        atras="/inventario"
        // Sin accionMovil (spec §7.4, Task 7 del ciclo móvil): el frame T5gME
        // dibuja un `more-vertical`, pero las dos acciones ya están al pie y
        // las secundarias (ingresar mercadería, corregir por conteo,
        // exportar CSV) ya están en el cuerpo — no queda nada que ese menú
        // pueda contener sin inventarlo.
        acciones={
          puedeEditar ? (
            <>
              <Button
                type="submit"
                form={FORM_BAJA_ARTICULO}
                // Condicional, no fijo en "destructive": reactivar un
                // artículo no es una acción destructiva y pintarla en rojo la
                // hace parecer una — antes del rediseño ya era
                // `desactivado ? 'secondary' : 'destructive'`, y esta task lo
                // había dejado fijo por error.
                variant={desactivado ? 'secondary' : 'destructive'}
                disabled={dandoBaja}
              >
                {desactivado ? (
                  <RotateCcw aria-hidden="true" className="size-[15px]" />
                ) : (
                  <Ban aria-hidden="true" className="size-[15px]" />
                )}
                {dandoBaja
                  ? desactivado
                    ? 'Reactivando…'
                    : 'Desactivando…'
                  : desactivado
                    ? 'Reactivar'
                    : 'Desactivar'}
              </Button>
              <Button type="submit" form={FORM_EDITAR_ARTICULO} disabled={editando}>
                <Check aria-hidden="true" className="size-[15px]" />
                {editando ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </>
          ) : undefined
        }
      />
      {/* Sin ningún campo visible: existe sólo para que el botón "Desactivar"/
          "Reactivar" del Topbar tenga un <form> al que apuntar por id. */}
      {puedeEditar && (
        <form id={FORM_BAJA_ARTICULO} action={accionBaja} className="hidden" aria-hidden="true">
          <input type="hidden" name="articuloId" value={articuloId} />
        </form>
      )}
      <div className="flex flex-col gap-3 px-[14px] py-3 lg:gap-4 lg:p-6">
        {/* El aviso de cada acción va arriba de todo, no junto a su campo: con
            el botón en el Topbar y el <form> en la columna derecha, no hay un
            solo lugar "al lado" de los dos a la vez. */}
        {puedeEditar && (
          <>
            <Resultado estado={estadoEditar} />
            <Resultado estado={estadoBaja} />
          </>
        )}
        {children}
        {/* Mobile-first (Task 7 del ciclo móvil, frame `T5gME`): a diferencia
            de FormularioDeAlta, acá el orden de la maqueta en el teléfono NO
            coincide con concatenar "primero la columna izquierda, después la
            derecha" — "Datos" aparece ANTES que "Ingresar mercadería"/
            "Corregir por conteo" (que vienen de columnaIzquierda) y "Cómo se
            movió" (columnaDerechaExtra) va ANTES que el historial. Mismo
            mecanismo `contents`+`order-N` que ya usa `Detalle` en
            app/(app)/ventas/[id]/page.tsx (ver su docblock): cada columna es
            `contents` en el teléfono —se disuelve, y sus hijos pasan a ser
            hermanos planos del `flex-col` de más afuera— y vuelve a ser una
            columna real (`lg:flex`) en escritorio, donde `lg:order-none`
            restaura el orden natural del DOM. Los tres pedazos de
            `columnaIzquierda` (tiles, MoverStock, historial) llevan su
            `order-N` en `[id]/page.tsx`, que es donde se arman; acá sólo se
            ordenan "Datos" (order-2) y `columnaDerechaExtra` (order-4). */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
          <div className="contents lg:flex lg:flex-1 lg:flex-col lg:gap-4">{columnaIzquierda}</div>
          {/* Sin la columna entera —no sólo su contenido— cuando no hay nada
              que mostrar: un EMPLEADO mirando un SERVICIO no tiene "Datos"
              (puedeEditar) ni "Cómo se movió" (columnaDerechaExtra, sólo para
              productos), y sin esta condición el <div> de 324 px quedaba
              reservando el hueco vacío igual, en vez de dejarle todo el ancho
              a la columna izquierda. */}
          {(puedeEditar || columnaDerechaExtra) && (
            <div className="contents lg:flex lg:w-[324px] lg:shrink-0 lg:flex-col lg:gap-4">
              {puedeEditar && (
                <div className="order-2 lg:order-none">
                  <CardDelFormulario titulo="Datos">
                    <form id={FORM_EDITAR_ARTICULO} action={accionEditar} className="contents">
                      <input type="hidden" name="articuloId" value={articuloId} />
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="e-nombre">Nombre</Label>
                        <Input id="e-nombre" name="nombre" defaultValue={nombre} required className="h-10 rounded-[9px]" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="e-precio">Precio de venta</Label>
                        {/* Mismo componente que el alta, no una segunda
                            implementación: components/selector-de-moneda.tsx. */}
                        <SelectorDeMoneda id="e-moneda" name="moneda" valorInicial={moneda}>
                          <Input
                            id="e-precio"
                            name="precio"
                            inputMode="decimal"
                            defaultValue={precio}
                            required
                            className="h-10 flex-1 rounded-l-none rounded-r-[9px]"
                          />
                        </SelectorDeMoneda>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="e-sku">Código</Label>
                        <Input id="e-sku" name="sku" defaultValue={sku} required className="h-10 rounded-[9px]" />
                      </div>
                      {/* Apilados y no en fila, a diferencia del alta: esta card
                          mide 324 px, y dos selects lado a lado quedan en ~150
                          cada uno, donde "Vidrios templados" no entra. La
                          maqueta no dibuja este control acá — anotado en
                          docs/correcciones-pendientes-del-pen.md, entrada 7. */}
                      <SelectorDeCategoria
                        arbol={arbol}
                        categoriaIdInicial={categoriaId}
                        orientacion="columna"
                      />
                      {/* El tipo no está y no es un olvido: pasar un PRODUCTO con
                          stock y movimientos a SERVICIO deja stock huérfano que el
                          motor ya no descuenta ni explica. Un artículo mal cargado
                          se desactiva y se crea de nuevo. */}
                    </form>
                  </CardDelFormulario>
                </div>
              )}
              {columnaDerechaExtra && (
                // `flex flex-col gap-*` y no un `div` pelado: el fragmento trae
                // DOS cards ("Precios por forma de pago" y "Cómo se movió"), y
                // antes del merge colgaban directo de la columna, heredando su
                // gap. Envueltas en un bloque sin gap propio quedaban con los
                // bordes pegados, en los dos anchos.
                <div className="order-4 flex flex-col gap-3 lg:order-none lg:gap-4">
                  {columnaDerechaExtra}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* El pie del teléfono (design/arandano.pen, nodo "Pie" de `T5gME`):
          los mismos "Desactivar"/"Reactivar" y "Guardar cambios" del Topbar,
          repetidos — `lg:hidden`, atados a los MISMOS `<form>` por `form=`
          (nunca por `id=`: los botones del pie no llevan uno propio).

          La guarda es `puedeEditar` —el permiso `ARTICULOS_EDITAR`—, la MISMA
          que la copia del Topbar (`acciones`, más arriba) y que el `<form>`
          de baja. Las dos copias del par de botones se guardan con la misma
          expresión: gatear sólo una dejaría a un empleado sin el permiso con
          "Desactivar" y "Guardar cambios" a mano en el teléfono.
          `formularios.test.tsx` lo fija contando ocurrencias. */}
      {puedeEditar && (
        <div className="sticky bottom-0 z-10 flex items-center gap-[10px] border-t bg-card p-[14px] lg:hidden">
          <Button
            type="submit"
            form={FORM_BAJA_ARTICULO}
            variant={desactivado ? 'secondary' : 'destructive'}
            disabled={dandoBaja}
            className={`shrink-0 ${CLASES_BOTON_PIE}`}
          >
            {desactivado ? (
              <RotateCcw aria-hidden="true" className="size-[15px]" />
            ) : (
              <Ban aria-hidden="true" className="size-[15px]" />
            )}
            {dandoBaja
              ? desactivado
                ? 'Reactivando…'
                : 'Desactivando…'
              : desactivado
                ? 'Reactivar'
                : 'Desactivar'}
          </Button>
          <Button
            type="submit"
            form={FORM_EDITAR_ARTICULO}
            disabled={editando}
            className={`flex-1 ${CLASES_BOTON_PIE}`}
          >
            <Check aria-hidden="true" className="size-[15px]" />
            {editando ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      )}
    </>
  )
}

/**
 * Las dos formas de mover stock, una al lado de la otra.
 *
 * El conteo pide CUÁNTO HAY, no cuánto falta: el delta lo calcula el servidor
 * adentro de la transacción, contra el stock de ese momento. Pedirlo acá
 * obligaría a restar en el navegador contra un número que puede tener un
 * minuto y una venta de antigüedad.
 */
export function MoverStock({
  articuloId,
  puedeCostos,
}: {
  articuloId: string
  puedeCostos: boolean
}) {
  const [ingreso, accionIngreso, ingresando] = useActionState(ingresarMercaderia, INICIAL)
  const [conteo, accionConteo, contando] = useActionState(corregirPorConteo, INICIAL)

  return (
    // Horizontal en escritorio (design/arandano.pen, nodo `T5Gc91`: las dos
    // cards lado a lado, gap16); apiladas en el teléfono (Task 7 del ciclo
    // móvil, frame `T5gME`: "Ingresar mercadería" y "Corregir por conteo" son
    // dos cards de ancho completo, una debajo de la otra, no dos columnas
    // angostas).
    <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
      <Card className="lg:flex-1">
        <CardHeader>
          <CardTitle>Ingresar mercadería</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accionIngreso} className="flex flex-col gap-4">
            <input type="hidden" name="articuloId" value={articuloId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-cantidad">Cantidad que entra</Label>
              <Input id="i-cantidad" name="cantidad" inputMode="decimal" required className="h-10 rounded-[9px]" />
            </div>
            {/* Sin el permiso COSTOS, el campo no se dibuja. El blindaje
                real está en el servidor (ingresarMercaderia, acciones.ts):
                esconderlo acá es sólo la UI. */}
            {puedeCostos && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="i-costo">Costo unitario (opcional)</Label>
                <Input id="i-costo" name="costoUnitario" inputMode="decimal" className="h-10 rounded-[9px]" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-nota">Nota (opcional)</Label>
              <Input id="i-nota" name="nota" placeholder="Factura, proveedor…" className="h-10 rounded-[9px]" />
            </div>
            <Resultado estado={ingreso} />
            <Button type="submit" disabled={ingresando}>
              {ingresando ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:flex-1">
        <CardHeader>
          <CardTitle>Corregir por conteo</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accionConteo} className="flex flex-col gap-4">
            <input type="hidden" name="articuloId" value={articuloId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-contado">Cuánto hay realmente</Label>
              <Input id="c-contado" name="stockContado" inputMode="decimal" required className="h-10 rounded-[9px]" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-nota">Nota (opcional)</Label>
              <Input id="c-nota" name="nota" placeholder="Conteo del lunes…" className="h-10 rounded-[9px]" />
            </div>
            <Resultado estado={conteo} />
            <Button type="submit" variant="secondary" disabled={contando}>
              {contando ? 'Corrigiendo…' : 'Corregir'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * "Exportar CSV →" (design/arandano.pen, frame `y4tEb`, nodo `HlObR`): texto
 * de acción sobre el Encabezado de la card de historial, sin fondo ni borde.
 *
 * No es un `<form action={...}>` como el resto de este archivo: la decisión
 * ya tomada (CLAUDE.md) es que `exportarHistorialCsv` arma el CSV en memoria
 * y lo devuelve como STRING, no como una respuesta HTTP con
 * `Content-Disposition` — un server action no puede fijar esos headers. Así
 * que la única forma de convertir ese string en una descarga real es
 * llamarlo directo (no vía `<form>`) y armar el Blob acá, del lado del
 * cliente — el único onClick de todo este módulo que no pasa por
 * `useActionState`.
 */
export function BotonExportarCsv({ articuloId }: { articuloId: string }) {
  const [exportando, setExportando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportar() {
    setExportando(true)
    setError(null)
    try {
      const { csv, nombreArchivo } = await exportarHistorialCsv(articuloId)
      // El BOM (﻿) al principio del Blob no es decorativo: sin él, Excel
      // en Windows abre un CSV con acentos asumiendo Latin-1 y rompe cada
      // "ó"/"ñ" — el motivo más común de un CSV que se ve perfecto en un
      // editor de texto y mal en la planilla de alguien.
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      enlace.download = nombreArchivo
      // Insertado en el DOM y no sólo creado: Safari no dispara la descarga
      // de un <a download> al que nunca se le hizo appendChild, que es la
      // forma canónica de la descarga que en ese navegador no hace nada.
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      // revokeObjectURL en el siguiente tick, no sincrónico: hacerlo justo
      // después del click() puede ganarle a la descarga que el navegador
      // todavía no terminó de arrancar, sobre todo con el archivo más grande
      // que el resto de esta pantalla maneja (todo el historial, sin el
      // límite de filas de la tabla).
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      setError('No se pudo exportar. Probá de nuevo.')
    } finally {
      setExportando(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={exportar}
        disabled={exportando}
        className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-50"
      >
        {exportando ? 'Exportando…' : 'Exportar CSV →'}
      </button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  )
}
