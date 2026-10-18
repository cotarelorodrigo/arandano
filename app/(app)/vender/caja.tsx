'use client'

import { useActionState, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import {
  abrirCajaDesdeVender,
  cerrarCajaDesdeVender,
  registrarMovimientoDesdeVender,
  type EstadoCaja,
} from './acciones'
import { formatearFecha, formatearHora, precioEnSuMoneda } from '@/lib/formato/mostrar'
import {
  canonicoACentavos,
  diferencia,
  queda,
  textoDeDiferencia,
  tipeadoACentavos,
  type MonedaDeCaja,
} from '@/lib/caja/arqueo'
import { deCentavos } from '@/lib/ventas/centavos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'
import estilos from '@/components/importe.module.css'
import { ChipCotizacion, ChipCotizacionMovil, PanelDeCotizacion, type CotizacionDeVender } from './dolar'

const INICIAL: EstadoCaja = { error: null }

/**
 * La forma de "chip convertido en mini-form" de `FormularioDeApertura`: la
 * apertura reemplaza el chip de píldora por un formulario que vive en el MISMO
 * lugar del header, con la misma geometría de píldora (radio completo, borde,
 * fondo `--card`). Desde el ciclo del arqueo el cierre ya no es un mini-form
 * —es un formulario con varios campos, adentro del panel de la caja—, así que
 * esta constante tiene un solo consumidor; se deja con nombre porque el string
 * es largo y su porqué es el de siempre.
 */
const CLASES_MINI_FORM =
  'flex items-center gap-2 rounded-full border border-input bg-card py-[3px] pr-[5px] pl-[11px]'

/** Un importe por moneda, como texto canónico de un Decimal (`"55000.00"`):
 *  un `Decimal` de Prisma no cruza la frontera servidor→cliente. */
export type ImporteDeCaja = { ars: string; usd: string }

/** Un movimiento del turno tal como llega del servidor
 *  (`movimientosDeLaCaja`, lib/caja/efectivo.ts). */
export type MovimientoDeCajaVisible = {
  id: string
  tipo: 'INGRESO' | 'EGRESO' | 'RETIRO'
  moneda: MonedaDeCaja
  monto: string
  nota: string | null
  usuario: string
  creadoEn: Date
}

/**
 * Lo que el chip, el panel y la hoja necesitan del turno en curso. Lo arma
 * `page.tsx` desde `turnoEnCurso` (lib/caja/efectivo.ts), con todo como texto.
 *
 * Desde el ciclo del arqueo (2026-10-18) lleva el efectivo del turno con su
 * desglose y los movimientos: antes era sólo `abiertaEn`, porque el chip no
 * decía nada más que "abierta". No lleva el `id` de la caja por lo mismo que
 * antes: ninguna action lo recibe —todas encuentran la caja abierta del
 * tenant del lado del servidor—, así que cruzaría la frontera para no ser
 * leído nunca.
 *
 * `conDolares` lo decide el servidor (`huboDolares`): la columna de dólares se
 * muestra sólo si el turno tuvo algún dólar (spec, decisión 3).
 */
export type CajaDelChip = {
  abiertaEn: Date
  abiertaPor: string
  conDolares: boolean
  efectivo: {
    apertura: ImporteDeCaja
    cobrado: ImporteDeCaja
    devuelto: ImporteDeCaja
    ingresos: ImporteDeCaja
    egresos: ImporteDeCaja
    retiros: ImporteDeCaja
    actual: ImporteDeCaja
  }
  movimientos: MovimientoDeCajaVisible[]
}

/** Con cuánto conviene abrir: lo que quedó en el último cierre con arqueo
 *  (`aperturaSugerida`, lib/caja/abrir-cerrar.ts), o `null`. */
export type AperturaSugerida = ImporteDeCaja | null

function importe(texto: string, moneda: MonedaDeCaja): string {
  return precioEnSuMoneda(texto, moneda)
}

/** "Caja abierta · $ 55.000,00", y los dólares al lado sólo si el turno los
 *  tuvo. Es el texto del chip de escritorio y del de sólo lectura del
 *  teléfono: los dos dicen lo mismo. */
function rotuloDelChip(caja: CajaDelChip): string {
  const pesos = importe(caja.efectivo.actual.ars, 'ARS')
  return caja.conDolares
    ? `Caja abierta · ${pesos} · ${importe(caja.efectivo.actual.usd, 'USD')}`
    : `Caja abierta · ${pesos}`
}

/**
 * El chip de caja y el de cotización del header de `/vender`
 * (design/arandano.pen, frame `r4vdc` "Estado" del Topbar).
 *
 * Los dos viven en el mismo componente porque los dos se leen juntos en
 * `page.tsx` y porque el `.pen` los dibuja pegados, con el mismo `gap:10` que
 * ya pone `Encabezado` alrededor de `acciones` — así que este componente NO
 * agrega su propio contenedor con gap; devuelve los dos chips como hermanos.
 * El de cotización vive en `dolar.tsx` desde el ciclo de la cotización del
 * dólar (2026-10-18): es otro dato, con otra action y otro permiso.
 */
export function ChipCaja({
  caja,
  cotizacion,
  aperturaSugerida = null,
}: {
  caja: CajaDelChip | null
  cotizacion: CotizacionDeVender
  aperturaSugerida?: AperturaSugerida
}) {
  return (
    <>
      {caja ? <ChipCajaAbierta caja={caja} /> : <ChipSinCaja sugerida={aperturaSugerida} />}
      <ChipCotizacion cotizacion={cotizacion} />
    </>
  )
}

/**
 * El chip "Caja abierta" del `.pen` (nodo `yLN3A`): punto de 7px + texto,
 * verde `--ok`/`--ok-soft`. Dos diferencias con la maqueta, las dos
 * derivadas (entrada en docs/correcciones-pendientes-del-pen.md):
 *
 * - **Es un botón**: la maqueta dibuja un estado de reposo, sin interacción, y
 *   sin un lugar desde donde cerrar el turno el chip sería un cartel que nadie
 *   puede apagar.
 * - **Dice el efectivo actual** ("Caja abierta · $ 55.000,00"), desde el ciclo
 *   del arqueo: es la mitad del pedido del cliente —"ver desde la caja cuánto
 *   efectivo hay ahora"—, y se actualiza con cada cobro porque el cobro ya
 *   revalida `/vender`.
 *
 * Abre el panel de la caja en un `Dialog` de Radix, igual que el chip "USD"
 * de al lado y por los mismos dos motivos de teclado (ver `ChipCotizacion` en
 * dolar.tsx): mientras está abierto monta un `[role="dialog"]`, así que los
 * atajos de `/vender` se abstienen solos —Enter adentro del cierre envía el
 * CIERRE, nunca cobra la venta—, y al cerrarse **no le devuelve el foco al
 * chip** (`onCloseAutoFocus` con `preventDefault`): con el foco en un
 * `<button>` el Enter-para-cobrar se abstiene y, peor, reabría el panel.
 * Sin devolverlo, el foco cae en `<body>`, que es donde viven los atajos.
 */
function ChipCajaAbierta({ caja }: { caja: CajaDelChip }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="flex items-center gap-[7px] rounded-full bg-ok-soft px-[11px] py-[6px]">
        <span className="size-[7px] rounded-full bg-ok" aria-hidden="true" />
        <span className={`text-xs font-semibold text-ok ${estilos.importe}`}>{rotuloDelChip(caja)}</span>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85svh] gap-4 overflow-y-auto rounded-2xl p-6 sm:max-w-[440px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Caja</DialogTitle>
          <DialogDescription>
            Abierta desde las {formatearFecha(caja.abiertaEn)} por {caja.abiertaPor}.
          </DialogDescription>
        </DialogHeader>
        <PanelDeCaja caja={caja} onSalir={() => setAbierto(false)} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Corta Escape ACÁ para que no le llegue al carrito de venta, del otro lado
 * de la pantalla — hallazgo de la revisión final del rediseño de /vender.
 * `punto-de-venta.tsx` escucha `keydown` en `window` para armar/vaciar el
 * carrito con Esc, sin mirar qué elemento tiene el foco (ver el comentario
 * de `hayOverlayDeRadixAbierto` ahí: esa guarda cubre un `Select` de Radix
 * abierto, pero estos mini-forms NO son de Radix, así que esa guarda no los
 * alcanza). Sin este corte, tipear el saldo inicial acá y apretar Escape, el
 * gesto más obvio para "cancelar esto", armaba o vaciaba de rebote un carrito
 * de la venta en curso que no tiene nada que ver con la caja.
 * `stopPropagation` en la fase de burbuja alcanza: React 17+ delega los
 * eventos en la raíz del árbol, así que cortarla ahí frena también al
 * listener nativo que escucha en `window`, más arriba en la cadena.
 *
 * Los formularios del panel de la caja (movimiento y cierre) NO lo necesitan:
 * viven adentro de un `Dialog`/`Sheet` de Radix, y ahí la guarda general ya
 * alcanza. Lo llevan igual, porque no cuesta nada y no dependen de dónde se
 * los monte.
 *
 * EXPORTADA porque el ciclo del detalle de venta encontró el mismo hueco en
 * el `<Textarea>` de "Detalles", del otro lado de la MISMA pantalla —ver su
 * `onKeyDown` en `punto-de-venta.tsx`—. Sigue siendo el mismo hueco, así que
 * es el mismo remedio.
 *
 * DEUDA QUE ESTO NO CIERRA, a propósito: los inputs de la fila de pago
 * (`recibido`, `base`, `cotizacion`) tienen el mismo hueco hoy y ninguno lleva
 * este corte. Cerrarlo ahí exige tocar la rama de Escape del listener global
 * —agregarle la misma allow-list de foco que ya tiene la rama de Enter
 * (`puedeDispararCobroDesdeFoco`)— y merece su propio ciclo.
 */
export function detenerEscapeGlobal(e: React.KeyboardEvent) {
  if (e.key === 'Escape') e.stopPropagation()
}

// --- El panel de la caja ---

const ROTULO_TIPO: Record<MovimientoDeCajaVisible['tipo'], string> = {
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
  RETIRO: 'Retiro',
}

/** Qué hace cada tipo con el efectivo, para el signo de la lista. */
const SIGNO_TIPO: Record<MovimientoDeCajaVisible['tipo'], '+' | '−'> = {
  INGRESO: '+',
  EGRESO: '−',
  RETIRO: '−',
}

type Vista = 'resumen' | 'movimiento' | 'cierre'

/**
 * El panel de la caja abierta: el detalle del efectivo, los movimientos del
 * turno, "Registrar movimiento" y "Cerrar caja" (spec, decisión 5).
 *
 * El MISMO componente en el diálogo del chip de escritorio y en la hoja del
 * teléfono, igual que `PanelDeCotizacion`: el cableado de las actions vive en
 * un solo lugar, así que las dos copias no pueden divergir
 * (test/permisos-en-las-dos-copias.test.ts).
 *
 * **Tres vistas en el mismo lugar, y no tres diálogos**: registrar un
 * movimiento o cerrar reemplazan el resumen y vuelven a él. Un diálogo
 * adentro de otro le complica el foco y el Escape a una pantalla que se opera
 * con teclado, y no compra nada.
 *
 * **El cierre sigue siendo de dos pasos** —abrir el panel y "Cerrar caja",
 * después el formulario con lo contado y "Cerrar la caja"—, y el segundo paso
 * ahora es útil: es donde se cuenta.
 *
 * **Cómo vuelve al resumen después de registrar**: `revalidatePath('/vender')`
 * trae los movimientos nuevos por props, y que la lista haya crecido es la
 * única señal confiable de éxito —la action devuelve `{ error: null }` antes
 * de enviarse y después de salir bien—. Ajuste durante el render, el mismo
 * patrón que `ControlDeCaja`. Después del cierre no hace falta nada: la caja
 * pasa a `null` y el panel entero se desmonta.
 */
export function PanelDeCaja({ caja, onSalir }: { caja: CajaDelChip; onSalir?: () => void }) {
  const [vista, setVista] = useState<Vista>('resumen')
  const [movimientosVistos, setMovimientosVistos] = useState(caja.movimientos.length)
  if (caja.movimientos.length !== movimientosVistos) {
    setMovimientosVistos(caja.movimientos.length)
    setVista('resumen')
  }

  if (vista === 'movimiento') {
    return <FormularioDeMovimiento onVolver={() => setVista('resumen')} />
  }
  if (vista === 'cierre') {
    return <FormularioDeCierre caja={caja} onVolver={() => setVista('resumen')} />
  }
  return (
    <div className="flex flex-col gap-4">
      <ResumenDelEfectivo caja={caja} />
      {caja.movimientos.length > 0 && <ListaDeMovimientos movimientos={caja.movimientos} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => setVista('movimiento')}>
          Registrar movimiento
        </Button>
        <Button type="button" variant="destructive" className="h-10 flex-1" onClick={() => setVista('cierre')}>
          Cerrar caja
        </Button>
      </div>
      {onSalir && (
        <Button type="button" variant="ghost" className="h-10" onClick={onSalir}>
          Listo
        </Button>
      )}
    </div>
  )
}

/**
 * El desglose del efectivo: apertura, cobrado, devoluciones, movimientos y el
 * actual, por moneda. La columna de dólares sólo si el turno tuvo alguno.
 *
 * Las filas en cero no se dibujan (salvo apertura, cobrado y actual, que son
 * la cuenta que todo turno tiene): un local que nunca registró un egreso no
 * tiene por qué leer "Egresos $ 0,00" cada vez que abre el panel.
 */
function ResumenDelEfectivo({ caja }: { caja: CajaDelChip }) {
  const e = caja.efectivo
  const esCero = (x: ImporteDeCaja) => canonicoACentavos(x.ars) === 0 && canonicoACentavos(x.usd) === 0
  const filas: { rotulo: string; valor: ImporteDeCaja; signo: '' | '+' | '−'; siempre?: boolean }[] = [
    { rotulo: 'Apertura', valor: e.apertura, signo: '', siempre: true },
    { rotulo: 'Cobrado en efectivo', valor: e.cobrado, signo: '+', siempre: true },
    { rotulo: 'Devuelto por anulaciones', valor: e.devuelto, signo: '−' },
    { rotulo: 'Ingresos', valor: e.ingresos, signo: '+' },
    { rotulo: 'Egresos', valor: e.egresos, signo: '−' },
    { rotulo: 'Retiros', valor: e.retiros, signo: '−' },
  ]
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-[11px] font-semibold text-foreground-soft">
          <th className="pb-1 text-left font-semibold">
            <span className="sr-only">Concepto</span>
          </th>
          <th className="pb-1 text-right font-semibold">Pesos</th>
          {caja.conDolares && <th className="pb-1 text-right font-semibold">Dólares</th>}
        </tr>
      </thead>
      <tbody>
        {filas
          .filter((f) => f.siempre || !esCero(f.valor))
          .map((f) => (
            <tr key={f.rotulo} className="text-foreground-soft">
              <th scope="row" className="py-1 text-left font-normal">{f.rotulo}</th>
              <td className={`py-1 text-right ${estilos.importe}`}>
                {f.signo && `${f.signo} `}{importe(f.valor.ars, 'ARS')}
              </td>
              {caja.conDolares && (
                <td className={`py-1 text-right ${estilos.importe}`}>
                  {f.signo && `${f.signo} `}{importe(f.valor.usd, 'USD')}
                </td>
              )}
            </tr>
          ))}
        <tr className="border-t text-[15px] font-semibold text-foreground">
          <th scope="row" className="pt-2 text-left font-semibold">Efectivo actual</th>
          <td className={`pt-2 text-right ${estilos.importe}`}>{importe(e.actual.ars, 'ARS')}</td>
          {caja.conDolares && <td className={`pt-2 text-right ${estilos.importe}`}>{importe(e.actual.usd, 'USD')}</td>}
        </tr>
      </tbody>
    </table>
  )
}

/** Los movimientos del turno, en el orden en que pasaron: hora, tipo, motivo,
 *  quién, y el monto con el signo de lo que le hizo al cajón. */
function ListaDeMovimientos({ movimientos }: { movimientos: MovimientoDeCajaVisible[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-foreground-soft">Movimientos del turno</span>
      <ul className="flex flex-col divide-y rounded-xl border">
        {movimientos.map((m) => (
          <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold text-foreground">
                {ROTULO_TIPO[m.tipo]}
                {m.nota && <span className="font-normal text-foreground-soft"> · {m.nota}</span>}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatearHora(m.creadoEn)} · {m.usuario}
              </span>
            </span>
            <span className={`shrink-0 font-semibold text-foreground ${estilos.importe}`}>
              {SIGNO_TIPO[m.tipo]} {importe(m.monto, m.moneda)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Un grupo de opciones como botones segmentados, sobre `<input type="radio">`
 * nativos: el tipo y la moneda del movimiento. Nativos y no un `Select` de
 * Radix: son tres y dos opciones que se ven todas a la vez, y un `Select`
 * suma un listbox al que hay que abrir para ver lo que hay.
 */
function Segmentado<T extends string>({
  nombre,
  rotulo,
  opciones,
  valor,
  onCambio,
}: {
  nombre: string
  rotulo: string
  opciones: { valor: T; texto: string }[]
  valor: T
  onCambio: (v: T) => void
}) {
  return (
    <fieldset className="flex flex-col gap-[5px]">
      <legend className="pb-[5px] text-[11px] font-semibold text-foreground-soft">{rotulo}</legend>
      <div className="flex gap-1 rounded-[10px] bg-muted p-1">
        {opciones.map((o) => (
          <label
            key={o.valor}
            className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-[7px] text-xs font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
              valor === o.valor ? 'bg-card text-foreground shadow-sm' : 'text-foreground-soft'
            }`}
          >
            <input
              type="radio"
              name={nombre}
              value={o.valor}
              checked={valor === o.valor}
              onChange={() => onCambio(o.valor)}
              className="sr-only"
            />
            {o.texto}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Registrar un ingreso, un egreso o un retiro (spec, decisión 2).
 *
 * **Controlado y no `defaultValue`**: React 19 resetea los campos NO
 * controlados de un `<form action>` al terminar cada envío, también cuando la
 * action devolvió un error — y "falta el motivo" con el monto borrado obliga a
 * tipearlo de nuevo. Mismo motivo que el campo de la cotización nueva (dolar.tsx).
 *
 * El motivo es **obligatorio para el egreso**: `required` en el campo y la
 * regla real en `registrarMovimiento`, que la vuelve a exigir. El rótulo
 * cambia con el tipo para que se lea qué se pide.
 *
 * La moneda se ofrece siempre, aunque el turno no haya tenido dólares: un
 * ingreso de dólares es justamente cómo un turno empieza a tenerlos.
 */
function FormularioDeMovimiento({ onVolver }: { onVolver: () => void }) {
  const [estado, accion, enviando] = useActionState(registrarMovimientoDesdeVender, INICIAL)
  const [tipo, setTipo] = useState<MovimientoDeCajaVisible['tipo']>('EGRESO')
  const [moneda, setMoneda] = useState<MonedaDeCaja>('ARS')
  const [monto, setMonto] = useState('')
  const [nota, setNota] = useState('')
  return (
    <form action={accion} onKeyDown={detenerEscapeGlobal} className="flex flex-col gap-3">
      <Segmentado
        nombre="tipo"
        rotulo="Qué pasó"
        valor={tipo}
        onCambio={setTipo}
        opciones={[
          { valor: 'EGRESO', texto: 'Egreso' },
          { valor: 'RETIRO', texto: 'Retiro' },
          { valor: 'INGRESO', texto: 'Ingreso' },
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {tipo === 'EGRESO' && 'Plata que sale del cajón para un gasto.'}
        {tipo === 'RETIRO' && 'Plata que se lleva el dueño, sin ser gasto.'}
        {tipo === 'INGRESO' && 'Plata que entra sin venta, como el cambio del banco.'}
      </p>
      <Segmentado
        nombre="moneda"
        rotulo="Moneda"
        valor={moneda}
        onCambio={setMoneda}
        opciones={[
          { valor: 'ARS', texto: 'Pesos' },
          { valor: 'USD', texto: 'Dólares' },
        ]}
      />
      <div className="flex flex-col gap-[5px]">
        <Label htmlFor="movimiento-monto" className="text-[11px] font-semibold text-foreground-soft">
          Monto
        </Label>
        <Input
          id="movimiento-monto"
          name="monto"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          required
          aria-invalid={estado.error !== null}
          className={`h-10 rounded-[9px] text-right ${estilos.importe}`}
        />
      </div>
      <div className="flex flex-col gap-[5px]">
        <Label htmlFor="movimiento-nota" className="text-[11px] font-semibold text-foreground-soft">
          {tipo === 'EGRESO' ? 'Motivo (obligatorio)' : 'Nota (opcional)'}
        </Label>
        <Input
          id="movimiento-nota"
          name="nota"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          autoComplete="off"
          required={tipo === 'EGRESO'}
          maxLength={500}
          placeholder={tipo === 'EGRESO' ? 'Delivery, limpieza…' : undefined}
          className="h-10 rounded-[9px]"
        />
      </div>
      {estado.error && (
        <span role="alert" className="text-xs font-semibold text-destructive">{estado.error}</span>
      )}
      <div className="flex gap-2">
        <Button type="submit" className="h-10 flex-1" disabled={enviando}>
          {enviando ? 'Registrando…' : 'Registrar'}
        </Button>
        <Button type="button" variant="ghost" className="h-10" onClick={onVolver}>
          Volver
        </Button>
      </div>
    </form>
  )
}

/**
 * La diferencia y lo que queda de una moneda, en vivo. Nada mientras no haya
 * contado; y con uno que la gramática no entiende —`54.800` es tan
 * probablemente miles como decimales, y `lib/formato/gramatica.ts` lo rechaza
 * en vez de adivinar—, no una cuenta sino cómo escribirlo: una cuenta con un
 * número que no es sería peor que ninguna, y el servidor lo rechazaría igual.
 */
export function CuentaEnVivo({
  esperado,
  contado,
  retirado,
  moneda,
}: {
  esperado: string
  contado: string
  retirado: string
  moneda: MonedaDeCaja
}) {
  const c = tipeadoACentavos(contado)
  const r = tipeadoACentavos(retirado)
  if (contado.trim() === '') return null
  if (Number.isNaN(c)) {
    return (
      <span className="text-xs text-muted-foreground">
        No se entiende lo contado: escribilo sin punto de miles, como 54800 o 54800,50.
      </span>
    )
  }
  const dif = diferencia(c, canonicoACentavos(esperado))
  const q = Number.isNaN(r) ? null : queda(c, r)
  return (
    <div className="flex flex-col gap-0.5 text-xs" aria-live="polite">
      {/* Ámbar y no rojo para una diferencia: no bloquea el cierre (spec,
          decisión 4), es "mirá esto". Verde cuando cuadra. */}
      <span className={`font-semibold ${dif === 0 ? 'text-ok' : 'text-warn'}`}>
        {dif === 0 ? 'Cuadra' : textoDeDiferencia(dif, moneda).replace(/^./, (l) => l.toUpperCase())}
      </span>
      {q !== null && (
        <span className={q < 0 ? 'font-semibold text-destructive' : 'text-foreground-soft'}>
          {q < 0 ? 'Se retira más de lo contado' : `Queda ${importe(deCentavos(q), moneda)}`}
        </span>
      )}
    </div>
  )
}

/**
 * Cerrar la caja con el arqueo (spec, decisión 4): el esperado por moneda,
 * lo contado (obligatorio), lo retirado y una nota; en vivo, la diferencia y
 * lo que queda.
 *
 * - **El esperado que se muestra es el de la carga de la página**, y el que
 *   se GUARDA es el que `cerrarCaja` recalcula en su transacción: si entra un
 *   cobro mientras se cuenta, el guardado lo incluye. El texto lo dice, para
 *   que nadie se sorprenda de leer otro número en /caja.
 * - **La diferencia no bloquea**: "Faltan $ 200,00" en ámbar y el botón sigue
 *   habilitado. Retirar más de lo contado sí: lo rechaza el servidor, y acá se
 *   avisa antes.
 * - **Controlado** por lo mismo que el formulario de movimiento, y porque la
 *   cuenta en vivo necesita los valores.
 * - **Enter envía el cierre**, que es lo que se espera de un formulario: el
 *   panel es un `Dialog`/`Sheet` de Radix, así que el atajo de cobrar de
 *   `/vender` no lo ve.
 * - La columna de dólares sólo si el turno tuvo alguno; si no, el servidor lee
 *   la ausencia como cero (ver `ArqueoTipeado`).
 */
export function FormularioDeCierre({ caja, onVolver }: { caja: CajaDelChip; onVolver: () => void }) {
  const [estado, accion, cerrando] = useActionState(cerrarCajaDesdeVender, INICIAL)
  const [campos, setCampos] = useState({
    contadoArs: '', retiradoArs: '', contadoUsd: '', retiradoUsd: '', notaCierre: '',
  })
  const cambiar = (k: keyof typeof campos) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [k]: e.target.value }))
  const monedas: MonedaDeCaja[] = caja.conDolares ? ['ARS', 'USD'] : ['ARS']

  return (
    <form action={accion} onKeyDown={detenerEscapeGlobal} className="flex flex-col gap-4">
      {monedas.map((m) => {
        const sufijo = m === 'ARS' ? 'Ars' : 'Usd'
        const contado = `contado${sufijo}` as const
        const retirado = `retirado${sufijo}` as const
        const esperado = m === 'ARS' ? caja.efectivo.actual.ars : caja.efectivo.actual.usd
        const nombre = m === 'ARS' ? 'pesos' : 'dólares'
        return (
          <fieldset key={m} className="flex flex-col gap-3 rounded-xl border px-[14px] py-3">
            <legend className="px-1 text-[11px] font-semibold text-foreground-soft">
              {m === 'ARS' ? 'Pesos' : 'Dólares'}
            </legend>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-foreground-soft">Esperado</span>
              <span className={`font-semibold text-foreground ${estilos.importe}`}>{importe(esperado, m)}</span>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-[5px]">
                <Label htmlFor={`cierre-${contado}`} className="text-[11px] font-semibold text-foreground-soft">
                  Contado en {nombre}
                </Label>
                <Input
                  id={`cierre-${contado}`}
                  name={contado}
                  value={campos[contado]}
                  onChange={cambiar(contado)}
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  className={`h-10 rounded-[9px] text-right ${estilos.importe}`}
                />
              </div>
              <div className="flex flex-1 flex-col gap-[5px]">
                <Label htmlFor={`cierre-${retirado}`} className="text-[11px] font-semibold text-foreground-soft">
                  Se retira
                </Label>
                <Input
                  id={`cierre-${retirado}`}
                  name={retirado}
                  value={campos[retirado]}
                  onChange={cambiar(retirado)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className={`h-10 rounded-[9px] text-right ${estilos.importe}`}
                />
              </div>
            </div>
            <CuentaEnVivo esperado={esperado} contado={campos[contado]} retirado={campos[retirado]} moneda={m} />
          </fieldset>
        )
      })}
      <div className="flex flex-col gap-[5px]">
        <Label htmlFor="cierre-nota" className="text-[11px] font-semibold text-foreground-soft">
          Nota (opcional)
        </Label>
        <Input
          id="cierre-nota"
          name="notaCierre"
          value={campos.notaCierre}
          onChange={cambiar('notaCierre')}
          autoComplete="off"
          maxLength={500}
          className="h-10 rounded-[9px]"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        El esperado se vuelve a calcular al cerrar: si entra un cobro mientras contás, el cierre lo incluye.
      </p>
      {estado.error && (
        <span role="alert" className="text-xs font-semibold text-destructive">{estado.error}</span>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" className="h-10 flex-1" disabled={cerrando}>
          {cerrando ? 'Cerrando…' : 'Cerrar la caja'}
        </Button>
        <Button type="button" variant="ghost" className="h-10" onClick={onVolver}>
          Volver
        </Button>
      </div>
    </form>
  )
}

// --- La apertura ---

/**
 * Sin caja abierta: el chip la ofrece ahí mismo en vez de mostrar un cartel
 * inerte para siempre. Ámbar y no rojo —mismo criterio que el aviso de stock
 * insuficiente en `punto-de-venta.tsx`—: no vender sin caja está permitido
 * (`crearVenta` no la exige, a propósito), así que esto es "hay que mirar",
 * no "no se puede seguir".
 */
function ChipSinCaja({ sugerida }: { sugerida: AperturaSugerida }) {
  const [abriendo, setAbriendo] = useState(false)
  if (abriendo) return <FormularioDeApertura sugerida={sugerida} onCancelar={() => setAbriendo(false)} />
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

/** Un texto canónico (`"10000.00"`) como arranca el campo: sin ceros de
 *  relleno que haya que borrar (`"10000"`, `"10000.5"`). La gramática de tipeo
 *  lo vuelve a leer igual. */
function paraElCampo(canonico: string): string {
  return canonico.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

/**
 * Abrir el turno: el saldo inicial en pesos y, plegado en "+ US$", en
 * dólares (spec, decisión 3).
 *
 * - **Arranca con lo que quedó en el último cierre** (`sugerida`, contado −
 *   retirado), y se puede cambiar. Sin un cierre previo con arqueo, en "0"
 *   como antes.
 * - **Los dólares plegados** para que el local que no los maneja no vea un
 *   campo de más; desplegados de entrada si la sugerencia trae dólares, porque
 *   ahí esconderlos haría abrir sin ellos sin que nadie lo decida.
 * - **No controlado** (a diferencia de los formularios del panel): un error de
 *   la apertura deja el campo como arrancó, y lo que se pierde es a lo sumo un
 *   número que la sugerencia vuelve a poner.
 */
export function FormularioDeApertura({
  sugerida,
  onCancelar,
  apilado = false,
}: {
  sugerida: AperturaSugerida
  onCancelar: () => void
  // El mismo formulario en dos envases: la píldora del Topbar de escritorio
  // (el default) y el bloque apilado de la hoja del teléfono. Un booleano y no
  // dos componentes: lo que cambia es el layout, y el cableado de la acción
  // —cuál es, y que el error se anuncie— tiene que quedar en un solo lugar.
  apilado?: boolean
}) {
  const [estado, accion, enviando] = useActionState(abrirCajaDesdeVender, INICIAL)
  const sugiereDolares = sugerida !== null && canonicoACentavos(sugerida.usd) !== 0
  const [conDolares, setConDolares] = useState(sugiereDolares)
  const claseInput = apilado
    ? `h-11 text-right ${estilos.importe}`
    // En la píldora del Topbar no hay espacio para un input de ancho libre sin
    // romper la fila del header, así que ahí va angosto y sin borde propio.
    : `h-7 w-20 border-0 bg-transparent p-0 text-right shadow-none focus-visible:ring-0 ${estilos.importe}`
  const claseRotulo = apilado ? 'text-[11px] font-semibold text-foreground-soft' : 'text-xs text-foreground-soft'
  return (
    <form
      action={accion}
      onKeyDown={detenerEscapeGlobal}
      className={apilado ? 'flex flex-col gap-3' : CLASES_MINI_FORM}
    >
      <div className={apilado ? 'flex flex-col gap-[5px]' : 'contents'}>
        <Label htmlFor="saldoInicial" className={claseRotulo}>
          Saldo inicial
        </Label>
        <Input
          id="saldoInicial"
          name="saldoInicial"
          defaultValue={sugerida ? paraElCampo(sugerida.ars) : '0'}
          inputMode="decimal"
          className={claseInput}
        />
      </div>
      {conDolares ? (
        <div className={apilado ? 'flex flex-col gap-[5px]' : 'contents'}>
          <Label htmlFor="saldoInicialUsd" className={claseRotulo}>
            US$
          </Label>
          <Input
            id="saldoInicialUsd"
            name="saldoInicialUsd"
            defaultValue={sugerida ? paraElCampo(sugerida.usd) : ''}
            inputMode="decimal"
            placeholder="0"
            className={claseInput}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size={apilado ? 'default' : 'sm'}
          onClick={() => setConDolares(true)}
          className={apilado ? 'self-start' : undefined}
        >
          + dólares
        </Button>
      )}
      {sugerida && apilado && (
        <span className="text-xs text-muted-foreground">Arranca con lo que quedó en el último cierre.</span>
      )}
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

// --- El teléfono ---
//
// En el teléfono los dos chips se mudan del Topbar al cuerpo, y ahí
// design/arandano.pen los dibuja SIN ningún control adentro (`MP7Iu` y
// `fBLhr` son dos frames con texto, no botones). Eso es lo que fuerza a que
// abrir y cerrar el turno vivan en el menú `more-vertical` del Topbar: no
// queda otro lugar. La maqueta dibuja el botón del menú pero NO lo abre, así
// que su contenido es derivado (docs/correcciones-pendientes-del-pen.md).

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
  cotizacion,
}: {
  caja: CajaDelChip | null
  cotizacion: CotizacionDeVender
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 lg:hidden">
      {caja ? (
        // Misma píldora que `ChipCajaAbierta`, sin el control: 7px de punto,
        // gap 7, padding [6,11], radio completo (nodo `MP7Iu`). Con el
        // efectivo actual desde el ciclo del arqueo, igual que el de
        // escritorio: el teléfono dice lo mismo.
        <span className="flex items-center gap-[7px] rounded-full bg-ok-soft px-[11px] py-[6px]">
          <span className="size-[7px] rounded-full bg-ok" aria-hidden="true" />
          <span className={`text-xs font-semibold text-ok ${estilos.importe}`}>{rotuloDelChip(caja)}</span>
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
      {/* Nodo `fBLhr`. Sin tooltip —un tooltip vive del hover, que en un
          teléfono no existe—, y por eso, desde el ciclo de la cotización del
          dólar, la fecha va escrita en el chip cuando no es de hoy (en ámbar).
          Ver `ChipCotizacionMovil` en dolar.tsx. */}
      <ChipCotizacionMovil cotizacion={cotizacion} />
    </div>
  )
}

/**
 * El control de caja de la ranura derecha del Topbar del teléfono (nodo
 * `GZz1a` de `VaHod`, un `more-vertical`), que es donde quedaron abrir y
 * cerrar el turno — y, desde el ciclo del arqueo, el panel entero de la caja.
 *
 * POR QUÉ UNA HOJA Y NO UN MENÚ. La primera versión de esta task usaba un
 * `DropdownMenu` con dos ítems, y eso costaba el campo de saldo inicial: un
 * `<input>` adentro de un menú de Radix le pelea al typeahead del propio menú,
 * que atiende las teclas imprimibles para saltar de ítem. Abrir la caja en 0
 * **en silencio**, cuando la persona tenía plata en el cajón, no es una
 * comodidad perdida: el arqueo cuadra contra ese número. Un `Sheet` no tiene
 * ese problema y aloja los MISMOS componentes que el chip de escritorio: el
 * `PanelDeCaja` (detalle, movimientos, cierre con arqueo) y la apertura.
 *
 * `Sheet` es el `Dialog` de Radix, así que su contenido monta un
 * `[role="dialog"]` y los tres atajos de teclado de `/vender` se abstienen
 * solos mientras la hoja esté abierta (ver `hayOverlayDeRadixAbierto` en
 * punto-de-venta.tsx). Está verificado contra el paquete instalado en
 * `caja.test.tsx`, no supuesto: en esta pantalla suponer qué renderiza un
 * primitivo de Radix ya produjo un bug de cobro.
 */
export function ControlDeCaja({
  caja,
  cotizacion,
  aperturaSugerida = null,
}: {
  caja: CajaDelChip | null
  cotizacion: CotizacionDeVender
  aperturaSugerida?: AperturaSugerida
}) {
  const [abierta, setAbierta] = useState(false)
  // Si el turno de verdad cambió de estado, la hoja ya hizo su trabajo y se
  // cierra sola. `revalidatePath('/vender')` trae el `caja` nuevo por props, y
  // ese cambio es la única señal confiable de éxito que hay: las actions
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
        aria-label="Caja del turno y cotización del dólar"
        className={`${CLASES_RANURA_MOVIL} bg-muted text-foreground`}
      >
        <MoreVertical aria-hidden="true" className="size-[19px]" />
      </SheetTrigger>
      {/* Desde abajo: es de donde salen las hojas en un teléfono, y deja el
          control debajo del pulgar en vez de arriba de todo. `max-h` + scroll:
          el panel de la caja más el del dólar no entran en 390 × 700. */}
      <SheetContent side="bottom" className="max-h-[85svh] gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Caja y dólar</SheetTitle>
          {/* Radix pide una descripción para el `aria-describedby` del diálogo.
              Ésta dice lo que la hoja puede hacer, no en qué estado está: el
              estado lo dicen los formularios de abajo, y repetirlo acá lo
              dejaría desincronizado el día que uno de los dos cambie. */}
          <SheetDescription>
            El turno de caja del local, y la cotización del dólar con sus últimas cargas.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {caja ? (
            <PanelDeCaja caja={caja} />
          ) : (
            <FormularioDeApertura sugerida={aperturaSugerida} onCancelar={() => setAbierta(false)} apilado />
          )}
        </div>
        {/* La misma entrada que el diálogo del chip de escritorio (spec de la
            cotización, decisión 3): en el teléfono el chip del cuerpo es de
            sólo lectura —la maqueta lo dibuja sin control—, y esta hoja es el
            único control de la pantalla. Mismo `PanelDeCotizacion`, con la
            guarda del permiso adentro, así que las dos copias no pueden
            divergir. */}
        <div className="flex flex-col gap-3 border-t p-4">
          <span className="text-sm font-semibold text-foreground">Cotización del dólar</span>
          <PanelDeCotizacion cotizacion={cotizacion} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
