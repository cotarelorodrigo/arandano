'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { CardDelFormulario } from './formularios'
import { ListaDeImeis } from './lista-de-imeis'
import {
  prenderSerieAccion, apagarSerieAccion, darDeBajaUnidadAccion, type EstadoInventario,
} from './acciones'
import { formatearFechaCorta } from '@/lib/formato/mostrar'

// Acá y no en acciones.ts, por lo mismo que en formularios.tsx: ese archivo es
// 'use server' y sólo puede exportar funciones async.
const INICIAL: EstadoInventario = { error: null, aviso: null }

/** A partir de cuántas unidades libres aparece el filtro dentro de la card. */
const UMBRAL_FILTRO = 8

/**
 * Una fila de la lista de unidades, con la baja en dos pasos sobre el MISMO
 * botón (mismo mecanismo que `AnularVenta` y el doble `Esc` del carrito de
 * /vender: "irreversible pero frecuente"). El primer toque arma la
 * confirmación y cambia el rótulo a "Confirmar baja"; se desarma solo a los 3
 * segundos, o al terminar el envío.
 *
 * **Dos copias del botón, escritorio y teléfono** (`hidden lg:flex` /
 * `lg:hidden`), la regla de este repo para todo control duplicado — acá no
 * por permisos (esto no lleva ninguno) sino por el layout: la fila entera
 * cambia de eje entre los dos anchos, y cada eje necesita su propio botón en
 * el lugar que le corresponde. Las dos comparten el MISMO `<form>` —vía el
 * atributo `form=`, no anidamiento— y el MISMO estado de armado, así que
 * tocar cualquiera de las dos arma o confirma las dos a la vez.
 */
function FilaDeUnidad({
  articuloId,
  unidad,
}: {
  articuloId: string
  unidad: { id: string; imei: string; ingresadaEn: Date }
}) {
  const [estado, accion, enviando] = useActionState(darDeBajaUnidadAccion, INICIAL)
  const [armado, setArmado] = useState(false)
  const desarmar = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formId = `form-baja-${unidad.id}`

  useEffect(() => () => {
    if (desarmar.current) clearTimeout(desarmar.current)
  }, [])

  function armarConfirmacion() {
    setArmado(true)
    if (desarmar.current) clearTimeout(desarmar.current)
    desarmar.current = setTimeout(() => setArmado(false), 3000)
  }

  function alApretar(e: React.MouseEvent<HTMLButtonElement>) {
    if (armado) return
    e.preventDefault()
    armarConfirmacion()
  }

  const boton = (claseExtra: string) => (
    <Button
      type="submit"
      form={formId}
      variant={armado ? 'destructive' : 'ghost'}
      size="sm"
      disabled={enviando}
      onClick={alApretar}
      className={claseExtra}
    >
      {enviando ? 'Dando de baja…' : armado ? 'Confirmar baja' : 'Dar de baja'}
    </Button>
  )

  return (
    <div className="flex flex-col gap-2 border-b py-2 last:border-b-0 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:py-[9px]">
      {/* Sin campos visibles propios, salvo la nota (`form=`, más abajo): sólo
          dispara la acción con `articuloId`/`unidadId` ya conocidos. */}
      <form id={formId} action={accion} className="hidden" aria-hidden="true">
        <input type="hidden" name="articuloId" value={articuloId} />
        <input type="hidden" name="unidadId" value={unidad.id} />
      </form>

      {/* Teléfono: la fila se apila, con el botón a la derecha del par
          IMEI/fecha. */}
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-foreground">{unidad.imei}</span>
          <span className="text-[11px] text-muted-foreground">
            Ingresó el {formatearFechaCorta(unidad.ingresadaEn)}
          </span>
        </div>
        {boton('shrink-0')}
      </div>

      {/* Escritorio: una fila más parecida a una tabla, IMEI y fecha en
          columnas propias. */}
      <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-between lg:gap-3">
        <span className="text-[13px] font-medium text-foreground">{unidad.imei}</span>
        <span className="text-[11px] text-muted-foreground">
          Ingresó el {formatearFechaCorta(unidad.ingresadaEn)}
        </span>
        {boton('shrink-0')}
      </div>

      {/* La nota es UNA sola, referenciada por las dos copias del formulario
          vía `form=` — duplicarla junto con el botón dejaría dos <input>
          con el mismo `name` en el DOM, y sólo uno de los dos recibiría lo
          que la persona tipeó según el ancho en que está mirando. */}
      <Input
        form={formId}
        name="nota"
        placeholder="Motivo (opcional): se rompió, se robó, garantía…"
        className="h-9 rounded-[9px] lg:w-[220px]"
        aria-label={`Motivo de la baja de ${unidad.imei}`}
      />

      {estado.error && (
        <p className="text-[11px] text-destructive">{estado.error}</p>
      )}
    </div>
  )
}

/**
 * La card "Unidades" de la ficha de un artículo con serie: la lista de IMEI
 * libres, cuándo entró cada uno, y "Dar de baja" con su nota (Task 8 del ciclo
 * de unidades por IMEI).
 *
 * **Archivo propio y no adentro de `formularios.tsx`**: ese archivo ya tenía
 * 734 líneas antes de esta task y esto es una responsabilidad distinta.
 *
 * Sin frame en `design/arandano.pen` — es anterior a esta feature —, así que
 * se deriva del resto de la pantalla: la misma `CardDelFormulario` que usan
 * el alta y la ficha.
 */
export function CardDeUnidades({
  articuloId,
  unidades,
}: {
  articuloId: string
  // El tipo lo produce `unidadesLibres` (lib/inventario/unidades.ts). Las
  // fechas llegan como `Date` desde el Server Component; se formatean con
  // `formatearFechaCorta`, la misma que ya usa el historial.
  unidades: { id: string; imei: string; ingresadaEn: Date }[]
}) {
  const [filtro, setFiltro] = useState('')

  const visibles =
    filtro.trim() === ''
      ? unidades
      : unidades.filter((u) => u.imei.toLowerCase().includes(filtro.trim().toLowerCase()))

  return (
    <CardDelFormulario id="unidades" titulo="Unidades">
      {unidades.length > UMBRAL_FILTRO && (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-[15px] -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por IMEI"
            aria-label="Filtrar unidades por IMEI"
            className="h-9 rounded-[9px] pl-9"
          />
        </div>
      )}
      {unidades.length === 0 ? (
        <p className="text-[12px] leading-[1.5] text-muted-foreground">
          Todavía no cargaste ninguna unidad. Prendé el switch de arriba con el stock que ya tenés,
          o ingresá mercadería cargando el IMEI de cada equipo.
        </p>
      ) : (
        <>
          <div className="flex flex-col">
            {visibles.map((u) => (
              <FilaDeUnidad key={u.id} articuloId={articuloId} unidad={u} />
            ))}
          </div>
          {visibles.length === 0 && (
            <p className="text-[12px] text-muted-foreground">Ningún IMEI coincide con el filtro.</p>
          )}
        </>
      )}
    </CardDelFormulario>
  )
}

/**
 * El switch "Lleva IMEI o número de serie" de la ficha (Task 8). Prender con
 * stock en cero postea directo; con stock cargado abre un `Dialog` que pide
 * exactamente esa cantidad de IMEI (decisión 4 del spec) antes de confirmar.
 * Apagar siempre postea directo — el motor (`apagarSerie`) es quien rechaza
 * si quedan unidades libres.
 *
 * **Optimista con rollback**, mismo patrón que `Interruptor` de
 * `app/(app)/bot/formularios.tsx`: el switch cambia al toque y vuelve atrás si
 * el servidor lo rechaza — acá además el estado real llega de nuevo por
 * `llevaSerie` cuando `revalidatePath` trae la ficha actualizada.
 */
export function SwitchDeSerie({
  articuloId,
  llevaSerie,
  stock,
  puedeEditar,
}: {
  articuloId: string
  llevaSerie: boolean
  // Como STRING y no `Prisma.Decimal`: esto lo consume un componente
  // cliente, y un Decimal no cruza ese borde sin perder el tipo. Mismo
  // criterio que `ArticuloVendible`.
  stock: string
  puedeEditar: boolean
}) {
  const [activo, setActivo] = useState(llevaSerie)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stockNum = Number(stock)

  async function apagar() {
    setActivo(false)
    setError(null)
    setEnCurso(true)
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    const r = await apagarSerieAccion(INICIAL, datos)
    setEnCurso(false)
    if (r.error) {
      setActivo(true)
      setError(r.error)
    }
  }

  async function prenderSinDialogo() {
    setActivo(true)
    setError(null)
    setEnCurso(true)
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    const r = await prenderSerieAccion(INICIAL, datos)
    setEnCurso(false)
    if (r.error) {
      setActivo(false)
      setError(r.error)
    }
  }

  function alCambiar(valor: boolean) {
    if (!valor) {
      void apagar()
      return
    }
    if (stockNum > 0) {
      setDialogoAbierto(true)
      return
    }
    void prenderSinDialogo()
  }

  async function confirmarDialogo(datos: FormData) {
    datos.set('articuloId', articuloId)
    setError(null)
    setEnCurso(true)
    const r = await prenderSerieAccion(INICIAL, datos)
    setEnCurso(false)
    if (r.error) {
      setError(r.error)
      return
    }
    setActivo(true)
    setDialogoAbierto(false)
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border bg-card p-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="lleva-serie">Lleva IMEI o número de serie</Label>
        <p className="text-[11px] text-muted-foreground">
          Cada unidad se identifica y se vende por separado
        </p>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
      <Switch
        id="lleva-serie"
        checked={activo}
        disabled={!puedeEditar || enCurso}
        onCheckedChange={alCambiar}
      />

      <Dialog open={dialogoAbierto} onOpenChange={setDialogoAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cargá el IMEI de cada unidad</DialogTitle>
            <DialogDescription>
              Hay {stock} en stock: hacen falta {stock} IMEI, uno por unidad, para prender el
              switch.
            </DialogDescription>
          </DialogHeader>
          <form
            id="form-prender-serie"
            action={confirmarDialogo}
            className="flex flex-col gap-3"
          >
            <ListaDeImeis filasFijas={stockNum} />
          </form>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogoAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="form-prender-serie" disabled={enCurso}>
              {enCurso ? 'Prendiendo…' : 'Prender'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
