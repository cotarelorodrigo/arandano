import { Funnel, Wallet } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { exigirDuenio } from '@/lib/auth/sesion'
import { cierresDelPeriodo, TOPE_DEL_HISTORIAL, type CierreDeCaja, type ImporteDelCierre } from '@/lib/caja/historial'
import { canonicoACentavos, diferencia, queda, textoDeDiferencia, type MonedaDeCaja } from '@/lib/caja/arqueo'
import { deCentavos } from '@/lib/ventas/centavos'
import { fechaLarga, fechaOhoy, hoyEnArgentina, inicioDelDia, sumarDias } from '@/lib/formato/fechas'
import { formatearFechaCorta, formatearHora, precioEnSuMoneda } from '@/lib/formato/mostrar'
import importe from '@/components/importe.module.css'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

/** Cuántos días mira la pantalla si no se le pide otro rango (spec, decisión
 *  5): los últimos 30, hoy incluido. */
export const DIAS_POR_DEFECTO = 30

/**
 * El período del filtro: `?desde` y `?hasta` como `YYYY-MM-DD` en hora
 * argentina, con el "hasta" entero (se corta al inicio del día siguiente),
 * igual que /ventas. Lo malformado cae al default en vez de explotar
 * (`fechaOhoy`), y un rango dado vuelta se endereza: pedir "del 20 al 10" es
 * pedir del 10 al 20, no una pantalla vacía.
 *
 * Exportada y pura (recibe `hoy`) para que el test fije el default sin
 * mockear el reloj.
 */
export function periodoDelFiltro(
  params: { desde?: string; hasta?: string },
  hoy: string,
): { dDesde: string; dHasta: string; desde: Date; hasta: Date } {
  let dDesde = fechaOhoy(params.desde, sumarDias(hoy, -(DIAS_POR_DEFECTO - 1)))
  let dHasta = fechaOhoy(params.hasta, hoy)
  if (dDesde > dHasta) [dDesde, dHasta] = [dHasta, dDesde]
  return {
    dDesde,
    dHasta,
    desde: inicioDelDia(dDesde),
    hasta: inicioDelDia(sumarDias(dHasta, 1)),
  }
}

/** Las cifras de UNA moneda de un cierre, ya como texto. La diferencia y lo
 *  que queda salen de lib/caja/arqueo.ts, la misma aritmética que el
 *  formulario de cierre de /vender: el historial no puede decir otra cosa que
 *  lo que la pantalla del cierre dijo. */
export type CifrasDeMoneda = {
  apertura: string
  esperado: string
  contado: string
  diferencia: string
  cuadra: boolean
  retirado: string
  queda: string
}

export function cifrasDeMoneda(c: CierreDeCaja, moneda: MonedaDeCaja): CifrasDeMoneda | { apertura: string } {
  const de = (x: ImporteDelCierre) => (moneda === 'ARS' ? x.ars : x.usd)
  const fmt = (t: string) => precioEnSuMoneda(t, moneda)
  if (!c.arqueo) return { apertura: fmt(de(c.apertura)) }
  const contado = canonicoACentavos(de(c.arqueo.contado))
  const dif = diferencia(contado, canonicoACentavos(de(c.arqueo.esperado)))
  return {
    apertura: fmt(de(c.apertura)),
    esperado: fmt(de(c.arqueo.esperado)),
    contado: fmt(de(c.arqueo.contado)),
    diferencia: textoDeDiferencia(dif, moneda),
    cuadra: dif === 0,
    retirado: fmt(de(c.arqueo.retirado)),
    queda: fmt(deCentavos(queda(contado, canonicoACentavos(de(c.arqueo.retirado))))),
  }
}

const ROTULO_TIPO = { INGRESO: 'Ingreso', EGRESO: 'Egreso', RETIRO: 'Retiro' } as const
const SIGNO_TIPO = { INGRESO: '+', EGRESO: '−', RETIRO: '−' } as const

/** "18/10/2026 09:02 → 20:15", o con la fecha de cierre entera si el turno
 *  cruzó la medianoche. */
function ventanaDelTurno(c: CierreDeCaja): string {
  const mismoDia = formatearFechaCorta(c.abiertaEn) === formatearFechaCorta(c.cerradaEn)
  const cierre = mismoDia
    ? formatearHora(c.cerradaEn)
    : `${formatearFechaCorta(c.cerradaEn)} ${formatearHora(c.cerradaEn)}`
  return `${formatearFechaCorta(c.abiertaEn)} ${formatearHora(c.abiertaEn)} → ${cierre}`
}

/**
 * Un cierre: cuándo y quiénes, y por moneda las seis cifras del arqueo.
 *
 * **Filas y no una tabla**, por lo mismo que /clientes: seis columnas por dos
 * monedas no entran en 390 px sin scroll de costado. Cada moneda es una
 * grilla de tres por dos rótulos con su valor.
 *
 * **La diferencia resaltada si no es cero** (spec, decisión 5), en ámbar —el
 * de advertencia— y no en rojo: una diferencia no es un error del sistema, es
 * lo que el arqueo vino a mostrar.
 *
 * **El detalle con los movimientos va plegado en un `<details>`** nativo y no
 * en una ruta `/caja/[id]`: es una lista corta que se lee en el mismo lugar,
 * funciona sin JavaScript, y no suma una ruta dinámica al barrido del smoke
 * ni un 404 que manejar.
 */
export function FilaDeCierre({ cierre, conDolares }: { cierre: CierreDeCaja; conDolares: boolean }) {
  const monedas: MonedaDeCaja[] = conDolares ? ['ARS', 'USD'] : ['ARS']
  return (
    <li className="flex flex-col gap-3 px-[14px] py-3 lg:px-[18px]">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground tabular-nums">{ventanaDelTurno(cierre)}</span>
        <span className="text-xs text-muted-foreground">
          Abrió {cierre.abiertaPor} · cerró {cierre.cerradaPor}
        </span>
      </div>
      {monedas.map((m) => {
        const cifras = cifrasDeMoneda(cierre, m)
        return (
          <div key={m} className="flex flex-col gap-1.5">
            {conDolares && (
              <span className="text-[11px] font-semibold text-foreground-soft">{m === 'ARS' ? 'Pesos' : 'Dólares'}</span>
            )}
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs lg:grid-cols-6">
              <Cifra rotulo="Apertura" valor={cifras.apertura} />
              {'esperado' in cifras ? (
                <>
                  <Cifra rotulo="Esperado" valor={cifras.esperado} />
                  <Cifra rotulo="Contado" valor={cifras.contado} />
                  <Cifra rotulo="Diferencia" valor={cifras.diferencia} aviso={!cifras.cuadra} />
                  <Cifra rotulo="Retirado" valor={cifras.retirado} />
                  <Cifra rotulo="Queda" valor={cifras.queda} />
                </>
              ) : null}
            </dl>
          </div>
        )
      })}
      {!cierre.arqueo && (
        // Una caja de antes del arqueo, o cerrada con el formulario viejo
        // durante el deploy: no hay nada que inventarle.
        <span className="text-xs text-muted-foreground">Cerrada sin arqueo.</span>
      )}
      {cierre.arqueo?.nota && <span className="text-xs text-foreground-soft">Nota: {cierre.arqueo.nota}</span>}
      {cierre.movimientos.length > 0 && (
        <details className="group rounded-xl border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-foreground-soft">
            {cierre.movimientos.length === 1 ? '1 movimiento' : `${cierre.movimientos.length} movimientos`}
          </summary>
          <ul className="flex flex-col divide-y border-t">
            {cierre.movimientos.map((mv) => (
              <li key={mv.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-foreground">
                    {ROTULO_TIPO[mv.tipo]}
                    {mv.nota && <span className="font-normal text-foreground-soft"> · {mv.nota}</span>}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatearHora(mv.creadoEn)} · {mv.usuario}
                  </span>
                </span>
                <span className={`shrink-0 font-semibold text-foreground ${importe.importe}`}>
                  {SIGNO_TIPO[mv.tipo]} {precioEnSuMoneda(mv.monto, mv.moneda)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function Cifra({ rotulo, valor, aviso = false }: { rotulo: string; valor: string; aviso?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
      <dd
        className={`truncate font-semibold ${importe.importe} ${
          aviso ? 'w-fit rounded-md bg-warn-soft px-1.5 text-warn' : 'text-foreground'
        }`}
      >
        {valor}
      </dd>
    </div>
  )
}

/** El filtro por fecha, en un `<form method="get">`: funciona sin JavaScript
 *  y el rango queda en la URL. Mismas medidas que el de /ventas. */
export function FiltroDeFechas({ dDesde, dHasta }: { dDesde: string; dHasta: string }) {
  return (
    <form method="get" className="flex flex-col gap-[10px] lg:flex-row lg:items-end">
      <div className="flex gap-[10px]">
        <label className="flex flex-1 flex-col gap-[5px] lg:w-[168px] lg:flex-initial">
          <span className="text-[11px] font-semibold text-foreground-soft">Desde</span>
          <Input
            name="desde" type="date" defaultValue={dDesde}
            className="h-10 rounded-[9px] border-input bg-card px-[11px] text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-[5px] lg:w-[168px] lg:flex-initial">
          <span className="text-[11px] font-semibold text-foreground-soft">Hasta</span>
          <Input
            name="hasta" type="date" defaultValue={dHasta}
            className="h-10 rounded-[9px] border-input bg-card px-[11px] text-sm"
          />
        </label>
      </div>
      <Button
        type="submit" variant="outline" size="sm"
        className="h-10 gap-[7px] rounded-[9px] border-input bg-card px-[15px] text-[13px] font-semibold text-foreground hover:bg-muted"
      >
        <Funnel aria-hidden="true" className="size-[15px]" />
        Filtrar
      </Button>
    </form>
  )
}

/** Qué se ve sin ningún cierre en el período. */
export function SinCierres() {
  return (
    <div className="flex flex-col items-center gap-2 px-[18px] py-12 text-center">
      <Wallet aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No hay cierres en estas fechas</p>
      <p className="max-w-[420px] text-xs leading-[1.5] text-muted-foreground">
        La caja se abre y se cierra desde Vender, con el chip de caja del encabezado. Cada cierre
        con su arqueo aparece acá.
      </p>
    </div>
  )
}

/**
 * /caja: el historial de cierres de caja, con su arqueo y sus movimientos
 * (spec docs/superpowers/specs/2026-10-18-arqueo-de-caja-design.md, decisión
 * 5).
 *
 * **Sólo el dueño** (`exigirDuenio`, como /dashboard): las diferencias de caja
 * de cada empleado son información de gestión. La pestaña es `soloDueno` en
 * components/navegacion.tsx, pero esconderla es sólo una de las puertas: la URL
 * se tipea, así que la página re-exige.
 *
 * La columna de dólares (de toda la pantalla) sólo si algún cierre del
 * período los tuvo: la misma regla que el panel de la caja.
 */
export default async function Caja({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string | string[]; hasta?: string | string[] }>
}) {
  const sesion = await exigirDuenio()
  const params = await searchParams
  const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const periodo = periodoDelFiltro({ desde: primero(params.desde), hasta: primero(params.hasta) }, hoyEnArgentina())

  const { cierres, hayMas } = await cierresDelPeriodo(sesion.tenant.id, periodo)
  const conDolares = cierres.some((c) => c.conDolares)

  return (
    <>
      <Encabezado
        titulo="Caja"
        subtitulo={
          periodo.dDesde === periodo.dHasta
            ? fechaLarga(periodo.dDesde)
            : `${fechaLarga(periodo.dDesde)} — ${fechaLarga(periodo.dHasta)}`
        }
      />
      <div className="flex flex-col gap-3 p-[14px] lg:gap-4 lg:p-6">
        <FiltroDeFechas dDesde={periodo.dDesde} dHasta={periodo.dHasta} />
        <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
            <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cierres de caja</h2>
            <span className="text-xs text-muted-foreground">
              {cierres.length === 1 ? '1 cierre' : `${cierres.length} cierres`}
            </span>
          </div>
          {hayMas && (
            <p className="border-b px-[14px] py-2.5 text-xs text-muted-foreground lg:px-[18px]">
              Se ven los {TOPE_DEL_HISTORIAL} más recientes: achicá el rango para ver el resto.
            </p>
          )}
          {cierres.length === 0 ? (
            <SinCierres />
          ) : (
            <ul className="flex flex-col divide-y">
              {cierres.map((c) => (
                <FilaDeCierre key={c.id} cierre={c} conDolares={conDolares} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
