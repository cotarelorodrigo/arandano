'use client'

import { useActionState, useState } from 'react'
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
 * Alta de artículo.
 *
 * Los campos de stock se ocultan al elegir "servicio" — un servicio no lleva
 * stock. **Sin JavaScript se ven igual**, y por eso `altaArticulo` los ignora
 * cuando el tipo es SERVICIO en vez de rechazar el alta: la pantalla mejora
 * con JS, no depende de él.
 */
export function FormularioDeAlta() {
  const [estado, accion, pendiente] = useActionState(altaArticulo, INICIAL)
  const [tipo, setTipo] = useState<'PRODUCTO' | 'SERVICIO'>('PRODUCTO')

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Artículo nuevo</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" name="nombre" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tipo">Tipo</Label>
            {/* h-8 y no h-9: son los 32 px que docs/sistema-de-diseno.md
                declara para input y botón. Mismo caso que el select de rol en
                usuarios/formularios.tsx. */}
            <select
              id="tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as 'PRODUCTO' | 'SERVICIO')}
              className="h-8 rounded-md border px-3 text-sm"
            >
              <option value="PRODUCTO">Producto (lleva stock)</option>
              <option value="SERVICIO">Servicio (sin stock)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="precio">Precio</Label>
            {/* type="text" con inputMode="decimal" y no type="number": el
                teclado numérico aparece igual en el celular, pero la coma
                llega sin que el navegador la descarte. El parseo lo hace
                lib/formato/numeros.ts. */}
            <Input id="precio" name="precio" inputMode="decimal" placeholder="15000,50" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sku">Código (opcional)</Label>
            <Input id="sku" name="sku" placeholder="Se genera solo si lo dejás vacío" />
          </div>
          {tipo === 'PRODUCTO' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="stockInicial">Stock inicial (opcional)</Label>
                <Input id="stockInicial" name="stockInicial" inputMode="decimal" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="costoUnitario">Costo unitario (opcional)</Label>
                <Input id="costoUnitario" name="costoUnitario" inputMode="decimal" />
              </div>
            </>
          )}
          <Resultado estado={estado} />
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Creando…' : 'Crear artículo'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Editar. Sólo se monta para un dueño; la action lo reexige igual. */
export function FormularioDeEdicion({
  articuloId,
  nombre,
  sku,
  precio,
}: {
  articuloId: string
  nombre: string
  sku: string
  precio: string
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
