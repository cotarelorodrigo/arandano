'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, ArrowRight } from 'lucide-react'
import { entrar, type EstadoLogin } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import estilos from './persiana.module.css'

const INICIAL: EstadoLogin = { error: null }

/**
 * El tipo del campo de contraseña según si se está mostrando: función pura y
 * exportada por el mismo motivo que `pasoDeCantidad` en
 * `app/(app)/vender/punto-de-venta.tsx` — este harness usa
 * `renderToStaticMarkup` (ver vitest.config.mts, `environment: 'node'`), que
 * no ejecuta el click del ojo, así que la única forma de probar la
 * ALTERNANCIA de verdad es aislar la regla de la interacción que la dispara.
 */
export function tipoDelCampoClave(mostrar: boolean): 'text' | 'password' {
  return mostrar ? 'text' : 'password'
}

/**
 * El campo de contraseña con el "ojo" de mostrar/ocultar (design/arandano.pen,
 * nodo `a7k6QJ`, ícono `eye`): presentacional y sin su propio estado, para que
 * un test pueda renderizar los DOS casos (mostrando/ocultando) pasando
 * `mostrar` directo — sin eso, sólo se podría ver el estado INICIAL (el click
 * no se puede simular sin jsdom).
 *
 * Mismo patrón que `ScanBarcode` dentro de la barra de búsqueda de
 * `punto-de-venta.tsx`: un `<button>` con un ícono de lucide DENTRO del
 * `<Input>`, sin sumar ningún componente de shadcn nuevo.
 */
export function CampoClave({
  mostrar,
  onAlternar,
  inputRef,
}: {
  mostrar: boolean
  onAlternar: () => void
  inputRef: React.Ref<HTMLInputElement>
}) {
  const Icono = mostrar ? EyeOff : Eye
  return (
    <div className="relative">
      <Input
        id="clave"
        name="clave"
        type={tipoDelCampoClave(mostrar)}
        autoComplete="current-password"
        required
        ref={inputRef}
        className="h-11 rounded-[9px] pr-9 pl-[11px]"
      />
      <button
        type="button"
        onClick={onAlternar}
        // aria-label y no texto visible: el ícono ya lo dice, y un texto acá
        // competiría por espacio adentro del campo. aria-pressed refleja el
        // estado para quien usa lector de pantalla, igual que un checkbox.
        aria-label={mostrar ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
        aria-pressed={mostrar}
        className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
      >
        <Icono aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

/**
 * El formulario, sin Card.
 *
 * La tenía y se sacó: el paño de la persiana ya es el marco de la pantalla, y
 * una card adentro de un layout partido es un borde alrededor de nada. El
 * nombre del local vive ahora en el <h1> de la página (app/login/page.tsx),
 * que es donde le corresponde — era el título de la pantalla desde el
 * principio, puesto en un CardTitle.
 *
 * **El H1 "Entrar" que suma este ciclo NO es esa Card de vuelta**
 * (design/arandano.pen, nodo `M6mNY`): aquélla repetía el NOMBRE DEL LOCAL
 * adentro del panel del formulario, redundante con el `<h1>` del paño. Éste
 * dice "Entrar" — un rótulo del formulario en sí, con su propio subtítulo
 * ("Usuario y contraseña del local."), no una segunda copia del nombre. Sigue
 * sin haber ningún `<Card>` de shadcn acá.
 */
export function FormularioLogin() {
  const [estado, accion, pendiente] = useActionState(entrar, INICIAL)
  const clave = useRef<HTMLInputElement>(null)
  const [mostrarClave, setMostrarClave] = useState(false)

  // Tras un error, el foco va a la contraseña y no al mail: el mail ya volvió
  // escrito (estado.email) y la contraseña es el único campo que hay que
  // rehacer. Es la misma razón por la que el mail arranca con autoFocus — acá
  // se entra tipeando, sin tocar el mouse, y dejar el foco en el campo que ya
  // está bien obliga a un Tab que nadie debería tener que dar.
  useEffect(() => {
    if (estado.error) clave.current?.focus()
  }, [estado])

  return (
    <form action={accion} className="flex w-full max-w-sm flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className={estilos.tituloEntrar}>Entrar</h1>
        <p className="text-[13px] text-muted-foreground">Usuario y contraseña del local.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-[11px] font-semibold text-foreground-soft">
            Mail
          </Label>
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
            placeholder="flor@celularesflor.com.ar"
            defaultValue={estado.email ?? ''}
            className="h-11 rounded-[9px] px-[11px]"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="clave" className="text-[11px] font-semibold text-foreground-soft">
            Contraseña
          </Label>
          <CampoClave
            mostrar={mostrarClave}
            onAlternar={() => setMostrarClave((m) => !m)}
            inputRef={clave}
          />
        </div>
      </div>

      {estado.error && (
        <Alert variant="destructive">
          <AlertDescription>{estado.error}</AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        disabled={pendiente}
        className="h-12 gap-[7px] rounded-[11px] px-[15px]"
      >
        {pendiente ? (
          'Entrando…'
        ) : (
          <>
            <ArrowRight aria-hidden="true" className="size-[15px]" />
            Entrar
          </>
        )}
      </Button>

      {/* La ayuda sobre la contraseña olvidada (design/arandano.pen, nodo
          `rA9aY`): dice la verdad del producto y no promete lo que no existe
          — no hay proveedor de mail acá (ver CLAUDE.md, tabla de stack), así
          que "te mandamos un mail" sería mentira. Quien resetea es el dueño,
          desde /usuarios. */}
      <p className="text-center text-[11px] leading-[1.5] text-muted-foreground">
        ¿Olvidaste la contraseña? Te la resetea el dueño del local desde Usuarios. No mandamos
        mails de recupero.
      </p>
    </form>
  )
}
