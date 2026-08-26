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
 * La caja de una ranura del teléfono: 38×38, radio 10, y sólo visible abajo de
 * `lg` (`f9BjR`/`NlGrn` del frame `Móvil/Topbar`).
 *
 * Exportada porque `menuMovil` (más abajo) recibe un nodo YA armado por quien
 * lo usa —un menú es un control con estado propio, no algo que este
 * componente pueda fabricar—, y ese nodo tiene que medir lo mismo que el link
 * de `accionMovil` o las dos pantallas quedarían con ranuras de distinto
 * tamaño. Un solo string es lo que impide que se desalineen sin que nadie lo
 * note; el mismo criterio que `CLASES_MINI_FORM` en app/(app)/vender/caja.tsx.
 */
export const CLASES_RANURA_MOVIL =
  'flex size-[38px] shrink-0 items-center justify-center rounded-[10px] lg:hidden'

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
  alVolver,
  accionMovil,
  menuMovil,
}: {
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  acciones?: React.ReactNode
  atras?: string
  /**
   * La misma flecha que `atras`, pero como `<button>`: para las pantallas
   * donde "volver" NO es navegar a otra URL sino retroceder un paso adentro de
   * la misma pantalla. Existe por /vender y su paso de cobro
   * (app/(app)/vender/paso.ts): ahí un `href` a /vender dispararía una
   * navegación de Next, el server component volvería a renderizar y
   * `PuntoDeVenta` se remontaría con el carrito de la venta en curso adentro
   * — que es exactamente lo que ese archivo entero existe para evitar.
   *
   * Pasar una función como prop es legal acá porque quien la pasa es un
   * componente CLIENTE (`PuntoDeVenta`), no un server component: lo que Next
   * prohíbe es cruzar la frontera servidor→cliente con una función, no que un
   * cliente le pase un handler a otro.
   */
  alVolver?: () => void
  accionMovil?: AccionMovil
  /**
   * La ranura derecha del teléfono cuando lo que va ahí NO es un link sino un
   * control con estado propio — hoy, el menú `more-vertical` de /vender, que
   * abre y cierra el turno de caja. Se recibe ya armado en vez de volver
   * `accionMovil` una unión de dos formas; la geometría la comparte
   * `CLASES_RANURA_MOVIL`, que quien lo arma tiene que aplicarle.
   *
   * Excluyente con `accionMovil`: las dos ocupan el mismo lugar.
   */
  menuMovil?: React.ReactNode
}) {
  const tono = accionMovil?.tono ?? 'accion'

  return (
    // h-14 lg:h-[66px], px-3 lg:px-7: 56/66 px de alto y 12/28 px de padding
    // horizontal, teléfono/escritorio — mismo mapeo que ya usaba el
    // escritorio (padding [0,28] -> px-7): kyXe1 declara "padding":[0,12], y
    // px-3 son esos 12px, no px-4 (16px, un error de la ronda anterior:
    // llevaba la prosa del brief en vez de la geometría del propio frame).
    // gap-2.5 lg:gap-4: mismo trato para el gap entre las ranuras — kyXe1
    // declara "gap":10 (gap-2.5) y el Topbar de escritorio 16 (gap-4, el de
    // siempre). Los dos números conviven porque son geometría de dos
    // maquetas distintas, no uno que "no cambió".
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-card px-3 lg:h-[66px] lg:gap-4 lg:px-7">
      {/* Ranura izquierda (design/arandano.pen, kyXe1 > f9BjR): 38×38, radio
          10, sin relleno, ícono 21. Sólo existe en el teléfono —lg:hidden en
          las dos variantes—, porque en escritorio no hay ningún ícono acá
          (antes de este ciclo el trigger vivía suelto en
          app/(app)/layout.tsx, también oculto en desktop con el mismo
          criterio, sólo que contra el breakpoint viejo).
          Sin `atras` ni `alVolver`: abre el drawer con el trigger de shadcn.
          Con cualquiera de los dos: vuelve — nunca las dos a la vez, porque
          una pantalla de detalle no necesita volver a abrir el menú.
          `atras` navega a otra URL; `alVolver` retrocede un paso adentro de la
          misma pantalla (ver su comentario en las props). */}
      {atras ? (
        <a href={atras} aria-label="Volver" className={CLASES_RANURA_MOVIL}>
          <ArrowLeft aria-hidden="true" className="size-[21px]" />
        </a>
      ) : alVolver ? (
        <button type="button" onClick={alVolver} aria-label="Volver" className={CLASES_RANURA_MOVIL}>
          <ArrowLeft aria-hidden="true" className="size-[21px]" />
        </button>
      ) : (
        // SidebarTrigger trae de shadcn su propia caja (size-7, 28px) y su
        // propio ícono (PanelLeftIcon, 16px vía [&_svg:not([class*='size-'])]:
        // size-4 en components/ui/button.tsx) — ninguno de los dos es el
        // 38×38/ícono-21 que pide f9BjR, la misma geometría que la variante
        // `atras` de acá arriba SÍ cumple. La caja se pisa sola: cn()
        // (twMerge) reconoce size-[38px] y size-7 como la misma "familia" de
        // utilidad y descarta la de shadcn. El ícono no: [&_svg]:size-[21px]
        // es un selector arbitrario DISTINTO del que trae la base
        // ([&_svg:not(...)]:size-4), así que twMerge no los funde y los dos
        // conviven en el HTML — pero como el de acá lleva `!` (important) y
        // el de la base no, el de acá gana en el navegador sin importar la
        // especificidad más alta que le da el :not(). Mismo mecanismo que ya
        // resolvió exactamente este problema en
        // app/(app)/servicio-tecnico/chip-estado.tsx (ver su comentario).
        <SidebarTrigger className="size-[38px] rounded-[10px] lg:hidden [&_svg]:size-[21px]!" />
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
          className={`${CLASES_RANURA_MOVIL} ${
            tono === 'suave' ? 'bg-muted text-foreground' : 'bg-primary text-primary-foreground'
          }`}
        >
          <accionMovil.icono aria-hidden="true" className="size-[19px]" />
        </a>
      ) : (
        menuMovil ?? null
      )}
    </header>
  )
}
