'use client'

import { useActionState } from 'react'
import { entrar, type EstadoLogin } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const INICIAL: EstadoLogin = { error: null }

export function FormularioLogin({ nombreDelLocal }: { nombreDelLocal: string }) {
  const [estado, accion, pendiente] = useActionState(entrar, INICIAL)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        {/* El testid lo consume scripts/smoke.sh para verificar que el
            subdominio resolvió al tenant correcto. Si se saca de acá, hay que
            mover ese caso del gate en el mismo commit. */}
        <CardTitle data-testid="tenant-nombre">{nombreDelLocal}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Mail</Label>
            {/* autoFocus: en un mostrador se entra tipeando, sin tocar el mouse. */}
            <Input id="email" name="email" type="email" autoComplete="username" autoFocus required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="clave">Contraseña</Label>
            <Input id="clave" name="clave" type="password" autoComplete="current-password" required />
          </div>

          {estado.error && (
            <Alert variant="destructive">
              <AlertDescription>{estado.error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
