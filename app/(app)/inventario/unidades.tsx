'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ScanBarcode, Search, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CardDelFormulario } from './formularios'
import {
  prenderSerieAccion, apagarSerieAccion, darDeBajaUnidadAccion, identificarUnidadAccion,
  type EstadoInventario,
} from './acciones'
import { formatearFechaCorta } from '@/lib/formato/mostrar'

// Acá y no en acciones.ts, por lo mismo que en formularios.tsx: ese archivo es
// 'use server' y sólo puede exportar funciones async.
const INICIAL: EstadoInventario = { error: null, aviso: null }

/** A partir de cuántas unidades identificadas aparece el filtro dentro de la card. */
const UMBRAL_FILTRO = 8

/** Una unidad libre tal como la produce `unidadesLibres`
 *  (lib/inventario/unidades.ts). `imei` es nullable desde la Task 1 del ciclo
 *  "unidades sin identificar": la unidad existe desde que entró la caja, y el
 *  número aparece cuando aparece. Las fechas llegan como `Date` desde el
 *  Server Component; se formatean con `formatearFechaCorta`, la misma que ya
 *  usa el historial. */
type Unidad = { id: string; imei: string | null; ingresadaEn: Date }

/**
 * Una fila de la lista de unidades YA identificadas: su IMEI —editable, para
 * corregir un typo—, cuándo entró, y la baja en dos pasos sobre el MISMO
 * botón (mismo mecanismo que `AnularVenta` y el doble `Esc` del carrito de
 * /vender: "irreversible pero frecuente"). El primer toque arma la
 * confirmación —cambia el rótulo a "Confirmar baja" y programa el desarme a
 * los 3 segundos—; el segundo confirma de verdad.
 *
 * **Dos formularios escondidos y los controles atados por `form=`**, y no un
 * `<form>` envolviendo a la fila: dos formularios anidados son HTML inválido,
 * y acá hacen falta los dos —corregir el IMEI y dar de baja— sobre la misma
 * fila. Es el mismo recurso que la fila ya usaba para la baja sola.
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
 * contenedor de afuera, sin duplicar nada. Cada botón y cada campo viven una
 * sola vez.
 */
function FilaDeUnidad({
  articuloId,
  unidad,
}: {
  articuloId: string
  // Ya identificada: la lista de abajo sólo recibe éstas, y las que todavía no
  // tienen número las atiende el bloque de captura de arriba.
  unidad: { id: string; imei: string; ingresadaEn: Date }
}) {
  const [estado, accion, enviando] = useActionState(darDeBajaUnidadAccion, INICIAL)
  const [estadoCorregir, accionCorregir, corrigiendo] = useActionState(
    identificarUnidadAccion,
    INICIAL,
  )
  const [armado, setArmado] = useState(false)
  const desarmar = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formId = `form-baja-${unidad.id}`
  const formCorregirId = `form-corregir-${unidad.id}`

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
      {/* Sin campos visibles propios (los controles se atan con `form=`, más
          abajo): sólo disparan la acción con `articuloId`/`unidadId` ya
          conocidos. */}
      <form id={formId} action={accion} className="hidden" aria-hidden="true">
        <input type="hidden" name="articuloId" value={articuloId} />
        <input type="hidden" name="unidadId" value={unidad.id} />
      </form>
      <form id={formCorregirId} action={accionCorregir} className="hidden" aria-hidden="true">
        <input type="hidden" name="articuloId" value={articuloId} />
        <input type="hidden" name="unidadId" value={unidad.id} />
      </form>

      {/* IMEI y fecha: columna en el teléfono, fila en escritorio — el MISMO
          control de cada uno, nunca dos. */}
      <div className="flex flex-col gap-1.5 lg:flex-1 lg:flex-row lg:items-center lg:gap-3">
        {/* Editable y prellenado con el IMEI actual: corregir un typo es el
            mismo `identificarUnidadAccion` sobre esa unidad, no una acción
            aparte — el motor sólo lo permite mientras la unidad esté LIBRE
            (una vendida congela su número, igual que `VentaItem` congela
            descripción y precio). */}
        <Input
          form={formCorregirId}
          name="imei"
          defaultValue={unidad.imei}
          aria-label={`IMEI de la unidad que ingresó el ${formatearFechaCorta(unidad.ingresadaEn)}`}
          className="h-9 rounded-[9px] text-[13px] font-medium lg:w-[200px]"
        />
        <Button
          type="submit"
          form={formCorregirId}
          variant="ghost"
          size="sm"
          disabled={corrigiendo}
          className="shrink-0 self-start lg:self-auto"
        >
          {corrigiendo ? 'Corrigiendo…' : 'Corregir'}
        </Button>
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
      {estadoCorregir.error && (
        <p className="text-[11px] text-destructive">{estadoCorregir.error}</p>
      )}
    </div>
  )
}

/**
 * El bloque de captura: UN campo, enfocado, que le pone el IMEI a la unidad
 * sin identificar más vieja. Vive arriba de la lista y sólo existe mientras
 * quede alguna sin número.
 *
 * **La unidad se fija en un hidden y no la elige nadie** (Task 6 del ciclo
 * "unidades sin identificar"): entre unidades sin identificar no hay ninguna
 * diferencia que alguien pueda ver, así que pedir que elijan sería pedir una
 * decisión que no existe. Y es la MÁS VIEJA, que la card conoce sin consultar
 * nada porque `unidadesLibres` ya viene ordenada de más vieja a más nueva —
 * el mismo criterio con el que se vende en un mostrador.
 *
 * **`key={proxima.id}` sobre el bloque es lo que permite escanear una caja
 * tras otra sin tocar el mouse.** Cargado un IMEI, `revalidatePath` trae la
 * ficha de nuevo, la próxima unidad cambia y con ella la key: React remonta el
 * bloque, así que el input —no controlado— nace vacío y el `autoFocus` vuelve
 * a dispararse. Si en cambio la acción FALLA, la próxima unidad es la misma,
 * la key no cambia, y lo tipeado se queda donde está para poder corregirlo,
 * que es exactamente lo que hace falta cuando el número chocó contra otro.
 */
function BloqueDeCaptura({
  articuloId,
  proxima,
  cuantasFaltan,
}: {
  articuloId: string
  proxima: Unidad
  cuantasFaltan: number
}) {
  const [estado, accion, enviando] = useActionState(identificarUnidadAccion, INICIAL)

  return (
    // `bg-muted` sólido y no `bg-muted/40`: el nodo `ex9i1` de la maqueta
    // (frame `y4tEb`) pinta `$ar-sunken` entero, que es exactamente `--muted`
    // (#EEEBF4). El 40 % lo dejaba casi indistinguible de la card que lo
    // contiene, que es lo contrario de lo que un bloque hundido tiene que
    // hacer.
    <div className="flex flex-col gap-2 rounded-[10px] border bg-muted p-3">
      <form action={accion} className="flex items-center gap-2">
        <input type="hidden" name="articuloId" value={articuloId} />
        <input type="hidden" name="unidadId" value={proxima.id} />
        <Input
          name="imei"
          autoFocus
          aria-label="IMEI o número de serie"
          placeholder="Escaneá o tipeá el IMEI"
          className="h-10 rounded-[9px] bg-card"
        />
        {/* El ícono lo pide la maqueta (nodo `qOcAR`, `scan-barcode` 15 px):
            es el que nombra el gesto real —pasar el lector por la caja— y no
            "guardar". */}
        <Button type="submit" size="sm" disabled={enviando} className="h-10 shrink-0">
          <ScanBarcode aria-hidden="true" className="size-[15px]" />
          {enviando ? 'Cargando…' : 'Cargar'}
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground">
        {/* El contador es el que dice cuánto falta para que el stock y la
            vitrina digan lo mismo. */}
        Quedan {cuantasFaltan} sin identificar. Entró el{' '}
        {formatearFechaCorta(proxima.ingresadaEn)}.
      </p>
      {estado.error && (
        <p role="alert" className="text-[12px] leading-[1.5] text-destructive">
          {estado.error}
        </p>
      )}
    </div>
  )
}

/**
 * La card "Unidades" de la ficha de un artículo con serie: arriba el bloque de
 * captura, abajo la lista de IMEI libres con su fecha de ingreso, "Corregir" y
 * "Dar de baja" con su nota.
 *
 * **Archivo propio y no adentro de `formularios.tsx`**: ese archivo ya tenía
 * 734 líneas antes de esta task y esto es una responsabilidad distinta.
 *
 * Sin frame en `design/arandano.pen` — es anterior a esta feature —, así que
 * se deriva del resto de la pantalla: la misma `CardDelFormulario` que usan
 * el alta y la ficha.
 *
 * **La lista lleva `max-h-[420px] overflow-y-auto`, y ése es el arreglo del
 * síntoma que originó el ciclo entero**: con 30 unidades, el diálogo modal que
 * pedía los 30 IMEI de una sentada no entraba en la pantalla. La respuesta no
 * fue ponerle scroll al modal sino sacarlo (ver `SwitchDeSerie`); el tope de
 * acá es lo que impide que la lista, ahora que vive en la página, empuje todo
 * lo demás para abajo. Los 420 px son unas ocho filas: suficiente para que se
 * vea que hay lista, poco para que se coma la pantalla. Sin prefijo `lg:`
 * porque el tope aplica igual en los dos anchos, y `test/responsive.test.ts`
 * no lo marca: es un `max-h`, y un máximo nunca puede desbordar.
 */
export function CardDeUnidades({
  articuloId,
  unidades,
}: {
  articuloId: string
  unidades: Unidad[]
}) {
  const [filtro, setFiltro] = useState('')

  const sinIdentificar = unidades.filter((u) => u.imei === null)
  const identificadas = unidades.filter(
    (u): u is { id: string; imei: string; ingresadaEn: Date } => u.imei !== null,
  )
  const proxima = sinIdentificar[0]

  const visibles =
    filtro.trim() === ''
      ? identificadas
      : identificadas.filter((u) => u.imei.toLowerCase().includes(filtro.trim().toLowerCase()))

  return (
    <CardDelFormulario
      id="unidades"
      titulo="Unidades"
      icono={<Smartphone aria-hidden="true" className="size-4 text-primary" />}
      // El contador del encabezado (design/arandano.pen, frame `y4tEb`, nodo
      // `O9XY8`: "30 libres · 27 sin identificar"). La segunda mitad sólo
      // aparece cuando queda alguna sin número: con todas identificadas, "27
      // sin identificar" sería un cero que no dice nada, y el principio de
      // este producto es que un local que no tiene el caso no ve el control.
      meta={
        unidades.length > 0
          ? `${unidades.length} ${unidades.length === 1 ? 'libre' : 'libres'}${
              sinIdentificar.length > 0 ? ` · ${sinIdentificar.length} sin identificar` : ''
            }`
          : undefined
      }
    >
      {proxima !== undefined && (
        <BloqueDeCaptura
          key={proxima.id}
          articuloId={articuloId}
          proxima={proxima}
          cuantasFaltan={sinIdentificar.length}
        />
      )}
      {identificadas.length > UMBRAL_FILTRO && (
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
        identificadas.length > 0 && (
          <>
            <div className="flex max-h-[420px] flex-col overflow-y-auto">
              {visibles.map((u) => (
                <FilaDeUnidad key={u.id} articuloId={articuloId} unidad={u} />
              ))}
            </div>
            {visibles.length === 0 && (
              <p className="text-[12px] text-muted-foreground">Ningún IMEI coincide con el filtro.</p>
            )}
          </>
        )
      )}
    </CardDelFormulario>
  )
}

/**
 * El switch "Lleva IMEI o número de serie" de la ficha. Prender y apagar
 * postean directo, siempre: el motor (`prenderSerie`) cuenta el stock y las
 * unidades libres que ya haya y crea la diferencia SIN identificar, y
 * (`apagarSerie`) rechaza si quedan unidades libres.
 *
 * **Sin diálogo, y ése es el ciclo entero** (Task 6 de "unidades sin
 * identificar"). Hasta acá, prender con stock cargado abría un `Dialog` que
 * pedía exactamente esa cantidad de IMEI antes de confirmar: con 30 unidades
 * no entraba en la pantalla, y encima obligaba a tener los 30 equipos a mano
 * en ese mismo momento. Ahora se prende de una y los números se cargan de a
 * uno en la card de abajo, cuando cada equipo aparece.
 *
 * **Optimista con rollback**, mismo patrón que `Interruptor` de
 * `app/(app)/bot/formularios.tsx`: el switch cambia al toque y vuelve atrás si
 * el servidor lo rechaza — acá además el estado real llega de nuevo por
 * `llevaSerie` cuando `revalidatePath` trae la ficha actualizada.
 */
export function SwitchDeSerie({
  articuloId,
  llevaSerie,
  puedeEditar,
}: {
  articuloId: string
  llevaSerie: boolean
  puedeEditar: boolean
}) {
  const [activo, setActivo] = useState(llevaSerie)
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `try/finally` en las dos, y el `finally` es lo que importa: si la acción
  // TIRA en vez de devolver `{ error }` —cualquier error que no sea de
  // dominio se relanza por `traducir()`—, sin él `enCurso` quedaba en `true`
  // para siempre, con el switch deshabilitado hasta recargar la pantalla. El
  // `catch` devuelve el switch optimista a donde estaba y relanza: tragar el
  // error lo dejaría fuera del log y de Sentry, que es justo lo que
  // `traducir()` evita del otro lado.
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

  async function prender() {
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
    if (valor) {
      void prender()
      return
    }
    void apagar()
  }

  return (
    // El mismo tratamiento de card que el resto de la ficha, y no un recuadro
    // propio: la maqueta (frame `y4tEb`, nodo `Voydz`) lo dibuja con radio 16
    // y padding [14,18] en escritorio, y su gemelo móvil (`q1JENW`) con
    // [12,14] — mismo mobile-first que `CardDelFormulario`. Antes era
    // `rounded-[10px] p-3`, que lo dejaba visiblemente más chico que la card
    // de al lado.
    <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-[14px] py-3 lg:gap-4 lg:px-[18px] lg:py-[14px]">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="lleva-serie">Lleva IMEI o número de serie</Label>
        <p className="text-[11px] text-muted-foreground">
          Cada unidad se identifica y se vende por separado
        </p>
        {/* Sin condición de diálogo: ya no hay ningún velo de pantalla
            completa detrás del cual pueda esconderse este cartel, que es la
            mitad del hallazgo I4 que la Task 6 resolvió sacando el modal en
            vez de mudando el mensaje. */}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </div>
      <Switch
        id="lleva-serie"
        checked={activo}
        disabled={!puedeEditar || enCurso}
        onCheckedChange={alCambiar}
      />
    </div>
  )
}
