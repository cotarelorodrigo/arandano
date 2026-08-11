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
