'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, FolderInput, Trash2, Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  crearCategoriaAccion,
  renombrarCategoriaAccion,
  moverCategoriaAccion,
  borrarCategoriaAccion,
  type EstadoInventario,
} from './acciones'
import type { RamaConHijas } from '@/lib/inventario/categorias'

const INICIAL: EstadoInventario = { error: null, aviso: null }

/**
 * El campo de texto de crear y renombrar, inline en la fila.
 *
 * **Alto 30, el mismo de la fila**, y no el `Input` de shadcn, que mide 40:
 * con 40 la lista salta diez píxeles cada vez que alguien empieza a editar, y
 * el ritmo del árbol es justamente lo que lo hace legible de un vistazo.
 *
 * **El Escape corta la propagación**, y no es prolijidad: es la misma trampa
 * que ya mordió en `/vender`, donde un Escape destinado a cerrar un panel
 * armaba el vaciado del carrito porque nadie lo frenaba antes de llegar a
 * `window`. Acá no hay carrito, pero la regla —un Escape local se queda en su
 * componente— sale más barato escribirla ahora que descubrirla después.
 */
function CampoInline({
  defecto,
  onCancelar,
  pendiente,
}: {
  defecto?: string
  onCancelar: () => void
  pendiente: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      name="nombre"
      defaultValue={defecto}
      disabled={pendiente}
      autoComplete="off"
      aria-label="Nombre de la categoría"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancelar()
        }
      }}
      // onBlur no cancela: con el botón de guardar al lado, perder el foco
      // para tocarlo cerraría el campo antes de que el click llegue.
      className="h-[30px] min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-[13px] text-foreground outline-none focus:border-ring"
    />
  )
}

/** Un `<form>` de una acción del ABM, con su cartel de error. */
function FormularioDeAbm({
  accion,
  children,
  onListo,
}: {
  accion: typeof crearCategoriaAccion
  children: (pendiente: boolean) => React.ReactNode
  onListo?: () => void
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)

  // Cerrar el campo recién cuando la acción terminó BIEN: si se cerrara
  // siempre, un nombre repetido haría desaparecer lo que la persona escribió
  // junto con el cartel que explica por qué no se guardó.
  useEffect(() => {
    if (!pendiente && estado.aviso && onListo) onListo()
  }, [pendiente, estado.aviso, onListo])

  return (
    <form action={ejecutar} className="contents">
      {children(pendiente)}
      {estado.error && (
        <p role="alert" className="px-2 pb-1 text-[11px] leading-tight text-destructive">
          {estado.error}
        </p>
      )}
    </form>
  )
}

/** El `+` del encabezado: crea un rubro. */
export function CrearRubro() {
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <button
        type="button"
        aria-label="Categoría nueva"
        title="Categoría nueva"
        onClick={() => setAbierto(true)}
        className="flex size-[22px] items-center justify-center rounded-[7px] bg-muted text-foreground-soft"
      >
        <Plus aria-hidden="true" className="size-[13px]" />
      </button>
    )
  }
  return null
}

/**
 * La fila de alta, que aparece al pie de la lista (o adentro de un rubro,
 * cuando es una marca). Se dibuja donde va a quedar la categoría creada, no en
 * un diálogo: es lo que hace obvio de qué rubro va a colgar.
 */
export function FilaDeAlta({
  padreId,
  onCerrar,
  sangria,
}: {
  padreId: string | null
  onCerrar: () => void
  sangria: 'rubro' | 'marca'
}) {
  return (
    <FormularioDeAbm accion={crearCategoriaAccion} onListo={onCerrar}>
      {(pendiente) => (
        <>
          <input type="hidden" name="padreId" value={padreId ?? ''} />
          <div className="flex h-[30px] w-full items-center gap-1.5 px-2">
            <span aria-hidden="true" className={sangria === 'marca' ? 'w-[24px] shrink-0' : 'w-[14px] shrink-0'} />
            <CampoInline onCancelar={onCerrar} pendiente={pendiente} />
          </div>
        </>
      )}
    </FormularioDeAbm>
  )
}

/** La fila en modo renombrar. */
export function FilaEnEdicion({
  categoriaId,
  nombre,
  esMarca,
  onCerrar,
}: {
  categoriaId: string
  nombre: string
  esMarca: boolean
  onCerrar: () => void
}) {
  return (
    <FormularioDeAbm accion={renombrarCategoriaAccion} onListo={onCerrar}>
      {(pendiente) => (
        <>
          <input type="hidden" name="categoriaId" value={categoriaId} />
          <div className="flex h-[30px] w-full items-center gap-1.5 px-2">
            <span aria-hidden="true" className={esMarca ? 'w-[24px] shrink-0' : 'w-[14px] shrink-0'} />
            <CampoInline defecto={nombre} onCancelar={onCerrar} pendiente={pendiente} />
          </div>
        </>
      )}
    </FormularioDeAbm>
  )
}

/**
 * El `⋯` de una fila.
 *
 * Ocupa el lugar de la cuenta al hover en vez de sumar una columna: correr el
 * texto cada vez que el mouse pasa por encima haría bailar la lista entera.
 *
 * **"Mover a…" sólo aparece en las marcas.** Mover un rubro debajo de otro
 * crearía un tercer nivel, y el modelo tiene dos — la validación está en el
 * servidor (`moverCategoria`), pero no ofrecer la opción es lo que evita que
 * alguien la intente y reciba un error por algo que la pantalla le sugirió.
 */
export function MenuDeRama({
  categoriaId,
  esMarca,
  rubros,
  padreActual,
  onRenombrar,
  onAgregarMarca,
}: {
  categoriaId: string
  esMarca: boolean
  rubros: RamaConHijas[]
  padreActual: string | null
  onRenombrar: () => void
  onAgregarMarca?: () => void
}) {
  const [borrando, ejecutarBorrado, borrandoPendiente] = useActionState(
    borrarCategoriaAccion,
    INICIAL,
  )
  const [, ejecutarMovida] = useActionState(moverCategoriaAccion, INICIAL)

  const otrosRubros = rubros.filter((r) => r.id !== padreActual && r.id !== categoriaId)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Opciones de la categoría"
          className="hidden size-5 shrink-0 items-center justify-center rounded text-muted-foreground group-hover/rama:flex data-[state=open]:flex"
        >
          <MoreHorizontal aria-hidden="true" className="size-[15px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onRenombrar}>
            <Pencil aria-hidden="true" className="size-[15px]" />
            Renombrar
          </DropdownMenuItem>
          {!esMarca && onAgregarMarca && (
            <DropdownMenuItem onSelect={onAgregarMarca}>
              <Plus aria-hidden="true" className="size-[15px]" />
              Agregar marca
            </DropdownMenuItem>
          )}
          {esMarca && otrosRubros.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput aria-hidden="true" className="size-[15px]" />
                Mover a…
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otrosRubros.map((r) => (
                  <DropdownMenuItem
                    key={r.id}
                    onSelect={() => {
                      const datos = new FormData()
                      datos.set('categoriaId', categoriaId)
                      datos.set('padreId', r.id)
                      ejecutarMovida(datos)
                    }}
                  >
                    {r.nombre}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={borrandoPendiente}
            onSelect={() => {
              const datos = new FormData()
              datos.set('categoriaId', categoriaId)
              ejecutarBorrado(datos)
            }}
          >
            <Trash2 aria-hidden="true" className="size-[15px]" />
            Borrar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* El error del borrado se muestra ACÁ y no en un toast: es el que dice
          cuántos artículos hay que mover, y desaparecer solo a los tres
          segundos sería justo el mensaje que conviene poder releer. */}
      {borrando.error && (
        <p role="alert" className="absolute top-full right-0 z-10 mt-0.5 w-max max-w-[232px] rounded-md border bg-card px-2 py-1 text-[11px] leading-tight text-destructive shadow-sm">
          {borrando.error}
        </p>
      )}
    </>
  )
}
