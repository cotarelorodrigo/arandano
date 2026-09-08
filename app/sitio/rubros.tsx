'use client'

import { useState } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import { MODULOS, RUBROS, loQueFalta, queActiva, type ClaveDeModulo } from './datos'

/**
 * El índice de rubros, filtrable.
 *
 * POR QUÉ ES FILTRABLE Y NO UNA LISTA QUIETA. El trabajo de esta sección es una
 * búsqueda —"¿está el mío?"— y hasta acá se resolvía leyendo doce filas de
 * arriba abajo. Con los filtros, alguien que atiende una veterinaria toca
 * "Turnos" y ve las cinco que le importan.
 *
 * Y ES DONDE LA ANIMACIÓN DE LAYOUT SE PAGA. Al filtrar, las filas que quedan
 * cambian de posición —y de columna, porque la grilla es de dos—. Sin FLIP
 * saltan a su lugar nuevo y la lista parpadea; con `layout`, cada fila se
 * desliza desde donde estaba, así que se ve QUÉ se quedó en vez de tener que
 * releer la lista entera. Es la única parte de la página donde algo se
 * reordena, y por eso es la única que justifica cargar `domMax` en vez de
 * `domAnimation` (ver `./movimiento`).
 *
 * LOS FILTROS SALEN DE LOS DATOS, no de una lista escrita a mano: uno por
 * módulo, más "Todos" y "Sólo núcleo". El día que exista un cuarto módulo, el
 * filtro aparece solo — misma regla por la que el texto de cada rubro se deriva
 * de `MODULOS` en vez de estar escrito.
 *
 * SIN JAVASCRIPT SE VE LA LISTA COMPLETA. El estado arranca en "Todos", así que
 * el HTML del servidor trae los doce rubros; lo que se pierde sin JS es poder
 * filtrar, no poder leer.
 */

type Filtro = 'todos' | 'nucleo' | ClaveDeModulo

const FILTROS: { clave: Filtro; rotulo: string }[] = [
  { clave: 'todos', rotulo: 'Todos' },
  { clave: 'nucleo', rotulo: 'Sólo núcleo' },
  ...MODULOS.map((modulo) => ({ clave: modulo.clave as Filtro, rotulo: modulo.titulo })),
]

function pasa(modulos: ClaveDeModulo[], filtro: Filtro): boolean {
  if (filtro === 'todos') return true
  if (filtro === 'nucleo') return modulos.length === 0
  return modulos.includes(filtro)
}

export function IndiceDeRubros() {
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const sinMovimiento = useReducedMotion()

  const visibles = RUBROS.filter((rubro) => pasa(rubro.modulos, filtro))

  return (
    <div className="flex flex-col gap-[18px] lg:gap-5">
      <div className="flex flex-wrap gap-2">
        {FILTROS.map((opcion) => {
          const cuantos = RUBROS.filter((rubro) => pasa(rubro.modulos, opcion.clave)).length
          const elegido = opcion.clave === filtro
          return (
            <button
              key={opcion.clave}
              type="button"
              aria-pressed={elegido}
              onClick={() => setFiltro(opcion.clave)}
              className={`flex items-center gap-1.5 rounded-full border px-[13px] py-1.5 text-xs font-semibold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
                elegido
                  ? 'border-primary bg-accent text-primary'
                  : 'border-border bg-card text-foreground-soft hover:border-input'
              }`}
            >
              {opcion.rotulo}
              <span className={elegido ? 'text-primary/70' : 'text-muted-foreground'}>{cuantos}</span>
            </button>
          )
        })}
      </div>

      <ul className="grid grid-cols-1 gap-x-10 border-t lg:grid-cols-2">
        <AnimatePresence initial={false}>
          {visibles.map((rubro) => {
            const falta = loQueFalta(rubro.modulos)
            return (
              <m.li
                key={rubro.titulo}
                // `layout`: lo único de la página que pide FLIP. Al filtrar,
                // esta fila puede cambiar de fila Y de columna, y sin esto
                // aparece de golpe en su lugar nuevo.
                layout={!sinMovimiento}
                initial={sinMovimiento ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                className="flex items-center gap-3 border-b py-[13px] lg:gap-4"
              >
                <rubro.icono aria-hidden="true" className="size-[17px] shrink-0 text-primary" />
                <span className="flex-1 text-[13px] leading-[1.3] font-semibold text-foreground">
                  {rubro.titulo}
                </span>
                <span className="flex flex-col items-end gap-0.5 text-right">
                  <span className="text-[11px] leading-[1.35] text-muted-foreground">
                    {queActiva(rubro.modulos)}
                  </span>
                  {falta.length > 0 && (
                    <span className="text-[11px] leading-[1.35] font-semibold text-warn">
                      {falta.map((modulo) => modulo.titulo).join(' y ')}, en camino
                    </span>
                  )}
                </span>
              </m.li>
            )
          })}
        </AnimatePresence>
      </ul>
    </div>
  )
}
