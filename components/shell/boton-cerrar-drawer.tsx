'use client'

import { X } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'

/**
 * El botón de cerrar que design/arandano.pen dibuja AFUERA del paño, sobre el
 * velo (frame `Móvil / Menú (drawer)`, nodo `hFjNK`, adentro de `Velo`):
 * 38×38, `padding [14,12]` desde el borde superior derecho, círculo blanco al
 * 15% sobre el velo (`#FFFFFF26`), ícono `x` blanco de 19 px.
 *
 * POR QUÉ NO `SheetClose` (components/ui/sheet.tsx). `Sidebar`
 * (components/ui/sidebar.tsx) renderiza estos MISMOS children en dos ramas
 * según `isMobile`: adentro de un `<Sheet>` (`Dialog.Root` de Radix) en el
 * teléfono, y adentro de un `<div>` sin ningún `Dialog.Root` en escritorio.
 * `SheetClose` es `Dialog.Close` por debajo, y tira si no hay un `Dialog.Root`
 * alrededor — comprobado en la práctica: `renderToStaticMarkup` con
 * `SheetClose` afuera de un `Sheet` explota con "`DialogClose` must be used
 * within `Dialog`". Eso es EXACTAMENTE lo que pasa en la rama de escritorio
 * (y en el SSR de las dos, porque `useIsMobile()` asume "no es mobile" sin
 * `window` — ver hooks/use-mobile.ts), así que `SheetClose` acá rompía la
 * pantalla entera, en todos los anchos, apenas se cargaba.
 *
 * `setOpenMobile(false)` de `useSidebar()` no depende de ningún contexto de
 * Radix: cierra el drawer sin importar en qué rama de `Sidebar` esté montado,
 * y en la rama de escritorio simplemente no hace nada visible porque
 * `lg:hidden` ya lo saca del flujo.
 *
 * `position: fixed` y no relativo al paño: la maqueta lo dibuja flotando
 * sobre el velo, a la derecha del paño de 288 px — no adentro de él. Un hijo
 * `fixed` de `SheetContent` escapa a su ancho porque `SheetContent` no deja
 * ningún `transform` puesto en reposo (las utilidades `data-open:animate-in`
 * de tw-animate-css sólo animan mientras dura la transición: su
 * `animation-fill-mode` es `none`, así que no hay `transform` que atar un
 * `position: fixed` después de que la entrada termina).
 */
export function BotonCerrarDrawer() {
  const { setOpenMobile } = useSidebar()

  return (
    <button
      type="button"
      onClick={() => setOpenMobile(false)}
      aria-label="Cerrar"
      className="fixed top-3.5 right-3 flex size-[38px] items-center justify-center rounded-full bg-white/15 text-white lg:hidden"
    >
      <X aria-hidden="true" className="size-[19px]" />
    </button>
  )
}
