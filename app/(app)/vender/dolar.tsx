'use client'

import { useActionState, useState } from 'react'
import { cargarCotizacionDesdeVender, type EstadoCotizacion } from './acciones'
import { formatearCotizacion, formatearDiaYMes, formatearFechaCorta, formatearHora, montoSinSigno } from '@/lib/formato/mostrar'
import type { CargaDeCotizacion } from '@/lib/cotizacion/consultar'
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
import estilos from '@/components/importe.module.css'

/**
 * La cotización del dólar del local en `/vender`: el chip "USD" del header, el
 * diálogo que la muestra y la carga, y el mismo panel para la hoja del teléfono.
 *
 * Spec: docs/superpowers/specs/2026-10-18-cotizacion-del-dolar-design.md
 * (decisión 3). Vive aparte de `caja.tsx` porque es otro dato con otra action y
 * otro permiso; `caja.tsx` sólo lo ubica en el header y en la hoja.
 */

/**
 * Lo que `page.tsx` lee para esta pantalla y viaja como prop.
 *
 * - `historial`: las últimas cargas, la más nueva primero. **La primera ES la
 *   vigente** —no viaja aparte—, así que el chip y el diálogo no pueden
 *   contradecirse.
 * - `vieja`: si la vigente no es de hoy en hora argentina (o no hay ninguna),
 *   decidido en el SERVIDOR al armar la página, para que el HTML del servidor
 *   y el del navegador digan lo mismo (un `new Date()` en el render del
 *   cliente daría otro resultado en el borde de la medianoche). Es sólo para
 *   PINTAR: lo que el cobro precarga lo decide el navegador en el momento del
 *   cambio, con su propio reloj (`cotizacionDeHoy`), porque esta pantalla
 *   puede quedar abierta de un día para el otro. Si alguna vez discrepan, es
 *   en la dirección segura: el chip sigue sin ámbar hasta la próxima carga de
 *   la página, pero el campo del cobro ya no se precarga con la de ayer.
 * - `puedeCargar`: el permiso `COTIZACION`. Sin él, el diálogo muestra lo
 *   mismo sin el campo — la action lo vuelve a exigir igual.
 */
export type CotizacionDeVender = {
  historial: CargaDeCotizacion[]
  vieja: boolean
  puedeCargar: boolean
}

const INICIAL: EstadoCotizacion = { error: null, confirmar: null, aviso: null }

/** El valor del chip: "1.450" sin el "$" —el rótulo "USD" de al lado ya dice
 *  de qué se habla—, con la misma regla que la banda del total. */
function valorDelChip(valor: string): string {
  return montoSinSigno(formatearCotizacion(valor))
}

/** Lo que un lector de pantalla oye del chip: el valor y si es de hoy. El
 *  ámbar sólo no lo dice nadie que no lo vea. */
function rotuloDelChip(c: CotizacionDeVender): string {
  const vigente = c.historial[0]
  if (!vigente) return 'Cotización del dólar: sin cargar'
  const cuando = c.vieja ? `del ${formatearDiaYMes(vigente.creadaEn)}, no es de hoy` : 'de hoy'
  return `Cotización del dólar: ${formatearCotizacion(vigente.valor)}, ${cuando}`
}

/**
 * El contenido del chip, compartido por el de escritorio y el del teléfono:
 * rótulo "USD", el valor en Archivo (tratamiento "importe" de
 * docs/sistema-de-diseno.md) y, si es vieja, su fecha.
 *
 * **Vieja = ámbar**, el de advertencia del sistema de diseño y no el rojo: una
 * cotización de ayer no impide vender —el cobro sigue, tipeando la del pago—;
 * es "mirá esto". Sin ninguna cargada también es ámbar, por lo mismo: el chip
 * tiene que llamar a cargarla.
 *
 * La fecha va EN el chip cuando es vieja y no sólo en un tooltip: "un dólar en
 * el header sin saber de cuándo es, es peor que no mostrarlo", y un tooltip no
 * existe en el teléfono. Siendo de hoy no se escribe: es lo que se espera.
 */
function ContenidoDelChip({ cotizacion }: { cotizacion: CotizacionDeVender }) {
  const vigente = cotizacion.historial[0]
  const tono = cotizacion.vieja ? 'text-warn' : 'text-foreground'
  return (
    <>
      <span className={`text-[11px] font-semibold ${cotizacion.vieja ? 'text-warn' : 'text-foreground-soft'}`}>
        USD
      </span>
      <span className={`text-xs font-semibold ${tono} ${estilos.importe}`}>
        {vigente ? valorDelChip(vigente.valor) : '—'}
      </span>
      {vigente && cotizacion.vieja && (
        <span className="text-[11px] font-semibold text-warn">· {formatearDiaYMes(vigente.creadaEn)}</span>
      )}
    </>
  )
}

/**
 * El chip "USD" del Topbar de escritorio (design/arandano.pen, nodo `TB7On`),
 * convertido en botón: abre el diálogo de la cotización. La maqueta lo dibuja
 * en reposo y sin interacción, igual que el chip de caja, que también es un
 * botón por el mismo motivo — sin un lugar donde cargarla, el chip era un
 * cartel que decía "—" para siempre.
 *
 * **El diálogo es un `Dialog` de Radix**: monta un `[role="dialog"]`, así que
 * mientras está abierto los atajos de `/vender` se abstienen solos (Enter no
 * cobra la venta, Esc no arma el vaciado — `hayOverlayDeRadixAbierto` en
 * punto-de-venta.tsx). Enter adentro del campo envía ESTE formulario, que es
 * lo que se espera.
 *
 * **Y al cerrarse NO le devuelve el foco al chip** (`onCloseAutoFocus` con
 * `preventDefault`): Radix lo devuelve al disparador por default, y con el
 * foco en un `<button>` el atajo de Enter-para-cobrar se abstiene (sólo
 * dispara con el foco en `<body>`, ver `puedeDispararCobroDesdeFoco`) —
 * peor: Enter reabría el diálogo. Quien cargó el dólar y cerró con Esc
 * quedaba con un mostrador que no cobraba con Enter hasta clickear en el
 * vacío. Sin devolverlo, el foco cae en `<body>` cuando el contenido se
 * desmonta, que es donde los atajos de esta pantalla viven. El costo, para un
 * lector de pantalla, es perder el lugar en el header; F2 sigue llevando al
 * buscador.
 */
export function ChipCotizacion({ cotizacion }: { cotizacion: CotizacionDeVender }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger
        aria-label={rotuloDelChip(cotizacion)}
        className={`flex items-center gap-[6px] rounded-full border px-[11px] py-[6px] ${
          cotizacion.vieja ? 'border-transparent bg-warn-soft' : 'border-input'
        }`}
      >
        <ContenidoDelChip cotizacion={cotizacion} />
      </DialogTrigger>
      <DialogContent
        className="gap-4 rounded-2xl p-6 sm:max-w-[420px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Cotización del dólar</DialogTitle>
          <DialogDescription>A cuánto toma el local el dólar hoy, y quién la cargó.</DialogDescription>
        </DialogHeader>
        <PanelDeCotizacion cotizacion={cotizacion} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * El chip de sólo lectura del cuerpo del teléfono (nodo `fBLhr`): relleno
 * `--card` y sin borde —sobre el gris del cuerpo un chip sin relleno no se
 * despegaría del fondo—, o el ámbar si es vieja. Sin control adentro, como el
 * de caja de al lado: cargarla vive en la hoja del Topbar (`ControlDeCaja`).
 */
export function ChipCotizacionMovil({ cotizacion }: { cotizacion: CotizacionDeVender }) {
  return (
    <span
      aria-label={rotuloDelChip(cotizacion)}
      className={`flex items-center gap-[6px] rounded-full px-[11px] py-[6px] ${
        cotizacion.vieja ? 'bg-warn-soft' : 'bg-card'
      }`}
    >
      <ContenidoDelChip cotizacion={cotizacion} />
    </span>
  )
}

/** "hoy a las 14:32" o "el 15/10/2026 a las 14:32": lo de hoy no necesita la
 *  fecha, y lo viejo la necesita entera. */
function cuandoSeCargo(fecha: Date, vieja: boolean): string {
  return vieja
    ? `el ${formatearFechaCorta(fecha)} a las ${formatearHora(fecha)}`
    : `hoy a las ${formatearHora(fecha)}`
}

/**
 * El panel de la cotización: la vigente con quién y cuándo, el campo para
 * cargar una nueva (sólo con `COTIZACION`) y las últimas cargas. El MISMO
 * componente en el diálogo de escritorio y en la hoja del teléfono: la guarda
 * del permiso vive en un solo lugar (acá adentro), así que las dos copias no
 * pueden quedar con guardas distintas
 * (test/permisos-en-las-dos-copias.test.ts lo fija).
 */
export function PanelDeCotizacion({ cotizacion }: { cotizacion: CotizacionDeVender }) {
  const vigente = cotizacion.historial[0]
  return (
    <div className="flex flex-col gap-4">
      {vigente ? (
        <div className={`flex flex-col gap-1 rounded-xl px-[14px] py-3 ${cotizacion.vieja ? 'bg-warn-soft' : 'bg-muted'}`}>
          <span className={`${estilos.importe} text-[22px] leading-none font-semibold text-foreground`}>
            US$ 1 = {formatearCotizacion(vigente.valor)}
          </span>
          <span className="text-xs text-foreground-soft">
            Cargada {cuandoSeCargo(vigente.creadaEn, cotizacion.vieja)} por {vigente.cargadaPor}.
          </span>
          {cotizacion.vieja && (
            // Lo que cambia para el que cobra, dicho donde se mira: la vieja
            // no arranca ningún campo sola.
            <span className="text-xs font-semibold text-warn">
              No es de hoy: el cobro no la usa sola, la cotización de cada pago se tipea.
            </span>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-warn-soft px-[14px] py-3 text-[13px] text-warn">
          Todavía no hay ninguna cargada. Sin ella, la cotización de cada pago en dólares se tipea al cobrar.
        </p>
      )}

      {cotizacion.puedeCargar ? (
        <FormularioDeCotizacion vigenteId={vigente?.id ?? null} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Para cargarla hace falta el permiso «Actualizar la cotización del dólar». Se otorga en Usuarios.
        </p>
      )}

      {cotizacion.historial.length > 0 && <HistorialDeCotizaciones historial={cotizacion.historial} />}
    </div>
  )
}

/**
 * El campo para cargar una nueva, con el tope de cordura.
 *
 * **Controlado y no `defaultValue`**: React 19 resetea los campos NO
 * controlados de un `<form action>` al terminar cada envío, y el tope de
 * cordura necesita que el valor siga ahí para confirmarlo con "Sí, cargar". Se
 * vacía a mano cuando la vigente cambió (llegó la página revalidada con una
 * carga nueva), con el ajuste durante el render que ya usa `ControlDeCaja`.
 *
 * **La confirmación es un segundo botón con `name="confirmada"`**, y no un
 * campo oculto: sólo viaja si se aprieta ESE botón. Enter en el campo envía
 * con el primer botón del formulario —"Cargar", sin confirmar—, así que dos
 * Enter seguidos sobre un cero de más vuelven a preguntar en vez de cargarlo.
 * Y la pregunta sólo se muestra para el valor que se preguntó: cambiar el
 * número la apaga.
 */
function FormularioDeCotizacion({ vigenteId }: { vigenteId: string | null }) {
  const [estado, accion, enviando] = useActionState(cargarCotizacionDesdeVender, INICIAL)
  const [texto, setTexto] = useState('')
  const [preguntado, setPreguntado] = useState<string | null>(null)
  const [vigenteVista, setVigenteVista] = useState(vigenteId)
  if (vigenteId !== vigenteVista) {
    setVigenteVista(vigenteId)
    setTexto('')
  }
  const pregunta = estado.confirmar !== null && preguntado === texto ? estado.confirmar : null

  return (
    <form action={accion} onSubmit={() => setPreguntado(texto)} className="flex flex-col gap-2">
      <Label htmlFor="cotizacion-nueva" className="text-[11px] font-semibold text-foreground-soft">
        Cotización nueva
      </Label>
      <div className="flex gap-2">
        <Input
          id="cotizacion-nueva"
          name="valor"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="1450"
          aria-invalid={estado.error !== null}
          className={`h-10 flex-1 rounded-[9px] ${estilos.importe}`}
        />
        <Button type="submit" className="h-10" disabled={enviando}>
          {enviando ? 'Cargando…' : 'Cargar'}
        </Button>
      </div>
      {estado.error && (
        <span role="alert" className="text-xs font-semibold text-destructive">
          {estado.error}
        </span>
      )}
      {pregunta && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-warn-soft px-[14px] py-3">
          <span className="text-xs font-semibold text-warn">{pregunta}</span>
          <Button type="submit" name="confirmada" value="1" variant="outline" size="sm" disabled={enviando}>
            Sí, cargarla igual
          </Button>
        </div>
      )}
      {estado.aviso && !pregunta && (
        <span role="status" className="text-xs font-semibold text-ok">
          {estado.aviso}
        </span>
      )}
    </form>
  )
}

/** Las últimas cargas: cuándo, cuánto y quién. Es la mitad del pedido —"con
 *  historial"—, y lo ve cualquiera, con o sin permiso para cargar. */
function HistorialDeCotizaciones({ historial }: { historial: CargaDeCotizacion[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-foreground-soft">Últimas cargas</span>
      <ul className="flex flex-col divide-y rounded-xl border">
        {historial.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
            <span className="text-muted-foreground tabular-nums">
              {formatearFechaCorta(c.creadaEn)} {formatearHora(c.creadaEn)}
            </span>
            <span className="min-w-0 flex-1 truncate text-foreground-soft">{c.cargadaPor}</span>
            <span className={`${estilos.importe} font-semibold text-foreground`}>{formatearCotizacion(c.valor)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
