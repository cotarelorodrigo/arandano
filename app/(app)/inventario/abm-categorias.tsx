'use client'

import { useEffect, useRef, useState } from 'react'
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
 * Lanza el toast que corresponda con el resultado de una acción del ABM.
 *
 * **Es una función normal, llamada en el mismo handler que ejecuta la acción,
 * y NO un `useEffect` sobre `useActionState`.** La primera versión era lo
 * segundo, y los avisos "desaparecían rápido" sin importar su `duration`: el
 * efecto está atado al ciclo de vida del componente, y las filas del árbol se
 * re-renderizan y se desmontan con cada `revalidatePath` — el aviso quedaba
 * colgado de un componente que dejaba de existir mientras el toast todavía
 * tenía que estar en pantalla. Que sonner funcionaba se comprobó aparte, con
 * un botón que lanzaba un toast persistente sin tocar el servidor: ése se
 * quedaba.
 *
 * Acá el toast se lanza UNA vez, cuando la acción ya devolvió, y desde ese
 * momento vive en el store de sonner —global, fuera de React— sin depender de
 * que el componente que lo pidió siga montado.
 *
 * **Los errores no se auto-descartan** (`duration: Infinity` + botón de
 * cerrar): "Fundas tiene 2 marcas adentro. Borralas o movelas antes." es
 * accionable —dice qué hacer antes de reintentar— y un aviso que se va solo a
 * los cuatro segundos se lleva justamente la instrucción. Los de éxito sí se
 * van: "Categoría creada" no hay que releerlo, y la categoría apareciendo en
 * el árbol ya es la confirmación.
 */
function avisar(resultado: EstadoInventario): EstadoInventario {
  if (resultado.error) toast.error(resultado.error, { duration: Infinity })
  else if (resultado.aviso) toast.success(resultado.aviso)
  return resultado
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

/**
 * Un `<form>` de una acción del ABM.
 *
 * **Sin `useActionState`**: maneja el submit a mano, llama al server action y
 * avisa con el resultado en el mismo handler. Ver el comentario de `avisar`
 * para el porqué — con el efecto de por medio, los toasts morían junto con la
 * fila que los había pedido.
 *
 * El costo es que este formulario **necesita JavaScript**, cosa que el resto
 * de los formularios del producto evita. Acá ya era así: el campo aparece por
 * un estado de cliente y el menú que lo abre es de Radix, así que no había
 * ningún camino sin JS que perder.
 */
function FormularioDeAbm({
  accion,
  children,
  onListo,
}: {
  accion: (estado: EstadoInventario, datos: FormData) => Promise<EstadoInventario>
  children: (pendiente: boolean) => React.ReactNode
  onListo: () => void
}) {
  const [pendiente, setPendiente] = useState(false)

  return (
    <form
      className="contents"
      onSubmit={async (e) => {
        e.preventDefault()
        if (pendiente) return
        setPendiente(true)
        const resultado = avisar(await accion(INICIAL, new FormData(e.currentTarget)))
        setPendiente(false)
        // Cerrar el campo sólo si salió bien: con un nombre repetido, cerrarlo
        // haría desaparecer lo que la persona escribió justo cuando el toast
        // le explica que lo corrija, y no le quedaría dónde hacerlo.
        if (!resultado.error) onListo()
      }}
    >
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
    <FormularioDeAbm accion={crearCategoriaAccion} onListo={onCerrar}>
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
    <FormularioDeAbm accion={renombrarCategoriaAccion} onListo={onCerrar}>
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
  /**
   * Las dos acciones del menú se llaman DIRECTO, sin `useActionState`.
   *
   * Con él, además del warning de React —"An async function with
   * useActionState was called outside of a transition", porque un `onSelect`
   * no es un `<form action>`—, el aviso quedaba colgado de un `useEffect`, y
   * eso es lo que hacía que los toasts murieran antes de poder leerlos: la
   * fila se re-renderiza y se desmonta con cada `revalidatePath`. Acá el
   * resultado se avisa en el mismo handler, una sola vez, y desde ahí el toast
   * vive en el store de sonner sin depender de este componente.
   *
   * `pendiente` alcanza para no disparar dos veces el mismo borrado con un
   * doble clic; no hace falta el estado completo de la acción, porque el
   * resultado ya no se renderiza en ningún lado.
   */
  const [pendiente, setPendiente] = useState(false)

  const ejecutar = async (accion: typeof borrarCategoriaAccion, datos: FormData) => {
    if (pendiente) return
    setPendiente(true)
    avisar(await accion(INICIAL, datos))
    setPendiente(false)
  }

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
                      void ejecutar(moverCategoriaAccion, datos)
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
            disabled={pendiente}
            onSelect={() => {
              const datos = new FormData()
              datos.set('categoriaId', categoriaId)
              void ejecutar(borrarCategoriaAccion, datos)
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
