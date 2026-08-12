'use client'

import { useActionState, useEffect, useRef } from 'react'
import { entrar, type EstadoLogin } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const INICIAL: EstadoLogin = { error: null }

/**
 * El formulario, sin Card.
 *
 * La tenía y se sacó: el paño de la persiana ya es el marco de la pantalla, y
 * una card adentro de un layout partido es un borde alrededor de nada. El
 * nombre del local vive ahora en el <h1> de la página (app/login/page.tsx),
 * que es donde le corresponde — era el título de la pantalla desde el
 * principio, puesto en un CardTitle.
 */
export function FormularioLogin() {
  const [estado, accion, pendiente] = useActionState(entrar, INICIAL)
  const clave = useRef<HTMLInputElement>(null)

  // Tras un error, el foco va a la contraseña y no al mail: el mail ya volvió
  // escrito (estado.email) y la contraseña es el único campo que hay que
  // rehacer. Es la misma razón por la que el mail arranca con autoFocus — acá
  // se entra tipeando, sin tocar el mouse, y dejar el foco en el campo que ya
  // está bien obliga a un Tab que nadie debería tener que dar.
  useEffect(() => {
    if (estado.error) clave.current?.focus()
  }, [estado])

  return (
    <form action={accion} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Mail</Label>
        {/* autoFocus: en un mostrador se entra tipeando, sin tocar el mouse.
            defaultValue y no value: el campo sigue siendo no controlado, y lo
            que hace que el mail sobreviva a un error es que React, al resetear
            el formulario cuando la action termina, lo restaura a ESTE valor —
            que para entonces ya es el que la action devolvió. */}
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          defaultValue={estado.email ?? ''}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="clave">Contraseña</Label>
        <Input
          id="clave"
          name="clave"
          type="password"
          autoComplete="current-password"
          required
          ref={clave}
        />
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
  )
}
