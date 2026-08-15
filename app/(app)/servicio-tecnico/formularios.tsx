'use client'

import { useActionState, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { EstadoServicio } from './acciones'
// El tipo del enum, no `string`: así el compilador atrapa que la pantalla le
// pase un estado que no existe, en vez de que lo descubra el server action en
// runtime. Es un import de tipo, así que no arrastra nada al bundle del cliente.
import type { EstadoOrden } from '@/generated/prisma/client'

// Vive acá y no en acciones.ts: ese archivo es 'use server' y no puede exportar
// constantes. Ver el comentario allá y test/use-server.test.ts.
export const INICIAL: EstadoServicio = { error: null, aviso: null }

export function Aviso({ estado }: { estado: EstadoServicio }) {
  if (!estado.error && !estado.aviso) return null
  return (
    <Alert variant={estado.error ? 'destructive' : 'default'} className="mt-4">
      <AlertDescription>{estado.error ?? estado.aviso}</AlertDescription>
    </Alert>
  )
}

export function FormularioRecepcion({
  accion,
  clientes,
  claveIdempotencia,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  clientes: { id: string; nombre: string; telefono: string | null }[]
  claveIdempotencia: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  return (
    <form action={ejecutar} className="mt-6 space-y-6">
      {/* La generó el servidor una vez por carga de la pantalla: es lo que hace
          que el doble click no imprima dos tickets con números distintos para
          un solo equipo. */}
      <input type="hidden" name="claveIdempotencia" value={claveIdempotencia} />

      <fieldset className="space-y-3">
        <legend className="font-medium">Cliente</legend>
        <Label htmlFor={`${id}-cliente`}>Elegir uno ya cargado</Label>
        <select
          id={`${id}-cliente`}
          name="clienteId"
          defaultValue=""
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        >
          <option value="">— cliente nuevo —</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.telefono ? ` · ${c.telefono}` : ''}
            </option>
          ))}
        </select>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-nombre`}>Nombre (si es nuevo)</Label>
            <Input id={`${id}-nombre`} name="clienteNombre" />
          </div>
          <div>
            <Label htmlFor={`${id}-tel`}>Teléfono</Label>
            <Input id={`${id}-tel`} name="clienteTelefono" inputMode="tel" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-medium">El equipo</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-marca`}>Marca</Label>
            <Input id={`${id}-marca`} name="equipoMarca" required />
          </div>
          <div>
            <Label htmlFor={`${id}-modelo`}>Modelo</Label>
            <Input id={`${id}-modelo`} name="equipoModelo" required />
          </div>
          <div>
            <Label htmlFor={`${id}-serie`}>IMEI o número de serie</Label>
            <Input id={`${id}-serie`} name="equipoSerie" />
          </div>
          <div>
            <Label htmlFor={`${id}-clave`}>Clave de desbloqueo</Label>
            <Input id={`${id}-clave`} name="claveDesbloqueo" />
            {/* Se dice en la pantalla y no sólo en el spec: quien la tipea
                tiene que saber que no va a salir en el papel. */}
            <p className="mt-1 text-xs text-muted-foreground">No se imprime en el ticket.</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-medium">Qué le pasa</legend>
        <div>
          <Label htmlFor={`${id}-falla`}>Falla declarada por el cliente</Label>
          <textarea
            id={`${id}-falla`}
            name="fallaDeclarada"
            required
            rows={3}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-acc`}>Accesorios entregados</Label>
            <Input id={`${id}-acc`} name="accesorios" placeholder="cargador, funda, chip" />
          </div>
          <div>
            <Label htmlFor={`${id}-danos`}>Daños visibles</Label>
            <Input id={`${id}-danos`} name="danosVisibles" placeholder="pantalla rayada" />
          </div>
        </div>
      </fieldset>

      <Aviso estado={estado} />

      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Recibir e imprimir'}
      </Button>
    </form>
  )
}

export function FormularioEstado({
  accion,
  ordenId,
  siguientes,
  nombres,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  siguientes: readonly EstadoOrden[]
  nombres: Record<EstadoOrden, string>
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  if (siguientes.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta orden no se puede mover más.</p>
  }

  return (
    <form action={ejecutar} className="space-y-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <Label htmlFor={`${id}-nota`}>Nota (opcional)</Label>
        <Input id={`${id}-nota`} name="nota" placeholder="qué pasó" />
      </div>
      {/* Un botón por transición LEGAL, y el valor viaja en el botón: así no
          hay un desplegable donde se pueda elegir un salto que el servidor va
          a rechazar. El servidor lo revalida igual. */}
      <div className="flex flex-wrap gap-2">
        {siguientes.map((s) => (
          <Button key={s} type="submit" name="hasta" value={s} variant="secondary" disabled={pendiente}>
            {nombres[s]}
          </Button>
        ))}
      </div>
      <Aviso estado={estado} />
    </form>
  )
}

export function FormularioDiagnostico({
  accion,
  ordenId,
  diagnostico,
  montoEstimado,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  diagnostico: string
  montoEstimado: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  return (
    <form action={ejecutar} className="space-y-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <Label htmlFor={`${id}-diag`}>Diagnóstico</Label>
        <textarea
          id={`${id}-diag`}
          name="diagnostico"
          rows={3}
          defaultValue={diagnostico}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div>
        <Label htmlFor={`${id}-monto`}>Monto estimado</Label>
        <Input id={`${id}-monto`} name="montoEstimado" inputMode="decimal" defaultValue={montoEstimado} />
      </div>
      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar diagnóstico'}
      </Button>
      <Aviso estado={estado} />
    </form>
  )
}

export function FormularioAnular({
  accion,
  ordenId,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  return (
    <form action={ejecutar}>
      <input type="hidden" name="ordenId" value={ordenId} />
      <Button type="submit" variant="ghost" disabled={pendiente}>
        Anular esta orden
      </Button>
      <Aviso estado={estado} />
    </form>
  )
}
