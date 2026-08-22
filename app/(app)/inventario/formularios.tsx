'use client'

import type { ReactNode } from 'react'
import { useActionState, useState } from 'react'
import { Package, Wrench, Info } from 'lucide-react'
import {
  altaArticulo,
  guardarArticulo,
  bajaArticulo,
  reactivarArticuloAccion,
  ingresarMercaderia,
  corregirPorConteo,
  type EstadoInventario,
} from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
 */
export function FormularioDeAlta({ proximoSku }: { proximoSku: string }) {
  const [estado, accion, pendiente] = useActionState(altaArticulo, INICIAL)
  const [tipo, setTipo] = useState<'PRODUCTO' | 'SERVICIO'>('PRODUCTO')

  return (
    <form action={accion} className="flex flex-col gap-4">
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
              <span className={DETALLE_TARJETA_TIPO}>No lleva stock. Mano de obra, reparaciones</span>
            </div>
          </label>
        </div>
      </CardDelFormulario>

      <CardDelFormulario titulo="Datos del artículo">
        <div className="flex flex-col gap-2">
          <Label htmlFor="nombre">Nombre</Label>
          <Input id="nombre" name="nombre" required autoFocus />
        </div>
        {/* La maqueta (design/arandano.pen) no trae este campo en ninguno de
            los dos formularios, y a propósito se aparta acá: muestra la
            categoría en el listado y en el subtítulo de la ficha, y un dato
            que se ve pero no se puede cargar nace siempre vacío. String
            libre, sin catálogo de opciones: Articulo.categoria no tiene
            tabla ni jerarquía (comentario del schema). */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="categoria">Categoría (opcional)</Label>
          <Input id="categoria" name="categoria" placeholder="Accesorios · Protección" />
        </div>
        <div className="flex gap-3">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="sku">Código (SKU)</Label>
            <Input id="sku" name="sku" placeholder="Se genera solo si lo dejás vacío" />
          </div>
          <div className="flex w-60 flex-col gap-2">
            <Label htmlFor="precio">Precio de venta</Label>
            {/* type="text" con inputMode="decimal" y no type="number": el
                teclado numérico aparece igual en el celular, pero la coma
                llega sin que el navegador la descarte. El parseo lo hace
                lib/formato/numeros.ts. */}
            <Input id="precio" name="precio" inputMode="decimal" placeholder="15000,50" required />
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

      {tipo === 'PRODUCTO' && (
        <CardDelFormulario titulo="Stock inicial">
          <div className="flex gap-3">
            <div className="flex w-[220px] flex-col gap-2">
              <Label htmlFor="stockInicial">Cantidad (opcional)</Label>
              <Input id="stockInicial" name="stockInicial" inputMode="decimal" />
            </div>
            {/* flex-1 y no un ancho fijo como en la maqueta: ahí un tercer
                campo ("Nota") ocupa el resto de la fila, y ese campo queda
                fuera de este ciclo (ver el comentario de EntradaCrearArticulo
                en lib/inventario/articulos.ts, que este ciclo no toca). Sin
                él, dejarle un ancho fijo a Costo unitario abría un hueco
                vacío a la derecha. */}
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="costoUnitario">Costo unitario (opcional)</Label>
              <Input id="costoUnitario" name="costoUnitario" inputMode="decimal" />
            </div>
          </div>
          <div className="flex items-start gap-[9px] rounded-[10px] bg-background p-3">
            <Info aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-[1.45] text-muted-foreground">
              El stock inicial entra como movimiento, no como un número suelto: el historial del
              artículo arranca explicando de dónde salió cada unidad.
            </p>
          </div>
        </CardDelFormulario>
      )}

      <Resultado estado={estado} />
      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Creando…' : 'Crear artículo'}
      </Button>
    </form>
  )
}

/** Editar. Sólo se monta para un dueño; la action lo reexige igual. */
export function FormularioDeEdicion({
  articuloId,
  nombre,
  sku,
  precio,
  categoria,
}: {
  articuloId: string
  nombre: string
  sku: string
  precio: string
  categoria: string | null
}) {
  const [estado, accion, pendiente] = useActionState(guardarArticulo, INICIAL)

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Editar</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="articuloId" value={articuloId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-nombre">Nombre</Label>
            <Input id="e-nombre" name="nombre" defaultValue={nombre} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-sku">Código</Label>
            <Input id="e-sku" name="sku" defaultValue={sku} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-categoria">Categoría (opcional)</Label>
            {/* '' y no `categoria` crudo: un <input> no controlado con
                defaultValue={null} tira la advertencia de React de pasar de
                no-controlado a controlado si alguna vez cambiara. */}
            <Input id="e-categoria" name="categoria" defaultValue={categoria ?? ''} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-precio">Precio</Label>
            <Input id="e-precio" name="precio" inputMode="decimal" defaultValue={precio} required />
          </div>
          {/* El tipo no está y no es un olvido: pasar un PRODUCTO con stock y
              movimientos a SERVICIO deja stock huérfano que el motor ya no
              descuenta ni explica. Un artículo mal cargado se desactiva y se
              crea de nuevo. */}
          <Resultado estado={estado} />
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Desactivar o reactivar. Un form y no un onClick, igual que el botón de
 *  salir del layout: así funciona sin JavaScript. */
export function AccionesDeArticulo({
  articuloId,
  desactivado,
}: {
  articuloId: string
  desactivado: boolean
}) {
  const [estado, accion, pendiente] = useActionState(
    desactivado ? reactivarArticuloAccion : bajaArticulo,
    INICIAL,
  )

  return (
    <form action={accion} className="mt-4 flex max-w-md flex-col gap-3">
      <input type="hidden" name="articuloId" value={articuloId} />
      <Resultado estado={estado} />
      <Button type="submit" variant={desactivado ? 'secondary' : 'destructive'} disabled={pendiente}>
        {desactivado ? 'Reactivar artículo' : 'Desactivar artículo'}
      </Button>
    </form>
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
    <div className="flex flex-col gap-4 md:flex-row">
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Ingresar mercadería</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accionIngreso} className="flex flex-col gap-4">
            <input type="hidden" name="articuloId" value={articuloId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-cantidad">Cantidad que entra</Label>
              <Input id="i-cantidad" name="cantidad" inputMode="decimal" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-costo">Costo unitario (opcional)</Label>
              <Input id="i-costo" name="costoUnitario" inputMode="decimal" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-nota">Nota (opcional)</Label>
              <Input id="i-nota" name="nota" placeholder="Factura, proveedor…" />
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
              <Input id="c-contado" name="stockContado" inputMode="decimal" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-nota">Nota (opcional)</Label>
              <Input id="c-nota" name="nota" placeholder="Conteo del lunes…" />
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
