import Link from 'next/link'
import { ROTULO_VISTA, VISTAS, type Horarios, type Vista } from '@/lib/ventas/horarios'
import estilos from './tipografia.module.css'

// La fila mide 90 px (design/arandano.pen, nodo `EkGAz`) y la barra más alta
// llega a 70: el resto es el aire que necesitan el rótulo de 10 px y su gap
// de 8 para no empujarse fuera de la card, que tiene `overflow-hidden`. Mismo
// reparto que GraficoDeRotacion en /inventario, por el mismo motivo.
const ALTURA_FILA = 90
const ALTURA_MAXIMA_BARRA = 70

/**
 * Cuándo vende el local (design/arandano.pen, nodo `t93if9`): una barra por
 * hora del día o por día de la semana, sobre el mismo período que filtra el
 * resto de la pantalla.
 *
 * **El componente no calcula nada**: las barras, el pico y el pie vienen ya
 * resueltos por `agregarPorTiempo` (lib/ventas/horarios.ts). Es lo que impide
 * que el color de la barra más alta y el texto del pie discrepen entre sí.
 *
 * El segmentado son dos LINKS y no un control de cliente: el estado vive en
 * `?vista`, como los chips Hoy / 7 días / Este mes de esta misma pantalla y
 * como el `?tipo` de /inventario, así que el panel entero funciona sin
 * JavaScript y la vista elegida se puede compartir en una URL. El costo
 * aceptado es que cambiar de vista recarga la página.
 *
 * **La maqueta no lo dibuja en el teléfono** (`nwW2V` no tiene este panel).
 * Va igual, con el mismo tratamiento que "Cómo se movió" de `Móvil / Artículo
 * ficha`: es información, no un control cuyo destino haya que inventar —la
 * distinción que dejó escrita el ciclo móvil—. Anotado en
 * docs/correcciones-pendientes-del-pen.md.
 */
export function GraficoDeHorarios({
  horarios, vista, href,
}: { horarios: Horarios; vista: Vista; href: (v: Vista) => string }) {
  const maximo = Math.max(0, ...horarios.barras.map((b) => b.ventas))

  return (
    <section className="flex w-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cuándo vende el local</h2>
        {/* El segmentado (nodo `YVCzu`): el activo se despega con fondo de
            card y sombra, el inactivo es transparente. `shadow-sm` de
            Tailwind en vez del `0 1 2 #17122114` literal de la maqueta, que
            sería un hex crudo fuera de components/ui. */}
        <div className="flex gap-[2px] rounded-[10px] bg-muted p-[3px]">
          {VISTAS.map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={v === vista ? 'page' : undefined}
              className={
                v === vista
                  ? 'rounded-lg bg-card px-[13px] py-[7px] text-[12px] font-semibold text-foreground shadow-sm'
                  : 'rounded-lg px-[13px] py-[7px] text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {ROTULO_VISTA[v]}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 p-[14px] lg:gap-[14px] lg:p-[18px]">
        {/* items-end y no h-full en cada columna: la fila mide alto fijo y
            cada columna ocupa el alto natural de su barra más su rótulo,
            alineada al piso, así todas comparten la misma línea de base. */}
        <div className="flex items-end gap-[6px]" style={{ height: ALTURA_FILA }}>
          {horarios.barras.map((b) => (
            <div key={b.clave} className="flex flex-1 flex-col items-center gap-2">
              <div
                className={`w-full rounded-t-[6px] ${b.pico ? 'bg-primary' : 'bg-accent'}`}
                style={{
                  height: maximo > 0 ? Math.round((b.ventas / maximo) * ALTURA_MAXIMA_BARRA) : 0,
                }}
              />
              <span className="text-[10px] text-muted-foreground">{b.rotulo}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-[1.4] text-muted-foreground">{horarios.pie}</p>
      </div>
    </section>
  )
}
