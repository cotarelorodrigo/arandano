'use client'

import { useActionState, useId } from 'react'
import { ArrowRight } from 'lucide-react'
import { enviarLead, type EstadoLead } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import estilos from './formulario.module.css'

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
 * UN SOLO TEXTO DE BOTÓN, desde el rediseño de la landing. El `.pen` ponía uno
 * distinto en cada lugar ("Quiero probarlo" en el Hero, "Empezar" en el
 * Cierre) y este componente lo recibía por prop. La página terminaba con tres
 * verbos para una acción sola —más "Probar 5 días" en el Nav y en los planes—,
 * y una interfaz que llama distinto a lo mismo obliga a la persona a
 * averiguar si son lo mismo. Ahora los links que NAVEGAN dicen "Probar 5
 * días" y el botón que ENVÍA dice "Que me escriban", que es exactamente lo que
 * pasa al apretarlo: dejás tu contacto y alguien te escribe. La prop se fue
 * para que no se pueda volver a divergir por descuido.
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
/** Lo que dice el botón que envía. Ver el docblock: uno solo para las dos
 *  instancias, a propósito. */
const TEXTO_DEL_BOTON = 'Que me escriban'

export function Formulario({
  whatsapp,
  variante = 'clara',
}: {
  whatsapp: string
  variante?: Variante
}) {
  const [estado, accion, enviando] = useActionState(enviarLead, INICIAL)
  const idContacto = useId()
  const idHoneypot = useId()

  if (estado.enviado) {
    return <PantallaDeGracias whatsapp={whatsapp} />
  }

  const oscura = variante === 'oscura'
  // 46px en el Hero (nodos EtDRA/HfYKR), 48px en el Cierre (nodos
  // V9xSVB/sUETx) — Minor 10 de la review final: el código tenía 46 en los
  // dos. Eso sigue siendo la medida DE ESCRITORIO: Task 11 del ciclo móvil
  // suma 50px como piso mobile-first (nodos Wc1DB/MJENr en el Hero,
  // YBpWb/myteL en el Cierre, frame `Móvil / Sitio · Landing`) — las dos
  // variantes miden lo mismo en el teléfono y sólo se separan desde `lg:`.
  const altura = oscura ? 'h-[50px] lg:h-[48px]' : 'h-[50px] lg:h-[46px]'

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
        // `lg:flex-wrap` + el piso del input: el botón es `shrink-0` y el
        // `Input` de shadcn trae `min-w-0`, así que cuando la fila no entra
        // el recorte se lo come entero el campo — medido en 38px de ancho,
        // sin lugar ni para el placeholder. Con wrap, el botón se va abajo en
        // vez de aplastar el campo.
        //
        // Task 11 del ciclo móvil migró este breakpoint de `sm:` a `lg:`: el
        // corte de este ciclo es 1024 y sólo 1024 (CLAUDE.md). Abajo de eso
        // el campo y el botón van apilados siempre (design/arandano.pen,
        // frame `Móvil / Sitio · Landing`, nodo `M5JB1W`/`HQHDT`: el "Lead"
        // del Hero y el "Formulario" del Cierre son columnas de gap 9, sin
        // fila intermedia) — antes, con `sm:`, una ventana de escritorio a
        // medio abrir (>640px) ya los ponía en fila, que es exactamente lo
        // que el ciclo quiere evitar entre 768 y 1023.
        // El marco (borde + fondo + padding + radio) es sólo de escritorio
        // (app/sitio/formulario.module.css lo explica a fondo): en el
        // teléfono el .pen dibuja el Input y el Botón como dos cajas
        // sueltas, sin marco compartido — por eso el color y la geometría
        // del marco viven en el CSS Module (`estilos.marcoClara`/
        // `estilos.marcoOscura`), NO en `style` inline: un inline no puede
        // quedar detrás de una media query.
        className={`flex w-full flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center ${
          oscura ? estilos.marcoOscura : estilos.marcoClara
        }`}
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
          className={`${altura} min-w-[8rem] flex-1 rounded-[10px] px-3.5`}
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
            className={`flex ${altura} items-center justify-center gap-2 rounded-[10px] px-5 text-sm font-bold disabled:opacity-60`}
            style={{ backgroundColor: 'var(--marca-soft)', color: 'var(--marca)' }}
          >
            {enviando ? 'Enviando...' : TEXTO_DEL_BOTON}
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <Button type="submit" disabled={enviando} className={`${altura} gap-2 rounded-[10px] px-5`}>
            {enviando ? 'Enviando...' : TEXTO_DEL_BOTON}
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
