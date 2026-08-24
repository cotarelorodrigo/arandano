'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { FilaDeAlta, FilaEnEdicion, MenuDeRama } from './abm-categorias'
import { cn } from '@/lib/utils'
import { esUuid } from '@/lib/uuid'
import type { RamaConHijas } from '@/lib/inventario/categorias'

/** El valor reservado de `?cat` para "los que no cuelgan de ninguna rama". No
 *  es un uuid a propósito: `categoriaDeQuery` los distingue por la forma. */
export const SIN_CATEGORIA = 'sin'

/**
 * El `?cat=` del query string, o `null` para "Todos".
 *
 * Mismo criterio que `tipoDeQuery` y que el clamp de `?p`: cualquier valor que
 * no sea un uuid o la palabra reservada cae en "Todos" en vez de filtrar por
 * algo que no existe. Un query string escrito a mano no puede servir un 500 ni
 * un listado vacío por un typo.
 *
 * Que el uuid EXISTA no se chequea acá: un id bien formado de una categoría
 * borrada —o de otro tenant, que RLS vuelve invisible— filtra a cero
 * resultados, y de eso se encarga el estado vacío, que además ofrece salida.
 */
export function categoriaDeQuery(valor: string | undefined): string | null {
  if (valor === SIN_CATEGORIA) return SIN_CATEGORIA
  return valor && esUuid(valor) ? valor : null
}

/** Las medidas salen de design/arandano.pen (nodos `t56Gp`, `pjcob`, `Xtq8S`):
 *  alto 30, padding lateral 8, radio 8, gap 6. Más compactas que el ítem de
 *  Nav del sidebar, a propósito — un árbol de veinte ramas respira distinto
 *  que un sidebar de cinco destinos. */
const FILA = 'flex h-[30px] w-full items-center gap-1.5 rounded-lg px-2 text-left'

/** El ancho del chevron. Un rubro sin marcas deja el hueco igual, así su texto
 *  arranca donde arranca el de los demás (maqueta, nodo `AEfCk`). */
const HUECO_CHEVRON = 'w-[14px] shrink-0'
/** La sangría de una marca: el hueco del chevron más un paso (maqueta, `Xtq8S`). */
const HUECO_MARCA = 'w-[24px] shrink-0'

const CUENTA = 'w-8 shrink-0 text-right text-xs tabular-nums'

function Cuenta({ n, activa }: { n: number; activa: boolean }) {
  return <span className={cn(CUENTA, activa ? 'font-semibold text-marca' : 'text-muted-foreground')}>{n}</span>
}

/**
 * Una fila del árbol. `data-rama` y `data-activa` existen para los tests: son
 * lo único que deja afirmar cuál está seleccionada sin depender de las clases,
 * que cambian con cada ajuste de la maqueta.
 */
function Fila({
  id,
  nombre,
  cuenta,
  activa,
  href,
  esMarca = false,
  chevron,
  menu,
}: {
  id: string
  nombre: string
  cuenta: number
  activa: boolean
  href: string
  esMarca?: boolean
  chevron?: React.ReactNode
  menu?: React.ReactNode
}) {
  return (
    <div className="group/rama relative">
    <Link
      href={href}
      data-rama={id}
      data-activa={activa ? 'true' : undefined}
      className={cn(FILA, activa && 'bg-accent')}
    >
      {chevron ?? <span aria-hidden="true" className={esMarca ? HUECO_MARCA : HUECO_CHEVRON} />}
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          // La marca es más chica y más liviana que el rubro: es lo que dibuja
          // la jerarquía sin sangrar de más (maqueta, `Xtq8S` vs `pjcob`).
          esMarca ? 'text-[12.5px] font-normal' : 'text-[13px] font-medium',
          activa ? 'font-semibold text-marca' : esMarca ? 'text-foreground-soft' : 'text-foreground',
        )}
      >
        {nombre}
      </span>
      {/* El ⋯ ocupa el LUGAR de la cuenta al hover, no una columna propia:
          correr el texto cada vez que el mouse pasa por encima haría bailar
          la lista entera. */}
      {menu ? (
        <>
          <span className="group-hover/rama:hidden">
            <Cuenta n={cuenta} activa={activa} />
          </span>
          <span className="hidden w-8 shrink-0 justify-end group-hover/rama:flex" />
        </>
      ) : (
        <Cuenta n={cuenta} activa={activa} />
      )}
    </Link>
    {menu && <div className="absolute top-0 right-2 flex h-[30px] items-center">{menu}</div>}
    </div>
  )
}

function Divisor() {
  return (
    <div className="px-1 py-1.5">
      <div className="h-px w-full bg-border" />
    </div>
  )
}

export function PanelDeCategorias({
  arbol,
  total,
  sinCategoria,
  activa,
  esDuenio,
  href,
}: {
  arbol: RamaConHijas[]
  total: number
  sinCategoria: number
  activa: string | null
  esDuenio: boolean
  href: (cat: string | null) => string
}) {
  /**
   * Qué rubros están colapsados. Arrancan TODOS abiertos y esto no persiste
   * entre navegaciones: guardarlo pediría una columna o una cookie por algo
   * que no le cuesta nada a nadie rehacer, y un rubro que aparece cerrado sin
   * que uno lo haya cerrado es peor que uno abierto de más.
   */
  const [cerrados, setCerrados] = useState<Set<string>>(new Set())

  /**
   * Qué fila está en modo edición, si alguna. Una sola por vez: dos campos
   * abiertos a la vez en una columna de 248 no se entienden, y el segundo
   * tapa el error del primero.
   *
   * `renombrar` lleva el id de la rama; `marca` lleva el del rubro que la va a
   * contener; `rubro` no lleva ninguno.
   */
  const [edicion, setEdicion] = useState<
    { modo: 'renombrar' | 'marca'; id: string } | { modo: 'rubro' } | null
  >(null)
  const cerrarEdicion = () => setEdicion(null)

  const alternar = (id: string) =>
    setCerrados((previos) => {
      const proximos = new Set(previos)
      if (proximos.has(id)) proximos.delete(id)
      else proximos.add(id)
      return proximos
    })

  return (
    <aside className="flex w-[248px] shrink-0 flex-col gap-0.5 self-start rounded-2xl border bg-card px-2 py-3">
      <div className="flex h-7 items-center justify-between px-2">
        <span className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground">
          CATEGORÍAS
        </span>
        {esDuenio && (
          <button
            type="button"
            aria-label="Categoría nueva"
            title="Categoría nueva"
            onClick={() => setEdicion({ modo: 'rubro' })}
            className="flex size-[22px] items-center justify-center rounded-[7px] bg-muted text-foreground-soft"
          >
            <Plus aria-hidden="true" className="size-[13px]" />
          </button>
        )}
      </div>

      <Fila
        id="todos"
        nombre="Todos los artículos"
        cuenta={total}
        activa={activa === null}
        href={href(null)}
        chevron={
          /* Decorativo: no despliega nada, pero la maqueta se lo pone
             (nodo `t56Gp`) y sacarlo dejaría su texto desalineado del resto. */
          <ChevronRight
            aria-hidden="true"
            className={cn('size-[14px] shrink-0', activa === null ? 'text-marca' : 'text-muted-foreground')}
          />
        }
      />

      {(arbol.length > 0 || sinCategoria > 0) && <Divisor />}

      {arbol.map((rubro) => {
        // El rubro de la rama activa se fuerza abierto: una marca seleccionada
        // adentro de un rubro colapsado sería una selección invisible.
        const tieneLaActiva = rubro.hijas.some((h) => h.id === activa)
        const abierto = !cerrados.has(rubro.id) || tieneLaActiva
        if (edicion?.modo === 'renombrar' && edicion.id === rubro.id) {
          return (
            <FilaEnEdicion
              key={rubro.id}
              categoriaId={rubro.id}
              nombre={rubro.nombre}
              esMarca={false}
              onCerrar={cerrarEdicion}
            />
          )
        }
        return (
          <div key={rubro.id} className="contents">
            <Fila
              id={rubro.id}
              nombre={rubro.nombre}
              cuenta={rubro.cuenta}
              activa={activa === rubro.id}
              href={href(rubro.id)}
              menu={
                esDuenio ? (
                  <MenuDeRama
                    categoriaId={rubro.id}
                    esMarca={false}
                    rubros={arbol}
                    padreActual={null}
                    onRenombrar={() => setEdicion({ modo: 'renombrar', id: rubro.id })}
                    onAgregarMarca={() => setEdicion({ modo: 'marca', id: rubro.id })}
                  />
                ) : undefined
              }
              chevron={
                rubro.hijas.length > 0 ? (
                  <button
                    type="button"
                    aria-label={abierto ? `Contraer ${rubro.nombre}` : `Desplegar ${rubro.nombre}`}
                    onClick={(e) => {
                      // El chevron vive DENTRO del <Link>: sin esto, tocarlo
                      // navega además de plegar.
                      e.preventDefault()
                      e.stopPropagation()
                      alternar(rubro.id)
                    }}
                    className="flex shrink-0 items-center"
                  >
                    {abierto ? (
                      <ChevronDown aria-hidden="true" className="size-[14px] text-muted-foreground" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="size-[14px] text-muted-foreground" />
                    )}
                  </button>
                ) : undefined
              }
            />
            {abierto &&
              rubro.hijas.map((marca) =>
                edicion?.modo === 'renombrar' && edicion.id === marca.id ? (
                  <FilaEnEdicion
                    key={marca.id}
                    categoriaId={marca.id}
                    nombre={marca.nombre}
                    esMarca
                    onCerrar={cerrarEdicion}
                  />
                ) : (
                  <Fila
                    key={marca.id}
                    id={marca.id}
                    nombre={marca.nombre}
                    cuenta={marca.cuenta}
                    activa={activa === marca.id}
                    href={href(marca.id)}
                    esMarca
                    menu={
                      esDuenio ? (
                        <MenuDeRama
                          categoriaId={marca.id}
                          esMarca
                          rubros={arbol}
                          padreActual={rubro.id}
                          onRenombrar={() => setEdicion({ modo: 'renombrar', id: marca.id })}
                        />
                      ) : undefined
                    }
                  />
                ),
              )}
            {/* El alta de una marca se dibuja DENTRO de su rubro, donde va a
                quedar: es lo que hace obvio de cuál va a colgar. */}
            {edicion?.modo === 'marca' && edicion.id === rubro.id && (
              <FilaDeAlta padreId={rubro.id} onCerrar={cerrarEdicion} sangria="marca" />
            )}
          </div>
        )
      })}

      {edicion?.modo === 'rubro' && (
        <FilaDeAlta padreId={null} onCerrar={cerrarEdicion} sangria="rubro" />
      )}

      {arbol.length === 0 && edicion === null && (
        <p className="px-2 py-3 text-[11px] leading-[1.5] text-muted-foreground">
          Todavía no creaste categorías.
          {esDuenio && ' Empezá con el + de arriba.'}
        </p>
      )}

      {sinCategoria > 0 && (
        <>
          <Divisor />
          <Fila
            id={SIN_CATEGORIA}
            nombre="Sin categoría"
            cuenta={sinCategoria}
            activa={activa === SIN_CATEGORIA}
            href={href(SIN_CATEGORIA)}
          />
        </>
      )}
    </aside>
  )
}
