'use client'

import { useActionState, useState } from 'react'
import { abrirCajaDesdeVender, cerrarCajaDesdeVender, type EstadoCaja } from './acciones'
import { formatearFecha, formatearPrecio } from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import estilos from '@/components/importe.module.css'

const INICIAL: EstadoCaja = { error: null }

/** Lo mínimo del turno en curso que el chip necesita — no el `saldoInicial`
 *  (`Decimal` de Prisma), que no cruza la frontera servidor→cliente: un
 *  objeto de una librería no es JSON, a diferencia de un `Date`, que sí. */
export type CajaDelChip = { id: string; abiertaEn: Date }

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
 * Confirmación en dos pasos sobre el mismo chip, mismo criterio que
 * `AnularVenta` (app/(app)/ventas/formularios.tsx): cerrar la caja no se
 * deshace desde acá —no hay arqueo ni pantalla propia todavía—, así que un
 * solo click no puede bastar, pero tampoco hace falta un `confirm()` del
 * navegador ni una dependencia nueva para lograrlo.
 */
function ConfirmarCierre({ caja, onCancelar }: { caja: CajaDelChip; onCancelar: () => void }) {
  const [estado, accion, cerrando] = useActionState(cerrarCajaDesdeVender, INICIAL)
  return (
    <form
      action={accion}
      className="flex items-center gap-2 rounded-full border border-input bg-card py-[3px] pr-[5px] pl-[11px]"
    >
      <span className="text-xs text-foreground-soft">
        ¿Cerrar la caja abierta desde las {formatearFecha(caja.abiertaEn)}?
      </span>
      {estado.error && (
        <span className="text-xs font-semibold text-destructive">{estado.error}</span>
      )}
      <Button type="submit" size="sm" variant="destructive" disabled={cerrando}>
        {cerrando ? 'Cerrando…' : 'Sí, cerrar'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
        Cancelar
      </Button>
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

function FormularioDeApertura({ onCancelar }: { onCancelar: () => void }) {
  const [estado, accion, enviando] = useActionState(abrirCajaDesdeVender, INICIAL)
  return (
    <form
      action={accion}
      className="flex items-center gap-2 rounded-full border border-input bg-card py-[3px] pr-[5px] pl-[11px]"
    >
      <Label htmlFor="saldoInicial" className="text-xs text-foreground-soft">
        Saldo inicial
      </Label>
      <Input
        id="saldoInicial"
        name="saldoInicial"
        defaultValue="0"
        inputMode="decimal"
        // 20 caracteres alcanza para cualquier saldo real; el chip no tiene
        // espacio para un input de ancho libre sin romper la fila del header.
        className={`h-7 w-20 border-0 bg-transparent p-0 text-right shadow-none focus-visible:ring-0 ${estilos.importe}`}
      />
      {estado.error && (
        <span className="text-xs font-semibold text-destructive">{estado.error}</span>
      )}
      <Button type="submit" size="sm" disabled={enviando}>
        {enviando ? 'Abriendo…' : 'Abrir'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
        Cancelar
      </Button>
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
            rótulo "USD" de al lado ya dice de qué moneda se habla— y se
            descarta con el mismo `.replace()` que ya usa la banda del total
            de punto-de-venta.tsx para separar el signo del número. */}
        {valor === null ? '—' : formatearPrecio(valor).replace(/^\D+/, '')}
      </span>
    </span>
  )
  // Sin cotización, tampoco hay fecha que mostrar: un tooltip vacío no suma
  // nada y el chip ya dice "—" por su cuenta.
  if (valor === null || en === null) return chip
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        {/* De cuándo es la cotización. El `.pen` no dibuja esto —el nodo
            `TB7On` sólo tiene rótulo y valor—, y va igual: el comentario de
            `Tenant.cotizacionUsdEn` en el schema lo dice explícito, "un dólar
            en el header sin saber de cuándo es, es peor que no mostrarlo". */}
        <TooltipContent>Actualizada el {formatearFecha(en)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
