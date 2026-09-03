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
 * confirmación —cambia el rótulo a "Confirmar baja" y programa el desarme a
 * los 3 segundos—; el segundo confirma de verdad.
 *
 * **UN SOLO árbol, no dos presentaciones.** La primera versión duplicaba el
 * IMEI y la fecha en dos `<div>` —uno `lg:hidden`, otro `hidden lg:flex`— para
 * conseguir el apilado en el teléfono, y eso manufacturaba dos copias del
 * botón que después había que probar que estuvieran gateadas igual. Es
 * exactamente el patrón que CLAUDE.md registra como descartado a propósito
 * ("Un solo árbol, no dos presentaciones: el patrón `lg:contents`" — "La
 * alternativa: renderizar dos veces y ocultar una con CSS, deja el mismo dato
 * dos veces en el DOM, y el dueño del producto eligió explícitamente lo
 * contrario"). Acá alcanza con un `<div>` interno `flex-col lg:flex-row` para
 * el par IMEI/fecha: el mismo `flex-col`/`lg:flex-row` que ya gobierna el
 * contenedor de afuera, sin duplicar nada. El botón y la nota viven una sola
 * vez cada uno.
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

  // El primer toque JAMÁS envía: arma la confirmación y corta el submit real.
  // Sin este `if (armado) return` seguido de `preventDefault()`, cualquier
  // toque —el primero incluido— daría de baja la unidad de una: es la línea
  // que sostiene todo el mecanismo de "irreversible pero frecuente".
  function alApretar(e: React.MouseEvent<HTMLButtonElement>) {
    if (armado) return
    e.preventDefault()
    armarConfirmacion()
  }

  return (
    <div className="flex flex-col gap-2 border-b py-2 last:border-b-0 lg:flex-row lg:items-center lg:gap-3 lg:py-[9px]">
      {/* Sin campos visibles propios, salvo la nota y el botón (`form=`, más
          abajo): sólo dispara la acción con `articuloId`/`unidadId` ya
          conocidos. */}
      <form id={formId} action={accion} className="hidden" aria-hidden="true">
        <input type="hidden" name="articuloId" value={articuloId} />
        <input type="hidden" name="unidadId" value={unidad.id} />
      </form>

      {/* IMEI y fecha: columna en el teléfono, fila en escritorio — el MISMO
          `<span>` de cada uno, nunca dos. */}
      <div className="flex flex-col gap-0.5 lg:flex-1 lg:flex-row lg:items-center lg:gap-3">
        <span className="text-[13px] font-medium text-foreground">{unidad.imei}</span>
        <span className="text-[11px] text-muted-foreground">
          Ingresó el {formatearFechaCorta(unidad.ingresadaEn)}
        </span>
      </div>

      <Input
        form={formId}
        name="nota"
        placeholder="Motivo (opcional): se rompió, se robó, garantía…"
        className="h-9 rounded-[9px] lg:w-[220px]"
        aria-label={`Motivo de la baja de ${unidad.imei}`}
      />

      <Button
        type="submit"
        form={formId}
        variant={armado ? 'destructive' : 'ghost'}
        size="sm"
        disabled={enviando}
        onClick={alApretar}
        className="shrink-0"
      >
        {enviando ? 'Dando de baja…' : armado ? 'Confirmar baja' : 'Dar de baja'}
      </Button>

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

  // `try/finally` en las tres, y el `finally` es lo que importa: si la acción
  // TIRA en vez de devolver `{ error }` —y desde que `crearUnidadesEnTx`
  // traduce el choque de IMEI eso es menos probable, pero cualquier error no
  // de dominio sigue relanzándose por `traducir()`—, sin él `enCurso` quedaba
  // en `true` para siempre: el botón congelado en "Prendiendo…" y el switch
  // deshabilitado hasta recargar la pantalla. El `catch` devuelve el switch
  // optimista a donde estaba y relanza: tragar el error lo dejaría fuera del
  // log y de Sentry, que es justo lo que `traducir()` evita del otro lado.
  async function apagar() {
    setActivo(false)
    setError(null)
    setEnCurso(true)
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    try {
      const r = await apagarSerieAccion(INICIAL, datos)
      if (r.error) {
        setActivo(true)
        setError(r.error)
      }
    } catch (e) {
      setActivo(true)
      throw e
    } finally {
      setEnCurso(false)
    }
  }

  async function prenderSinDialogo() {
    setActivo(true)
    setError(null)
    setEnCurso(true)
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    try {
      const r = await prenderSerieAccion(INICIAL, datos)
      if (r.error) {
        setActivo(false)
        setError(r.error)
      }
    } catch (e) {
      setActivo(false)
      throw e
    } finally {
      setEnCurso(false)
    }
  }

  function alCambiar(valor: boolean) {
    if (!valor) {
      void apagar()
      return
    }
    if (stockNum > 0) {
      cambiarDialogo(true)
      return
    }
    void prenderSinDialogo()
  }

  /** El error del diálogo muere con el diálogo: dejarlo vivo lo haría
   *  reaparecer en la fila, ya desconectado del formulario que lo produjo. */
  function cambiarDialogo(abierto: boolean) {
    setDialogoAbierto(abierto)
    if (!abierto) setError(null)
  }

  async function confirmarDialogo(datos: FormData) {
    datos.set('articuloId', articuloId)
    setError(null)
    setEnCurso(true)
    try {
      const r = await prenderSerieAccion(INICIAL, datos)
      if (r.error) {
        setError(r.error)
        return
      }
      setActivo(true)
      setDialogoAbierto(false)
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border bg-card p-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="lleva-serie">Lleva IMEI o número de serie</Label>
        <p className="text-[11px] text-muted-foreground">
          Cada unidad se identifica y se vende por separado
        </p>
        {/* El error de los dos caminos SIN diálogo (apagar, y prender con
            stock en cero). Con el diálogo abierto no se pinta acá: la fila
            queda DETRÁS del velo de pantalla completa de `DialogContent`, con
            el foco atrapado adentro, así que un cartel en este `<div>` no lo
            ve nadie — que es exactamente cómo se perdían
            `SERIE_CONTEO_NO_COINCIDE`, `IMEI_REPETIDO` y
            `SERIE_STOCK_NO_ENTERO`, los tres errores más probables de esta
            pantalla, que es LA que hay que atravesar para adoptar la
            feature. */}
        {error && !dialogoAbierto && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
      <Switch
        id="lleva-serie"
        checked={activo}
        disabled={!puedeEditar || enCurso}
        onCheckedChange={alCambiar}
      />

      <Dialog open={dialogoAbierto} onOpenChange={cambiarDialogo}>
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
            {/* `filasFijas` ya no existe (Task 5 del ciclo "unidades sin
                identificar"): este diálogo entero es UI vieja que la Task 6
                reemplaza por la card sin diálogo, y lo que se escanee acá ya
                lo ignora `prenderSerieAccion` (ver su comentario en
                acciones.ts) — este ajuste es sólo para que compile mientras
                tanto, no un rediseño de este diálogo. */}
            <ListaDeImeis />
          </form>
          {/* DENTRO del `DialogContent`, que es lo único que el usuario está
              mirando mientras el diálogo está abierto. */}
          {error && (
            <p role="alert" className="text-[12px] leading-[1.5] text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => cambiarDialogo(false)}>
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
