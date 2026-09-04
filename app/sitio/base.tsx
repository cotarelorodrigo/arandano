import tipografia from './tipografia.module.css'

/**
 * Lo que comparten las secciones de la landing.
 *
 * `ANCHO` es la geometría de la maqueta, no una normalización nuestra: el
 * frame `Sitio / Landing` (nodo `vDLU8`) es de 1440px y todas sus secciones
 * miden 1328 de ancho, o sea 56px de padding lateral. Abajo de 1024 el padding
 * pasa a 20px (frame `Móvil / Sitio · Landing`, las ocho secciones).
 */
export const ANCHO = 'mx-auto w-full max-w-[1440px] px-5 lg:px-14'

/**
 * El H2 que comparten Módulos, Rubros y Planes: 38px/700 Archivo, tracking
 * -1px (design/arandano.pen: nodos `zJXxh`, `htFds`, `Z4a34E` — los tres son
 * el mismo estilo letra por letra). Un solo lugar para las tres en vez de
 * repetir la clase tres veces.
 *
 * Mobile-first, con el valor del teléfono (26px/600) sin prefijo.
 */
export function TituloDeSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className={`${tipografia.archivo} text-[26px] leading-[1.15] font-semibold text-foreground lg:text-[38px] lg:leading-[1.12] lg:font-bold lg:tracking-[-1px]`}
    >
      {children}
    </h2>
  )
}

/**
 * El encabezado de una sección: título y bajada, con el mismo ancho de medida
 * y el mismo ritmo en las tres que lo llevan.
 */
export function EncabezadoDeSeccion({ titulo, bajada }: { titulo: string; bajada: string }) {
  return (
    <div className="flex max-w-[640px] flex-col gap-[10px] lg:gap-3">
      <TituloDeSeccion>{titulo}</TituloDeSeccion>
      <p className="text-[13px] leading-[1.5] text-foreground-soft lg:text-[15px] lg:leading-[1.6]">
        {bajada}
      </p>
    </div>
  )
}
