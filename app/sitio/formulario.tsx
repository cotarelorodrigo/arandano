'use client'

import { useActionState, useId } from 'react'
import { ArrowRight } from 'lucide-react'
import { enviarLead, type EstadoLead } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// El estado inicial vive acá y no en acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async. Mismo patrón que login, usuarios,
// inventario y ventas; test/use-server.test.ts lo fija.
const INICIAL: EstadoLead = { error: null, enviado: false }

/**
 * La pantalla de gracias, sin hooks y exportada aparte.
 *
 * Sólo se llega acá después de que `useActionState` transicionó a
 * `enviado: true`, y este repo no tiene jsdom ni testing-library — el único
 * método de render de los tests es `renderToStaticMarkup`, que no puede
 * disparar esa transición. Sin este componente separado, la supresión del
 * link a `wa.me` con `whatsapp` vacío (ruling del controlador, Task 6) no
 * tendría forma de afirmarse: quedaría código que nadie ejercita, y una
 * regresión que volviera a mostrar el link ahí pasaría en verde.
 */
export function PantallaDeGracias({ whatsapp }: { whatsapp: string }) {
  return (
    <div className="space-y-2">
      <p className="font-medium">Listo, lo recibimos.</p>
      <p className="text-sm text-muted-foreground">
        Te escribimos a la brevedad.
        {whatsapp ? (
          <>
            {' '}
            Si querés apurarlo,{' '}
            <a className="text-primary underline" href={`https://wa.me/${whatsapp}`}>
              mandanos un WhatsApp
            </a>
            .
          </>
        ) : null}
      </p>
    </div>
  )
}

type Variante = 'clara' | 'oscura'

/**
 * El formulario de un solo campo — decisión 1 del plan del cierre del
 * rediseño (Task 5). Antes pedía nombre, mail, WhatsApp, rubro y mensaje;
 * ahora pide UN valor ("Tu WhatsApp o tu mail", design/arandano.pen) que
 * `enviarLead` clasifica solo. El motivo no es sólo la maqueta: CLAUDE.md
 * describe un trial de cinco días "con muchos registros que no convierten" —
 * un formulario de cinco campos delante de eso es fricción pura, y "el alta
 * es instantánea" con cinco campos no se sostiene.
 *
 * `variante` porque el MISMO componente vive en dos superficies con
 * tratamiento distinto: 'clara' en el Hero (fondo claro, design/arandano.pen
 * nodo `P2ZVg6`) y 'oscura' en el Cierre (sobre --marca, nodo `zruu5`) — el
 * campo y el contrato con `enviarLead` no cambian, sólo cómo se pinta.
 *
 * `textoBoton` porque el `.pen` pone un texto DISTINTO en cada lugar:
 * "Quiero probarlo" en el Hero, "Empezar" en el Cierre (default de esta
 * prop, porque el Cierre es donde más importa que un consumidor de esta
 * función no se olvide de pasarlo).
 *
 * Los `id` del campo y del honeypot salen de `useId()` y no están escritos a
 * mano (Critical C2 de la review final del cierre): landing.tsx renderiza
 * este componente DOS VECES (Hero y Cierre), y `id="contacto"`/`id="sitio-web"`
 * fijos chocaban con el `id="contacto"` de la propia `<section>` del Cierre —
 * tres elementos con el mismo id en un documento. Los cinco `href="#contacto"`
 * de la landing resuelven al PRIMERO en orden de documento, así que quien leía
 * los precios y apretaba "Probar 5 días" saltaba al input del Hero en vez de
 * bajar al Cierre, y el `<label>` del Cierre quedaba asociado al input
 * equivocado. `useId()` da un id único por instancia sin tocar el contrato con
 * `enviarLead`: `name="contacto"` y `name="sitio-web"` no cambian.
 */
export function Formulario({
  whatsapp,
  textoBoton = 'Empezar',
  variante = 'clara',
}: {
  whatsapp: string
  textoBoton?: string
  variante?: Variante
}) {
  const [estado, accion, enviando] = useActionState(enviarLead, INICIAL)
  const idContacto = useId()
  const idHoneypot = useId()

  if (estado.enviado) {
    return <PantallaDeGracias whatsapp={whatsapp} />
  }

  const oscura = variante === 'oscura'

  return (
    <div className="flex w-full flex-col gap-2">
      {estado.error ? (
        <p
          role="alert"
          className={`text-sm ${oscura ? '' : 'text-destructive'}`}
          style={oscura ? { color: 'var(--marca-soft)' } : undefined}
        >
          {estado.error}
        </p>
      ) : null}

      <form
        action={accion}
        className="flex w-full flex-col gap-2.5 rounded-[14px] border p-[7px] sm:flex-row sm:items-center"
        style={
          oscura
            ? {
                backgroundColor: 'color-mix(in srgb, var(--marca-foreground) 8%, transparent)',
                borderColor: 'color-mix(in srgb, var(--marca-foreground) 15%, transparent)',
              }
            : // 'clara' (Hero): el .pen pinta el marco (nodo P2ZVg6) con
              // $ar-bg y el input (EtDRA) con $ar-surface — divergencia
              // hermana de I5 en la review final. Sin esto, el <Input> de
              // shadcn es bg-transparent y el marco no pintaba nada propio,
              // así que los dos terminaban del mismo color que la página de
              // fondo (antes gris por el bug de arriba, ahora blanco): el
              // campo dejaba de leerse como su propia pieza.
              { backgroundColor: 'var(--background)' }
        }
      >
        <label htmlFor={idContacto} className="sr-only">
          Tu WhatsApp o tu mail
        </label>
        <Input
          id={idContacto}
          name="contacto"
          required
          maxLength={200}
          placeholder="Tu WhatsApp o tu mail"
          autoComplete="off"
          className="h-[46px] flex-1 rounded-[10px] px-3.5"
          style={{ backgroundColor: oscura ? 'var(--marca-foreground)' : 'var(--card)' }}
        />

        {/* El honeypot. Escondido con posición absoluta y no con display:none
            ni hidden: varios bots saltean los campos ocultos por CSS obvio y
            completan el resto. tabIndex y aria-hidden lo sacan del camino de
            quien navega con teclado o con lector de pantalla — si una persona
            lo completa, su lead se pierde en silencio, que es la peor falla
            posible de esta pantalla. */}
        <div className="absolute top-0 left-[-9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
          <label htmlFor={idHoneypot}>No completar</label>
          <input id={idHoneypot} name="sitio-web" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {oscura ? (
          // Botón marca-soft/marca-deep, NO el par "on-primary" de un botón de
          // acción normal (ese nombre de token sólo puede aparecer adentro de
          // components/ui/): sobre la banda --marca, --primary compite mal con
          // el fondo — el .pen elige el par de texto propio de esta superficie.
          <button
            type="submit"
            disabled={enviando}
            className="flex h-[46px] items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-bold disabled:opacity-60"
            style={{ backgroundColor: 'var(--marca-soft)', color: 'var(--marca)' }}
          >
            {enviando ? 'Enviando...' : textoBoton}
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <Button type="submit" disabled={enviando} className="h-[46px] gap-2 rounded-[10px] px-5">
            {enviando ? 'Enviando...' : textoBoton}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        )}
      </form>

      {/* La salida directa por WhatsApp. El `.pen` no la dibuja adentro del
          Lead en reposo —ni en Hero ni en Cierre—, pero es una capacidad
          real que ya existía antes de este ciclo (ruling del controlador,
          Task 6 del ciclo anterior: sin número real, un wa.me vacío
          mandaría a la nada) y el silencio de una maqueta estática sobre un
          link auxiliar no es instrucción de sacarlo — ver el criterio de
          lectura del .pen en CLAUDE.md ("qué pierde el producto si se
          saca"). Sigue mostrándose sólo con `whatsapp` presente. */}
      {whatsapp ? (
        <p className="text-center text-xs" style={{ color: oscura ? 'var(--marca-dim)' : undefined }}>
          <span className={oscura ? undefined : 'text-muted-foreground'}>o escribinos por </span>
          <a
            className="underline"
            style={{ color: oscura ? 'var(--marca-soft)' : 'var(--primary)' }}
            href={`https://wa.me/${whatsapp}`}
          >
            WhatsApp
          </a>
        </p>
      ) : null}
    </div>
  )
}
