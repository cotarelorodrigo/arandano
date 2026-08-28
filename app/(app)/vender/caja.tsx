'use client'

import { cloneElement, useActionState, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import { abrirCajaDesdeVender, cerrarCajaDesdeVender, type EstadoCaja } from './acciones'
import { formatearFecha, formatearPrecio, montoSinSigno } from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'
import estilos from '@/components/importe.module.css'

const INICIAL: EstadoCaja = { error: null }

/**
 * La forma de "chip convertido en mini-form", compartida por `ConfirmarCierre`
 * y `FormularioDeApertura`: los dos reemplazan un chip de píldora por un
 * formulario que vive en el MISMO lugar del header, así que llevan la misma
 * geometría de píldora (radio completo, borde, fondo `--card`). Estaba
 * copiada verbatim en los dos —hallazgo de la review final—; un solo lugar
 * para el string es lo que evita que retocar el padding de uno los
 * desalinee entre sí sin que se note.
 */
const CLASES_MINI_FORM =
  'flex items-center gap-2 rounded-full border border-input bg-card py-[3px] pr-[5px] pl-[11px]'

/** Lo mínimo del turno en curso que el chip necesita — no el `saldoInicial`
 *  (`Decimal` de Prisma), que no cruza la frontera servidor→cliente: un
 *  objeto de una librería no es JSON, a diferencia de un `Date`, que sí. Y
 *  no el `id`: `cerrarCajaDesdeVender()` no recibe parámetros —encuentra la
 *  caja abierta del tenant/usuario del lado del servidor—, así que un `id`
 *  acá sólo cruzaría la frontera para no ser leído nunca, hallazgo de la
 *  review final del rediseño. */
export type CajaDelChip = { abiertaEn: Date }

/**
 * El chip de caja y el de cotización del header de `/vender`
 * (design/arandano.pen, frame `r4vdc` "Estado" del Topbar).
 *
 * Los dos viven en el mismo componente porque los dos se leen juntos en
 * `page.tsx` y porque el `.pen` los dibuja pegados, con el mismo `gap:10` que
 * ya pone `Encabezado` alrededor de `acciones` — así que este componente NO
 * agrega su propio contenedor con gap; devuelve los dos chips como hermanos.
 */
export function ChipCaja({
  caja,
  cotizacionUsd,
  cotizacionUsdEn,
}: {
  caja: CajaDelChip | null
  cotizacionUsd: string | null
  cotizacionUsdEn: Date | null
}) {
  return (
    <>
      {caja ? <ChipCajaAbierta caja={caja} /> : <ChipSinCaja />}
      <ChipCotizacion valor={cotizacionUsd} en={cotizacionUsdEn} />
    </>
  )
}

/**
 * El chip "Caja abierta" tal cual lo dibuja el `.pen` (nodo `yLN3A`): punto
 * de 7px + texto, verde `--ok`/`--ok-soft`. La única diferencia con el `.pen`
 * es que ACÁ es un `<button>`: el frame de la maqueta es un estado de
 * reposo, no dibuja ninguna interacción (mismo criterio que ya vale para la
 * lista de resultados del buscador, que tampoco está dibujada) — y sin poder
 * cerrar la caja desde algún lado, el chip sería un cartel que nadie puede
 * apagar. Clickearlo arma la confirmación de cierre, en el mismo lugar y sin
 * diálogo — ver el comentario de `ConfirmarCierre` para el porqué de un
 * segundo paso en vez de cerrar directo.
 */
function ChipCajaAbierta({ caja }: { caja: CajaDelChip }) {
  const [confirmando, setConfirmando] = useState(false)
  if (confirmando) return <ConfirmarCierre caja={caja} onCancelar={() => setConfirmando(false)} />
  return (
    <button
      type="button"
      onClick={() => setConfirmando(true)}
      className="flex items-center gap-[7px] rounded-full bg-ok-soft px-[11px] py-[6px]"
    >
      <span className="size-[7px] rounded-full bg-ok" aria-hidden="true" />
      <span className="text-xs font-semibold text-ok">Caja abierta</span>
    </button>
  )
}

/**
 * Corta Escape ACÁ para que no le llegue al carrito de venta, del otro lado
 * de la pantalla — hallazgo de la revisión final del rediseño de /vender.
 * `punto-de-venta.tsx` escucha `keydown` en `window` para armar/vaciar el
 * carrito con Esc, sin mirar qué elemento tiene el foco (ver el comentario
 * de `hayOverlayDeRadixAbierto` ahí: esa guarda cubre un `Select` de Radix
 * abierto, pero estos mini-forms NO son de Radix, así que esa guarda no los
 * alcanza). Sin este corte, tipear el saldo inicial acá —o simplemente mirar
 * la confirmación de cierre— y apretar Escape, el gesto más obvio para
 * "cancelar esto", armaba o vaciaba de rebote un carrito de la venta en
 * curso que no tiene nada que ver con la caja. `stopPropagation` en la fase
 * de burbuja alcanza: React 17+ delega los eventos en la raíz del árbol, así
 * que cortarla ahí frena también al listener nativo que escucha en
 * `window`, más arriba en la cadena.
 */
function detenerEscapeGlobal(e: React.KeyboardEvent) {
  if (e.key === 'Escape') e.stopPropagation()
}

/**
 * Confirmación en dos pasos sobre el mismo chip, mismo criterio que
 * `AnularVenta` (app/(app)/ventas/formularios.tsx): cerrar la caja no se
 * deshace desde acá —no hay arqueo ni pantalla propia todavía—, así que un
 * solo click no puede bastar, pero tampoco hace falta un `confirm()` del
 * navegador ni una dependencia nueva para lograrlo.
 */
function ConfirmarCierre({
  caja,
  onCancelar,
  apilado = false,
}: {
  caja: CajaDelChip
  onCancelar: () => void
  // El mismo formulario en dos envases: la píldora del Topbar de escritorio
  // (el default) y el bloque apilado de la hoja del teléfono. Un booleano y no
  // dos componentes: lo que cambia es el layout, y el cableado de la acción
  // —cuál es, y que el error se anuncie— tiene que quedar en un solo lugar.
  apilado?: boolean
}) {
  const [estado, accion, cerrando] = useActionState(cerrarCajaDesdeVender, INICIAL)
  return (
    <form
      action={accion}
      onKeyDown={detenerEscapeGlobal}
      className={apilado ? 'flex flex-col gap-3' : CLASES_MINI_FORM}
    >
      <span className={apilado ? 'text-sm text-foreground-soft' : 'text-xs text-foreground-soft'}>
        ¿Cerrar la caja abierta desde las {formatearFecha(caja.abiertaEn)}?
      </span>
      {estado.error && (
        <span role="alert" className="text-xs font-semibold text-destructive">{estado.error}</span>
      )}
      <div className={apilado ? 'flex gap-2' : 'contents'}>
        <Button
          type="submit"
          size={apilado ? 'default' : 'sm'}
          variant="destructive"
          disabled={cerrando}
          className={apilado ? 'flex-1' : undefined}
        >
          {cerrando ? 'Cerrando…' : 'Sí, cerrar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={apilado ? 'default' : 'sm'}
          onClick={onCancelar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

/**
 * Sin caja abierta: el chip la ofrece ahí mismo en vez de mostrar un cartel
 * inerte para siempre. Ámbar y no rojo —mismo criterio que el aviso de stock
 * insuficiente en `punto-de-venta.tsx`—: no vender sin caja está permitido
 * (`crearVenta` no la exige, a propósito), así que esto es "hay que mirar",
 * no "no se puede seguir".
 */
function ChipSinCaja() {
  const [abriendo, setAbriendo] = useState(false)
  if (abriendo) return <FormularioDeApertura onCancelar={() => setAbriendo(false)} />
  return (
    <button
      type="button"
      onClick={() => setAbriendo(true)}
      className="flex items-center gap-[7px] rounded-full bg-warn-soft px-[11px] py-[6px]"
    >
      <span className="size-[7px] rounded-full bg-warn" aria-hidden="true" />
      <span className="text-xs font-semibold text-warn">Abrir caja</span>
    </button>
  )
}

function FormularioDeApertura({
  onCancelar,
  apilado = false,
}: {
  onCancelar: () => void
  // Ver el mismo prop en `ConfirmarCierre`, arriba.
  apilado?: boolean
}) {
  const [estado, accion, enviando] = useActionState(abrirCajaDesdeVender, INICIAL)
  return (
    <form
      action={accion}
      onKeyDown={detenerEscapeGlobal}
      className={apilado ? 'flex flex-col gap-3' : CLASES_MINI_FORM}
    >
      <div className={apilado ? 'flex flex-col gap-[5px]' : 'contents'}>
        <Label
          htmlFor="saldoInicial"
          className={apilado ? 'text-[11px] font-semibold text-foreground-soft' : 'text-xs text-foreground-soft'}
        >
          Saldo inicial
        </Label>
        <Input
          id="saldoInicial"
          name="saldoInicial"
          defaultValue="0"
          inputMode="decimal"
          // Apilado toma el ancho de la hoja y trae su propio borde, como
          // cualquier campo de formulario. En la píldora del Topbar no hay
          // espacio para un input de ancho libre sin romper la fila del
          // header, así que ahí va angosto y sin borde propio.
          className={
            apilado
              ? `h-11 text-right ${estilos.importe}`
              : `h-7 w-20 border-0 bg-transparent p-0 text-right shadow-none focus-visible:ring-0 ${estilos.importe}`
          }
        />
      </div>
      {estado.error && (
        <span role="alert" className="text-xs font-semibold text-destructive">{estado.error}</span>
      )}
      <div className={apilado ? 'flex gap-2' : 'contents'}>
        <Button
          type="submit"
          size={apilado ? 'default' : 'sm'}
          disabled={enviando}
          className={apilado ? 'flex-1' : undefined}
        >
          {enviando ? 'Abriendo…' : 'Abrir'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={apilado ? 'default' : 'sm'}
          onClick={onCancelar}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

/**
 * El chip de cotización (design/arandano.pen, nodo `TB7On`): rótulo "USD" en
 * la pila del sistema + el valor en Archivo, mismo tratamiento "importe" que
 * el resto de la plata de `/vender` (docs/sistema-de-diseno.md) — es lo que
 * separa el rótulo (acompaña, no compite) del número (lo que importa mirar).
 *
 * Sin cotización cargada NO inventa un número: `Tenant.cotizacionUsd` puede
 * ser null (el dueño nunca la cargó), y mostrar cualquier cifra ahí sería
 * peor que no mostrar ninguna — el que cobra tomaría una cotización que
 * nadie fijó como si fuera la de hoy.
 */
function ChipCotizacion({ valor, en }: { valor: string | null; en: Date | null }) {
  const chip = (
    <span className="flex items-center gap-[6px] rounded-full border border-input px-[11px] py-[6px]">
      <span className="text-[11px] font-semibold text-foreground-soft">USD</span>
      <span className={`text-xs font-semibold text-foreground ${estilos.importe}`}>
        {/* formatearPrecio() ya antepone "$ ", que acá no corresponde —el
            rótulo "USD" de al lado ya dice de qué moneda se habla—, y
            montoSinSigno() (lib/formato/mostrar.ts) lo descarta con la misma
            regla que ya usa la banda del total de punto-de-venta.tsx. */}
        {valor === null ? '—' : montoSinSigno(formatearPrecio(valor))}
      </span>
    </span>
  )
  // Sin cotización, tampoco hay fecha que mostrar: un tooltip vacío no suma
  // nada y el chip ya dice "—" por su cuenta.
  if (valor === null || en === null) return chip
  return (
    <TooltipProvider>
      <Tooltip>
        {/* tabIndex={0} vía cloneElement, y no en `chip` directamente: el
            <span> pelado del chip nunca entra al orden de tabulación por
            default, así que "Actualizada el ..." quedaba inalcanzable por
            teclado —hallazgo de la review final— en la pantalla que este
            mismo ciclo declara la más operada sin mouse. Sólo hace falta acá,
            en la rama CON tooltip: el chip sin cotización (más arriba) no
            esconde ningún dato extra detrás de un hover, así que no necesita
            un tabIndex que no llevaría a ningún lado. */}
        <TooltipTrigger asChild>{cloneElement(chip, { tabIndex: 0 })}</TooltipTrigger>
        {/* De cuándo es la cotización. El `.pen` no dibuja esto —el nodo
            `TB7On` sólo tiene rótulo y valor—, y va igual: el comentario de
            `Tenant.cotizacionUsdEn` en el schema lo dice explícito, "un dólar
            en el header sin saber de cuándo es, es peor que no mostrarlo". */}
        <TooltipContent>Actualizada el {formatearFecha(en)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// --- El teléfono ---
//
// En el teléfono los dos chips se mudan del Topbar al cuerpo, y ahí
// design/arandano.pen los dibuja SIN ningún control adentro (`MP7Iu` y
// `fBLhr` son dos frames con texto, no botones). Eso es lo que fuerza a que
// abrir y cerrar el turno vivan en el menú `more-vertical` del Topbar: no
// queda otro lugar. La maqueta dibuja el botón del menú pero NO lo abre, así
// que su contenido es derivado — la entrada en
// docs/correcciones-pendientes-del-pen.md la escribe la task de documentación
// del ciclo, que es la que junta las cuatro derivaciones de una vez.

/**
 * Los dos chips de estado tal como los dibuja el frame `xMMfZ` ("Estado") del
 * cuerpo de `Móvil / Vender`: gap 8 entre ellos, y sólo abajo de `lg` —en
 * escritorio los mismos dos datos siguen viviendo en el Topbar, vía `ChipCaja`
 * (arriba), que sí es interactivo.
 *
 * Contenedor propio, a diferencia de `ChipCaja`: acá no hay ningún `acciones`
 * de `Encabezado` que ponga el gap, y el `lg:hidden` va en un solo lugar en vez
 * de repetido en cada chip.
 */
export function ChipsDeEstado({
  caja,
  cotizacionUsd,
}: {
  caja: CajaDelChip | null
  cotizacionUsd: string | null
}) {
  return (
    <div className="flex items-center gap-2 lg:hidden">
      {caja ? (
        // Misma píldora que `ChipCajaAbierta`, sin el <button>: 7px de punto,
        // gap 7, padding [6,11], radio completo (nodo `MP7Iu`).
        <span className="flex items-center gap-[7px] rounded-full bg-ok-soft px-[11px] py-[6px]">
          <span className="size-[7px] rounded-full bg-ok" aria-hidden="true" />
          <span className="text-xs font-semibold text-ok">Caja abierta</span>
        </span>
      ) : (
        // "Sin caja" y NO "Abrir caja": este chip no abre nada, así que un
        // texto en imperativo prometería una acción que no está acá. Ámbar y
        // no rojo, mismo criterio que el chip interactivo de escritorio —
        // vender sin caja está permitido (`crearVenta` no la exige).
        <span className="flex items-center gap-[7px] rounded-full bg-warn-soft px-[11px] py-[6px]">
          <span className="size-[7px] rounded-full bg-warn" aria-hidden="true" />
          <span className="text-xs font-semibold text-warn">Sin caja</span>
        </span>
      )}
      {/* Nodo `fBLhr`: relleno --card y sin borde, al revés que el chip de
          escritorio (`TB7On`, borde y sin relleno) — sobre el gris del cuerpo
          del teléfono un chip sin relleno no se despegaría del fondo.
          Sin tooltip, a diferencia del de escritorio: un tooltip vive del
          hover, que en un teléfono no existe. El costo es real y queda
          anotado — acá el dólar se muestra sin decir de cuándo es. */}
      <span className="flex items-center gap-[6px] rounded-full bg-card px-[11px] py-[6px]">
        <span className="text-[11px] font-semibold text-foreground-soft">USD</span>
        <span className={`text-xs font-semibold text-foreground ${estilos.importe}`}>
          {cotizacionUsd === null ? '—' : montoSinSigno(formatearPrecio(cotizacionUsd))}
        </span>
      </span>
    </div>
  )
}

/**
 * El control de caja de la ranura derecha del Topbar del teléfono (nodo
 * `GZz1a` de `VaHod`, un `more-vertical`), que es donde quedaron abrir y
 * cerrar el turno.
 *
 * POR QUÉ UNA HOJA Y NO UN MENÚ. La primera versión de esta task usaba un
 * `DropdownMenu` con dos ítems, y eso costaba el campo de saldo inicial: un
 * `<input>` adentro de un menú de Radix le pelea al typeahead del propio menú,
 * que atiende las teclas imprimibles para saltar de ítem. Abrir la caja en 0
 * **en silencio**, cuando la persona tenía plata en el cajón, no es una
 * comodidad perdida: el arqueo, cuando exista, va a cuadrar contra ese número.
 * Un `Sheet` no tiene ese problema y aloja los MISMOS dos formularios que ya
 * usa el chip de escritorio, con su saldo inicial y su confirmación de cierre.
 *
 * LA CONFIRMACIÓN DE CIERRE SIGUE SIENDO DE DOS PASOS, y los dos pasos son
 * abrir la hoja y apretar "Sí, cerrar" — el mismo par que en escritorio son
 * clickear el chip y apretar "Sí, cerrar".
 *
 * `Sheet` es el `Dialog` de Radix, así que su contenido monta un
 * `[role="dialog"]` y los tres atajos de teclado de `/vender` se abstienen
 * solos mientras la hoja esté abierta (ver `hayOverlayDeRadixAbierto` en
 * punto-de-venta.tsx). Está verificado contra el paquete instalado en
 * `caja.test.tsx`, no supuesto: en esta pantalla suponer qué renderiza un
 * primitivo de Radix ya produjo un bug de cobro.
 */
export function ControlDeCaja({ caja }: { caja: CajaDelChip | null }) {
  const [abierta, setAbierta] = useState(false)
  // Si el turno de verdad cambió de estado, la hoja ya hizo su trabajo y se
  // cierra sola. `revalidatePath('/vender')` trae el `caja` nuevo por props, y
  // ese cambio es la única señal confiable de éxito que hay: las dos acciones
  // devuelven `{ error: null }` tanto antes de enviarse como después de salir
  // bien. Ajuste durante el render y no un efecto — el mismo patrón (y el
  // mismo lint) que ya obliga a usar punto-de-venta.tsx.
  const [hayCajaReflejada, setHayCajaReflejada] = useState(caja !== null)
  if ((caja !== null) !== hayCajaReflejada) {
    setHayCajaReflejada(caja !== null)
    setAbierta(false)
  }

  return (
    <Sheet open={abierta} onOpenChange={setAbierta}>
      {/* tono 'suave' de la ranura (bg-muted), que es el que
          components/shell/encabezado.tsx reserva para "abre algo" — y es
          además lo que pinta el nodo `NlGrn` de VaHod ($ar-sunken). */}
      <SheetTrigger
        aria-label="Caja del turno"
        className={`${CLASES_RANURA_MOVIL} bg-muted text-foreground`}
      >
        <MoreVertical aria-hidden="true" className="size-[19px]" />
      </SheetTrigger>
      {/* Desde abajo: es de donde salen las hojas en un teléfono, y deja el
          control debajo del pulgar en vez de arriba de todo. */}
      <SheetContent side="bottom" className="gap-0">
        <SheetHeader>
          <SheetTitle>Caja</SheetTitle>
          {/* Radix pide una descripción para el `aria-describedby` del diálogo.
              Ésta dice lo que la hoja puede hacer, no en qué estado está: el
              estado lo dice el formulario de abajo, y repetirlo acá lo dejaría
              desincronizado el día que uno de los dos cambie. */}
          <SheetDescription>El turno de caja del local: abrirlo o cerrarlo.</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {caja ? (
            <ConfirmarCierre caja={caja} onCancelar={() => setAbierta(false)} apilado />
          ) : (
            <FormularioDeApertura onCancelar={() => setAbierta(false)} apilado />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
