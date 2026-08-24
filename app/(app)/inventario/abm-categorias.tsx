'use client'

import { useActionState, useEffect, useRef } from 'react'
import { MoreHorizontal, Pencil, FolderInput, Trash2, Plus, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
 * Lanza el toast que corresponda cuando una acción del ABM termina.
 *
 * **Los errores NO se auto-descartan** (`duration: Infinity` + botón de
 * cerrar): "Fundas tiene 2 marcas adentro. Borralas o movelas antes." es
 * accionable —dice qué hacer antes de reintentar— y un aviso que se va solo a
 * los cuatro segundos se lleva justamente la instrucción. Los de éxito sí se
 * van: "Categoría creada" no hay que releerlo, y además la categoría
 * apareciendo en el árbol ya es la confirmación.
 *
 * **La clave (`id`) es estable por acción y por rama**, y eso no es un
 * detalle: `useActionState` retiene su último estado mientras el componente
 * viva, así que este efecto vuelve a correr en cada render. Con una clave
 * fija, sonner reemplaza el aviso que ya está en pantalla en vez de apilar una
 * copia por render.
 */
function useAvisoDeAccion(estado: EstadoInventario, pendiente: boolean, clave: string) {
  useEffect(() => {
    if (pendiente) return
    if (estado.error) toast.error(estado.error, { id: clave, duration: Infinity })
    else if (estado.aviso) toast.success(estado.aviso, { id: clave })
  }, [estado, pendiente, clave])
}

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
  clave,
}: {
  accion: typeof crearCategoriaAccion
  children: (pendiente: boolean) => React.ReactNode
  onListo?: () => void
  /** La clave del toast. Ver `useAvisoDeAccion`. */
  clave: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  useAvisoDeAccion(estado, pendiente, clave)

  // Cerrar el campo recién cuando la acción terminó BIEN: si se cerrara
  // siempre, un nombre repetido haría desaparecer lo que la persona escribió
  // mientras el toast explica por qué no se guardó — y con el campo cerrado no
  // le quedaría dónde corregirlo.
  useEffect(() => {
    if (!pendiente && estado.aviso && onListo) onListo()
  }, [pendiente, estado.aviso, onListo])

  return (
    <form action={ejecutar} className="contents">
      {children(pendiente)}
    </form>
  )
}

/**
 * Guardar y cancelar, del alto de la fila.
 *
 * **Existen porque sin ellos la única salida era Enter**, y no había nada que
 * lo dijera: quien escribiera un nombre y tocara otra parte de la pantalla
 * perdía lo escrito sin ninguna señal —no hay `onBlur` que guarde— y la
 * maqueta no dibuja este estado, así que tampoco había de dónde deducirlo.
 *
 * Miden 22 como el `+` del encabezado, que es el otro control chico de esta
 * columna.
 */
function BotonesDeEdicion({ pendiente, onCancelar }: { pendiente: boolean; onCancelar: () => void }) {
  return (
    <>
      {/* `Button` de components/ui/ y no un <button> a mano con las clases
          copiadas: el color de texto del botón de acción sólo se nombra ahí
          adentro, y `test/sistema-de-diseno.test.ts` lo exige por el único
          bug de accesibilidad real que tuvo el producto — dos utilidades que
          lo tomaron por "el color claro" y quedaron en 1.39:1. El tamaño sí
          va por className: 22, como el `+` del encabezado, que es el otro
          control chico de esta columna. */}
      <Button
        type="submit"
        size="icon-sm"
        disabled={pendiente}
        aria-label="Guardar"
        title="Guardar"
        className="size-[22px] shrink-0 rounded-[7px]"
      >
        <Check aria-hidden="true" className="size-[13px]" />
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        onClick={onCancelar}
        aria-label="Cancelar"
        title="Cancelar"
        className="size-[22px] shrink-0 rounded-[7px]"
      >
        <X aria-hidden="true" className="size-[13px]" />
      </Button>
    </>
  )
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
    <FormularioDeAbm
      accion={crearCategoriaAccion}
      onListo={onCerrar}
      clave={`categoria-alta-${padreId ?? 'raiz'}`}
    >
      {(pendiente) => (
        <>
          <input type="hidden" name="padreId" value={padreId ?? ''} />
          <div className="flex h-[30px] w-full items-center gap-1.5 px-2">
            <span aria-hidden="true" className={sangria === 'marca' ? 'w-[24px] shrink-0' : 'w-[14px] shrink-0'} />
            <CampoInline onCancelar={onCerrar} pendiente={pendiente} />
            <BotonesDeEdicion pendiente={pendiente} onCancelar={onCerrar} />
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
    <FormularioDeAbm
      accion={renombrarCategoriaAccion}
      onListo={onCerrar}
      clave={`categoria-nombre-${categoriaId}`}
    >
      {(pendiente) => (
        <>
          <input type="hidden" name="categoriaId" value={categoriaId} />
          <div className="flex h-[30px] w-full items-center gap-1.5 px-2">
            <span aria-hidden="true" className={esMarca ? 'w-[24px] shrink-0' : 'w-[14px] shrink-0'} />
            <CampoInline defecto={nombre} onCancelar={onCerrar} pendiente={pendiente} />
            <BotonesDeEdicion pendiente={pendiente} onCancelar={onCerrar} />
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
  const [borrado, ejecutarBorrado, borrandoPendiente] = useActionState(
    borrarCategoriaAccion,
    INICIAL,
  )
  /**
   * Mover TAMBIÉN puede fallar, y su error importa: mover "Samsung" a un rubro
   * que ya tiene una "Samsung" choca contra el índice único. Una versión
   * anterior descartaba este estado, así que la marca no se movía y la
   * pantalla no decía por qué.
   */
  const [movida, ejecutarMovida, moviendoPendiente] = useActionState(
    moverCategoriaAccion,
    INICIAL,
  )

  useAvisoDeAccion(borrado, borrandoPendiente, `categoria-borrar-${categoriaId}`)
  useAvisoDeAccion(movida, moviendoPendiente, `categoria-mover-${categoriaId}`)

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
    </>
  )
}
