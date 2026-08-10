'use client'

import { useActionState } from 'react'
import { altaEmpleado, nuevaClave, baja, alta, INICIAL, type EstadoUsuarios } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** El aviso lleva la contraseña en texto plano y es el único momento en que
 *  existe: el dueño la tiene que copiar y pasársela a la persona. */
function Resultado({ estado }: { estado: EstadoUsuarios }) {
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

export function AltaDeEmpleado() {
  const [estado, accion, pendiente] = useActionState(altaEmpleado, INICIAL)

  return (
    <Card className="mt-8 max-w-md">
      <CardHeader>
        <CardTitle>Agregar a alguien</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Sin reset manual: desde React 19, un <form action={...}> resetea
            los campos no controlados por su cuenta cuando la action termina
            bien, así que la contraseña recién mostrada en el Alert de abajo
            no queda pegada en el campo. */}
        <form action={accion} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" name="nombre" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Mail</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="clave">Contraseña inicial</Label>
            {/* minLength 8 acompaña al chequeo del servidor, no lo reemplaza:
                la validación del navegador se saltea con dos clicks. */}
            <Input id="clave" name="clave" type="text" minLength={8} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rol">Rol</Label>
            <select id="rol" name="rol" className="h-9 rounded-md border px-3 text-sm">
              <option value="EMPLEADO">Empleado</option>
              <option value="DUENO">Dueño</option>
            </select>
          </div>
          <Resultado estado={estado} />
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Creando…' : 'Crear'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function AccionesDeUsuario({
  usuarioId,
  desactivado,
  esUnoMismo,
}: {
  usuarioId: string
  desactivado: boolean
  esUnoMismo: boolean
}) {
  const [estadoClave, accionClave, claveEnCurso] = useActionState(nuevaClave, INICIAL)
  const [estadoEstado, accionEstado, estadoEnCurso] = useActionState(
    desactivado ? alta : baja,
    INICIAL,
  )

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* Mismo reset automático que en AltaDeEmpleado: el campo se vacía solo
          cuando accionClave termina bien, después de mostrar la clave en el
          Alert de abajo. */}
      <form action={accionClave} className="flex items-center gap-2">
        <input type="hidden" name="usuarioId" value={usuarioId} />
        <Input name="clave" type="text" minLength={8} required placeholder="Nueva contraseña" />
        <Button type="submit" variant="outline" disabled={claveEnCurso}>
          Cambiar
        </Button>
      </form>

      {/* Desactivarse a uno mismo no se ofrece: la regla del último dueño ya lo
          impediría en el servidor, pero un botón que siempre falla es peor que
          ningún botón. */}
      {!esUnoMismo && (
        <form action={accionEstado}>
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <Button type="submit" variant="outline" disabled={estadoEnCurso}>
            {desactivado ? 'Reactivar' : 'Desactivar'}
          </Button>
        </form>
      )}

      <Resultado estado={estadoClave} />
      <Resultado estado={estadoEstado} />
    </div>
  )
}
