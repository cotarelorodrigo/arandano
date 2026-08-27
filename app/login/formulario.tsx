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
        className="h-[50px] rounded-[11px] pr-9 pl-[11px] lg:h-11 lg:rounded-[9px]"
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
export function FormularioLogin({ dominio }: { dominio: string }) {
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

  // Minor 11 de la review final, consultado en vivo (nodos wxmdz/r70Sp/PK27T/
  // frBAX/vXQs2): la Caja mide 360px fijos, no max-w-sm (384); el gap del
  // Título es 5, no 4 (gap-1); el de Campos es 14, no 16 (gap-4); y cada
  // campo individual (Mail, Contraseña) es 5, no 8 (gap-2). El gap de la Caja
  // en sí (20, gap-5) ya estaba bien y no se toca.
  //
  // Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Login`,
  // `Kp4Eg`): mobile-first en TODO lo de acá abajo. El `<form>` pasa de los
  // 360px fijos de siempre a `w-full` (nodo `TyIWX`, fill_container) y su gap
  // externo de 20 (gap-5) a 18; los dos `<Input>` y el botón "Entrar" crecen
  // (50px/r11 y 52px/r12 respectivamente, contra 44px/r9 y 48px/r11 de
  // escritorio); y el pie con el dominio del tenant —que en escritorio vive
  // dentro del paño (ver page.tsx)— se muda ACÁ, empujado al fondo por un
  // espaciador `flex-1` (nodo `i4g4a`), visible sólo en el teléfono
  // (`lg:hidden`): nunca desaparece sin más, sólo cambia de casa según el
  // ancho.
  return (
    <form action={accion} className="flex w-full flex-col gap-[18px] lg:w-[360px] lg:gap-5">
      <div className="flex flex-col gap-[5px]">
        <h1 className={estilos.tituloEntrar}>Entrar</h1>
        <p className="text-[13px] text-muted-foreground">Usuario y contraseña del local.</p>
      </div>

      <div className="flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[5px]">
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
            className="h-[50px] rounded-[11px] px-[11px] lg:h-11 lg:rounded-[9px]"
          />
        </div>
        <div className="flex flex-col gap-[5px]">
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
        className="h-[52px] gap-2 rounded-[12px] px-[15px] lg:h-12 lg:gap-[7px] lg:rounded-[11px]"
      >
        {pendiente ? (
          'Entrando…'
        ) : (
          <>
            <ArrowRight aria-hidden="true" className="size-[17px] lg:size-[15px]" />
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

      {/* El espaciador y el pie del teléfono (nodos `i4g4a`/`eY0BS`): existen
          SÓLO abajo de 1024px. En escritorio el pie real vive dentro del
          paño, con los colores de marca (ver page.tsx) — acá, sobre el fondo
          claro del formulario, usa los tokens de tinta (`--foreground-soft`/
          `--muted-foreground`), no los de marca. */}
      <div className="flex-1 lg:hidden" aria-hidden="true" />
      <div className="flex flex-col gap-1 lg:hidden">
        <p className="text-[12px] font-semibold text-foreground-soft">{dominio}</p>
        <p className="text-[11px] text-muted-foreground">Cada local entra por su propia dirección.</p>
      </div>
    </form>
  )
}
