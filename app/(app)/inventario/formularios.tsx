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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { RamaConHijas } from '@/lib/inventario/categorias'
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
      <div className="border-b px-[18px] py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>{titulo}</h2>
      </div>
      <div className="flex flex-col gap-[14px] p-[18px]">{children}</div>
    </div>
  )
}

/** Clases compartidas por las dos tarjetas seleccionables Producto/Servicio.
 *  `has-[:checked]` y `group-has-[:checked]` hacen que el estado visual
 *  ("seleccionada" o no) sea CSS puro sobre el radio real: funciona sin
 *  JavaScript, a diferencia de la visibilidad del bloque de Stock inicial
 *  más abajo, que si necesita `onChange` porque decide si otra card entera
 *  se monta o no. */
const TARJETA_TIPO =
  'group flex flex-1 cursor-pointer items-start gap-[11px] rounded-xl border border-input bg-card p-[14px] has-[:checked]:border-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring'
const TITULO_TARJETA_TIPO =
  'text-sm font-semibold text-foreground group-has-[:checked]:text-primary'
const DETALLE_TARJETA_TIPO = 'text-[11px] text-muted-foreground group-has-[:checked]:text-primary'
const ICONO_TARJETA_TIPO = 'size-[19px] text-muted-foreground group-has-[:checked]:text-primary'

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
}: {
  proximoSku: string
  arbol: RamaConHijas[]
}) {
  const [estado, accion, pendiente] = useActionState(altaArticulo, INICIAL)
  const [tipo, setTipo] = useState<'PRODUCTO' | 'SERVICIO'>('PRODUCTO')
  /**
   * El rubro elegido, que es lo que decide qué marcas ofrece el segundo
   * selector. Vive acá y no adentro del bloque de categoría porque cambiar de
   * rubro tiene que LIMPIAR la marca: dejarla puesta guardaría una marca que
   * pertenece a otro rubro, y el servidor la aceptaría sin chistar porque el
   * id existe.
   */
  const [rubroId, setRubroId] = useState<string>('')
  const [marcaId, setMarcaId] = useState<string>('')
  const marcasDelRubro = arbol.find((r) => r.id === rubroId)?.hijas ?? []

  return (
    <form action={accion} className="contents">
      <Encabezado
        titulo="Artículo nuevo"
        subtitulo="Se agrega al catálogo del local"
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
          inicial en 420 fijos. Antes era una sola columna de 760 centrada. */}
      <div className="flex items-start gap-4 p-6">
        <div className="flex flex-1 flex-col gap-4">
          <CardDelFormulario titulo="Qué estás cargando">
            <div className="flex gap-3">
              {/* Dos tarjetas seleccionables y no un <select>: la maqueta pide
                  esto explícitamente (design/arandano.pen, nodos `eBTjd`/`Pqbdd`).
                  Son radios reales (`name="tipo"`), no botones con onClick: así
                  el valor llega al servidor sin depender de JavaScript. */}
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
                  onChange={() => setTipo('SERVICIO')}
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
          </CardDelFormulario>

          <CardDelFormulario titulo="Datos del artículo">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" name="nombre" required autoFocus className="h-10 rounded-[9px]" />
            </div>
            {/* Dos selectores y no un campo de texto (design/arandano.pen,
                frame `B4O7t`: "Categoría" y "Marca", cada uno con su
                chevron-down). Es el cambio que trae el árbol, y **quita una
                capacidad que existía**: hasta ahora, escribir "Fundas ·
                Samsung" acá CREABA las dos ramas al vuelo. Ahora se elige de
                lo que hay, y para crear una categoría se va al panel de
                /inventario — de ahí el link de abajo, que es la mitigación de
                esa fricción. Es la consecuencia directa de haber elegido
                "catálogo propio" sobre "catálogo creable al vuelo". */}
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="categoriaId">Categoría</Label>
                <Select
                  name="categoriaId"
                  value={rubroId}
                  onValueChange={(v) => {
                    setRubroId(v)
                    // Cambiar de rubro limpia la marca: si no, quedaría
                    // elegida una marca de otro rubro.
                    setMarcaId('')
                  }}
                >
                  <SelectTrigger id="categoriaId" className="h-10 w-full rounded-[9px]">
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {arbol.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="marcaId">Marca</Label>
                <Select
                  name="marcaId"
                  value={marcaId}
                  onValueChange={setMarcaId}
                  // Deshabilitado y no vacío-y-clickeable: un selector que se
                  // abre para no mostrar nada invita a buscar algo que no está.
                  disabled={marcasDelRubro.length === 0}
                >
                  <SelectTrigger id="marcaId" className="h-10 w-full rounded-[9px]">
                    <SelectValue
                      placeholder={rubroId === '' ? 'Elegí una categoría' : 'Sin marca'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {marcasDelRubro.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] leading-[1.4] text-muted-foreground">
              Las categorías se crean y se ordenan en{' '}
              <Link href="/inventario" className="underline">
                el panel de Inventario
              </Link>
              .
            </p>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="sku">Código (SKU)</Label>
                <Input id="sku" name="sku" placeholder="Se genera solo si lo dejás vacío" className="h-10 rounded-[9px]" />
              </div>
              <div className="flex w-60 flex-col gap-2">
                <Label htmlFor="precio">Precio de venta</Label>
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
                  className="h-10 rounded-[9px]"
                />
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

        <div className="flex w-[420px] shrink-0 flex-col gap-4">
          {tipo === 'PRODUCTO' && (
            <CardDelFormulario titulo="Stock inicial">
              <div className="flex gap-3">
                <div className="flex w-[220px] flex-col gap-2">
                  <Label htmlFor="stockInicial">Cantidad (opcional)</Label>
                  <Input id="stockInicial" name="stockInicial" inputMode="decimal" className="h-10 rounded-[9px]" />
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="costoUnitario">Costo unitario (opcional)</Label>
                  <Input id="costoUnitario" name="costoUnitario" inputMode="decimal" className="h-10 rounded-[9px]" />
                </div>
              </div>
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
  esDuenio,
  nombre,
  sku,
  precio,
  categoria,
  columnaIzquierda,
  columnaDerechaExtra,
  children,
}: {
  titulo: string
  subtitulo: ReactNode
  articuloId: string
  desactivado: boolean
  esDuenio: boolean
  nombre: string
  sku: string
  precio: string
  categoria: string | null
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
        acciones={
          esDuenio ? (
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
      {esDuenio && (
        <form id={FORM_BAJA_ARTICULO} action={accionBaja} className="hidden" aria-hidden="true">
          <input type="hidden" name="articuloId" value={articuloId} />
        </form>
      )}
      <div className="flex flex-col gap-4 p-6">
        {/* El aviso de cada acción va arriba de todo, no junto a su campo: con
            el botón en el Topbar y el <form> en la columna derecha, no hay un
            solo lugar "al lado" de los dos a la vez. */}
        {esDuenio && (
          <>
            <Resultado estado={estadoEditar} />
            <Resultado estado={estadoBaja} />
          </>
        )}
        {children}
        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-4">{columnaIzquierda}</div>
          {/* Sin la columna entera —no sólo su contenido— cuando no hay nada
              que mostrar: un EMPLEADO mirando un SERVICIO no tiene "Datos"
              (esDuenio) ni "Cómo se movió" (columnaDerechaExtra, sólo para
              productos), y sin esta condición el <div> de 324 px quedaba
              reservando el hueco vacío igual, en vez de dejarle todo el ancho
              a la columna izquierda. */}
          {(esDuenio || columnaDerechaExtra) && (
            <div className="flex w-[324px] shrink-0 flex-col gap-4">
              {esDuenio && (
                <CardDelFormulario titulo="Datos">
                  <form id={FORM_EDITAR_ARTICULO} action={accionEditar} className="contents">
                    <input type="hidden" name="articuloId" value={articuloId} />
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="e-nombre">Nombre</Label>
                      <Input id="e-nombre" name="nombre" defaultValue={nombre} required className="h-10 rounded-[9px]" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="e-precio">Precio de venta</Label>
                      <Input
                        id="e-precio"
                        name="precio"
                        inputMode="decimal"
                        defaultValue={precio}
                        required
                        className="h-10 rounded-[9px]"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex flex-1 flex-col gap-2">
                        <Label htmlFor="e-sku">Código</Label>
                        <Input id="e-sku" name="sku" defaultValue={sku} required className="h-10 rounded-[9px]" />
                      </div>
                      <div className="flex flex-1 flex-col gap-2">
                        <Label htmlFor="e-categoria">Categoría</Label>
                        {/* '' y no `categoria` crudo: un <input> no controlado
                            con defaultValue={null} tira la advertencia de React
                            de pasar de no-controlado a controlado. */}
                        <Input id="e-categoria" name="categoria" defaultValue={categoria ?? ''} className="h-10 rounded-[9px]" />
                      </div>
                    </div>
                    {/* El tipo no está y no es un olvido: pasar un PRODUCTO con
                        stock y movimientos a SERVICIO deja stock huérfano que el
                        motor ya no descuenta ni explica. Un artículo mal cargado
                        se desactiva y se crea de nuevo. */}
                  </form>
                </CardDelFormulario>
              )}
              {columnaDerechaExtra}
            </div>
          )}
        </div>
      </div>
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
export function MoverStock({ articuloId }: { articuloId: string }) {
  const [ingreso, accionIngreso, ingresando] = useActionState(ingresarMercaderia, INICIAL)
  const [conteo, accionConteo, contando] = useActionState(corregirPorConteo, INICIAL)

  return (
    // Horizontal siempre, sin quiebre a columna: design/arandano.pen (nodo
    // `T5Gc91`) dibuja las dos cards siempre lado a lado, gap16 — como el
    // resto de esta pantalla, la maqueta es un diseño de escritorio fijo, sin
    // ningún quiebre de mobile documentado.
    <div className="flex gap-4">
      <Card className="flex-1">
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-costo">Costo unitario (opcional)</Label>
              <Input id="i-costo" name="costoUnitario" inputMode="decimal" className="h-10 rounded-[9px]" />
            </div>
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

      <Card className="flex-1">
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
