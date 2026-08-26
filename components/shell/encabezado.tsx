import { ArrowLeft } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SidebarTrigger } from '@/components/ui/sidebar'
import estilos from './encabezado.module.css'

/**
 * La ranura derecha "de un solo toque" que design/arandano.pen dibuja en la
 * esquina de `Móvil/Topbar` (nodo `NlGrn`, 38×38, radio 10, ícono 19). No es
 * lo mismo que `acciones`: eso sigue existiendo para escritorio y puede traer
 * cualquier cosa (un botón, dos, un menú); esto es SIEMPRE un solo link a un
 * `href`, porque en 38 px no entra más que un ícono.
 *
 * `tono` no es decorativo — la maqueta lo usa con un criterio: 'accion' (el
 * default, relleno de `--primary`) cuando el botón CREA algo (`plus` en
 * /inventario, `user-plus` en /usuarios); 'suave' (relleno de `--muted`)
 * cuando es secundario o abre un menú (`more-vertical` en /vender).
 */
export type AccionMovil = {
  icono: LucideIcon
  etiqueta: string
  href: string
  tono?: 'accion' | 'suave'
}

/**
 * La franja que abre cada una de las diez pantallas de escritorio, y —desde
 * el ciclo del shell móvil— también los doce frames `Móvil / …` del .pen.
 *
 * La geometría sale de dos frames: el Topbar de escritorio (66 px de alto,
 * `padding [0,28]`) y `Móvil/Topbar` (`kyXe1`: 56 px, `padding [0,12]`,
 * `gap 10`). Es el mismo componente para las dos porque las dos son "la misma
 * franja, dos maquetas" — un padding distinto en una pantalla se ve como un
 * salto al navegar entre ellas, y eso vale tanto en escritorio como en
 * teléfono. Mobile-first: el valor sin prefijo es el del teléfono, `lg:` el
 * de escritorio (hooks/use-mobile.ts explica por qué el corte es 1024).
 *
 * El <h1> paga Archivo (encabezado.module.css) porque el nodo Título > H1 del
 * Topbar lo pide en el .pen — no la pila del sistema que documentaba antes
 * docs/sistema-de-diseno.md, corregido en el mismo ciclo que este componente.
 * El subtítulo se queda en la pila del sistema: el nodo Sub del mismo frame
 * pide $ar-font, no $ar-display.
 *
 * Renderiza EL <h1> de la pantalla. La que lo use no puede tener otro.
 */
export function Encabezado({
  titulo,
  subtitulo,
  acciones,
  atras,
  accionMovil,
}: {
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  acciones?: React.ReactNode
  atras?: string
  accionMovil?: AccionMovil
}) {
  const tono = accionMovil?.tono ?? 'accion'

  return (
    // h-14 lg:h-[66px], px-4 lg:px-7: 56/66 px de alto y 16/28 px de padding
    // horizontal, teléfono/escritorio. gap-4 (16px) queda igual que siempre
    // —el .pen del teléfono pide gap 10, pero nada en este ciclo lo pide
    // cambiar, y con min-w-0 flex-1 en el bloque de título ese número sólo
    // fija el mínimo entre ítems, no la posición: el título igual se estira
    // hasta pegar contra la ranura derecha—.
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card px-4 lg:h-[66px] lg:px-7">
      {/* Ranura izquierda (design/arandano.pen, kyXe1 > f9BjR): 38×38, radio
          10, sin relleno, ícono 21. Sólo existe en el teléfono —lg:hidden en
          las dos variantes—, porque en escritorio no hay ningún ícono acá
          (antes de este ciclo el trigger vivía suelto en
          app/(app)/layout.tsx, también oculto en desktop con el mismo
          criterio, sólo que contra el breakpoint viejo).
          Sin `atras`: abre el drawer con el trigger de shadcn. Con `atras`:
          vuelve a la pantalla anterior — nunca las dos a la vez, porque una
          pantalla de detalle no necesita volver a abrir el menú. */}
      {atras ? (
        <a
          href={atras}
          aria-label="Volver"
          className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px] lg:hidden"
        >
          <ArrowLeft aria-hidden="true" className="size-[21px]" />
        </a>
      ) : (
        <SidebarTrigger className="lg:hidden" />
      )}

      {/* min-w-0 flex-1: en vez de justify-between en el <header> (que con
          una ranura izquierda de más ya no alcanza para tres bloques),
          este bloque se estira y absorbe todo el ancho libre — el mismo
          resultado visual, pero que sigue funcionando con uno, dos o tres
          hermanos en flujo según el breakpoint y las props. flex-col gap-px:
          el frame Título del .pen es layout vertical con gap:1. */}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <h1 className={`${estilos.titulo} truncate text-foreground`}>{titulo}</h1>
        {/* Condicional y no un <p> siempre presente: sin subtítulo, un párrafo
            vacío corre el título hacia arriba y la franja deja de leerse
            centrada. */}
        {subtitulo ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitulo}</p>
        ) : null}
      </div>

      {/* gap-2.5 (10px): el frame Acciones/Estado del .pen, igual en las diez
          pantallas de escritorio. hidden lg:flex: en el teléfono este slot no
          existe — ahí manda `accionMovil`, un solo botón en vez de "lo que
          sea que traiga `acciones`". */}
      {acciones ? (
        <div className="hidden shrink-0 items-center gap-2.5 lg:flex">{acciones}</div>
      ) : null}

      {/* Ranura derecha del teléfono (design/arandano.pen, kyXe1 > NlGrn):
          38×38, radio 10, ícono 19. lg:hidden: en escritorio manda
          `acciones`, no esto. */}
      {accionMovil ? (
        <a
          href={accionMovil.href}
          aria-label={accionMovil.etiqueta}
          className={`flex size-[38px] shrink-0 items-center justify-center rounded-[10px] lg:hidden ${
            tono === 'suave' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground'
          }`}
        >
          <accionMovil.icono aria-hidden="true" className="size-[19px]" />
        </a>
      ) : null}
    </header>
  )
}
