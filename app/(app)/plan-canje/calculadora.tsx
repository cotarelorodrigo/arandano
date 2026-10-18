'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatearCantidad, montoSinSigno, precioEnSuMoneda } from '@/lib/formato/mostrar'
import {
  calcularCanje, leerBateria, rangoParaBateria, rotuloDeRango,
  type Monto, type ResultadoDeCanje,
} from '@/lib/canje/calculo'
import type { ModeloVisible, TablaDeCanje } from '@/lib/canje/consultar'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import { buscarEquipos } from './acciones'
import estilos from './tipografia.module.css'
import importe from '@/components/importe.module.css'

const ROTULO = 'text-[11px] font-semibold text-foreground-soft'
const ENLACE = 'text-xs font-semibold text-primary hover:underline'

/** Un monto en su moneda, listo para leer: `US$ 600,00`, `$ 1.000.000,00`. */
function mostrar(m: Monto): string {
  return precioEnSuMoneda(m.monto, m.moneda)
}

/**
 * El texto de "sin cotización", con el modelo y la batería que se consultaron.
 *
 * Nombra los dos datos y no dice "no hay valor": el vendedor se lo va a leer
 * al encargado tal cual, y "un iPhone 14 con 88 %" es lo que el encargado
 * necesita para contestar sin preguntar de nuevo. Nunca un error: es una
 * respuesta.
 */
export function textoSinCotizacion(modelo: string, bateria: number): string {
  return `Sin cotización cargada para un ${modelo} con ${bateria} % de batería. Consultá al encargado.`
}

/**
 * Lo que la banda de `--marca` dice arriba del número y abajo, según en qué
 * punto está la cuenta.
 *
 * La banda está SIEMPRE, incluso sin nada elegido —un ancla que aparece y
 * desaparece no es un ancla, la misma regla que la banda del total de
 * `/vender`—, y cuando todavía no hay número dice qué falta para que lo haya.
 */
export function leyendaDeLaBanda(resultado: ResultadoDeCanje | null): { rotulo: string; meta: string } {
  if (!resultado) return { rotulo: 'Paga el cliente', meta: 'Elegí el equipo, el usado y la batería.' }
  switch (resultado.tipo) {
    case 'SIN_COTIZACION':
      return { rotulo: 'Paga el cliente', meta: 'Ese usado no tiene valor cargado.' }
    case 'FALTA_DOLAR':
      return {
        rotulo: 'Paga el cliente',
        meta:
          resultado.motivo === 'FALTA'
            ? 'Falta la cotización del dólar: el equipo y la tabla están en monedas distintas.'
            : 'Esa cotización del dólar no se entiende.',
      }
    case 'CALCULADO':
      if (resultado.sentido === 'DEVUELVE_EL_LOCAL') {
        return { rotulo: 'Le devolvés al cliente', meta: 'El usado vale más que el equipo que se lleva.' }
      }
      if (resultado.sentido === 'NADA') return { rotulo: 'Paga el cliente', meta: 'El usado cubre el equipo justo.' }
      return { rotulo: 'Paga el cliente', meta: `${mostrar(resultado.precio)} menos el usado.` }
  }
}

/**
 * La banda de la diferencia: la ÚNICA superficie de `--marca` de esta
 * pantalla, alrededor del dato que la pantalla existe para mostrar —lo que el
 * cliente pone encima de su usado— (docs/sistema-de-diseno.md, "Un ancla de
 * contenido por pantalla"). El avatar del sidebar también pinta con `--marca`,
 * pero ancla quién está adentro, no el dato de ésta.
 *
 * Mismo markup y mismo rol tipográfico que la banda del total de `/vender`
 * (`components/importe.module.css`): es el mismo tipo de número —un importe
 * que se dice en voz alta del otro lado del mostrador— y dos tratamientos
 * para lo mismo se leerían como dos cosas distintas. bg/color con
 * `var(--token)` inline porque `--marca` y sus variantes no están en `@theme`.
 *
 * **La diferencia nunca se pinta negativa**: si el usado vale más, el rótulo
 * cambia a "Le devolvés al cliente" y el número sigue positivo.
 */
export function BandaDeDiferencia({ resultado }: { resultado: ResultadoDeCanje | null }) {
  const { rotulo, meta } = leyendaDeLaBanda(resultado)
  const diferencia = resultado?.tipo === 'CALCULADO' ? resultado.diferencia : null
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-[22px] py-5"
      style={{ backgroundColor: 'var(--marca)' }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10px] font-bold tracking-[1.4px] uppercase" style={{ color: 'var(--marca-soft)' }}>
          {rotulo}
        </span>
        {/* Rol "Meta" sobre la banda oscura: --marca-dim, igual que /vender. */}
        <span className="text-xs" style={{ color: 'var(--marca-dim)' }}>
          {meta}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className={importe.signo} style={{ color: 'var(--marca-soft)' }}>
          {diferencia ? (diferencia.moneda === 'USD' ? 'US$' : '$') : ''}
        </span>
        <span className={importe.total} style={{ color: 'var(--marca-foreground)' }} aria-live="polite">
          {diferencia ? montoSinSigno(mostrar(diferencia)) : '—'}
        </span>
      </div>
    </div>
  )
}

function Linea({ rotulo, valor, detalle }: { rotulo: string; valor: string; detalle?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px] text-foreground-soft">{rotulo}</span>
        {detalle && <span className="text-[11px] text-muted-foreground">{detalle}</span>}
      </div>
      <span className="shrink-0 text-[15px] font-semibold text-foreground tabular-nums">{valor}</span>
    </div>
  )
}

/**
 * La cuenta, con lo que el vendedor eligió. Separada de `Calculadora` para
 * poder probarla con `renderToStaticMarkup` en cada estado: el render inicial
 * de la calculadora —sin nada elegido— no pasa por ninguno de los
 * interesantes.
 *
 * Toda la aritmética es de `lib/canje/calculo.ts`; acá sólo se decide qué se
 * muestra.
 */
export function PanelDeResultado({
  tabla,
  equipo,
  modelo,
  bateriaTexto,
  dolar,
  alCambiarDolar,
}: {
  tabla: TablaDeCanje
  equipo: Pick<ArticuloVendible, 'nombre' | 'precio' | 'moneda'> | null
  modelo: ModeloVisible | null
  bateriaTexto: string
  dolar: string
  alCambiarDolar: (texto: string) => void
}) {
  const lectura = leerBateria(bateriaTexto)
  const rango = lectura.ok ? rangoParaBateria(tabla.rangos, lectura.bateria) : null
  const valor = modelo && rango ? modelo.valores[rango.id] : undefined

  const resultado =
    equipo && modelo && lectura.ok
      ? calcularCanje({
          precio: { monto: equipo.precio, moneda: equipo.moneda },
          valor: valor === undefined ? null : { monto: valor, moneda: tabla.moneda },
          dolar,
        })
      : null

  // El campo del dólar aparece sólo cuando hace falta: equipo y tabla en
  // monedas distintas y un valor que convertir. Con la misma moneda no existe,
  // y lo que se haya tipeado antes no entra en ninguna cuenta.
  const pideDolar = resultado?.tipo === 'FALTA_DOLAR' || (resultado?.tipo === 'CALCULADO' && resultado.dolar !== null)

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-[18px]">
      <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cuánto paga el cliente</h2>

      <div className="flex flex-col gap-3">
        <Linea
          rotulo="Precio del equipo"
          detalle={equipo?.nombre}
          valor={equipo ? precioEnSuMoneda(equipo.precio, equipo.moneda) : '—'}
        />
        <Linea
          rotulo="Se le reconoce por el usado"
          detalle={modelo && rango ? `${modelo.nombre}, ${rotuloDeRango(rango)} de batería` : modelo?.nombre}
          valor={resultado && resultado.tipo !== 'SIN_COTIZACION' ? mostrar(resultado.valor) : '—'}
        />
        {resultado?.tipo === 'CALCULADO' && resultado.dolar !== null && (
          <Linea
            rotulo={`El usado en ${resultado.precio.moneda === 'USD' ? 'dólares' : 'pesos'}`}
            detalle={`a ${precioEnSuMoneda(resultado.dolar, 'ARS')} el dólar`}
            valor={mostrar(resultado.valorEnMonedaDelEquipo)}
          />
        )}
      </div>

      {pideDolar && (
        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="dolar" className={ROTULO}>
            Cotización del dólar
          </Label>
          {/* Se tipea en cada consulta, como en /vender: no se precarga la del
              local ni la de la última vez. type="text" por la coma decimal. */}
          <Input
            id="dolar"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1250"
            value={dolar}
            onChange={(e) => alCambiarDolar(e.target.value)}
            aria-invalid={resultado?.tipo === 'FALTA_DOLAR' && resultado.motivo === 'ILEGIBLE'}
            className="h-10 rounded-[9px] tabular-nums"
          />
          <p className="text-[11px] text-muted-foreground">
            El equipo está en {resultado?.precio.moneda === 'USD' ? 'dólares' : 'pesos'} y la tabla en{' '}
            {tabla.moneda === 'USD' ? 'dólares' : 'pesos'}: la diferencia sale en la moneda del equipo.
          </p>
        </div>
      )}

      {resultado?.tipo === 'SIN_COTIZACION' && modelo && lectura.ok && (
        // Aviso y no error: es una respuesta del local ("no lo tomamos así",
        // o "todavía no lo cargué"), no algo que el vendedor hizo mal.
        <p role="status" className="rounded-xl border bg-muted px-[14px] py-3 text-[13px] leading-[1.45] text-foreground">
          {textoSinCotizacion(modelo.nombre, lectura.bateria)}
        </p>
      )}

      <BandaDeDiferencia resultado={resultado} />
    </div>
  )
}

/**
 * El equipo que se vende: la misma búsqueda que `/vender`, con el mismo
 * respiro de 200 ms entre teclas y la misma guarda contra la respuesta vieja
 * (`punto-de-venta.tsx`): si el cuadro ya no dice lo que decía cuando se
 * pidió, la respuesta se descarta. Sin eso, tipear rápido de "iphone 15" a
 * "iphone 16" podía dejar en la lista los resultados del 15.
 */
function BuscadorDeEquipo({
  elegido,
  alElegir,
}: {
  elegido: ArticuloVendible | null
  alElegir: (a: ArticuloVendible | null) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ArticuloVendible[]>([])
  const vigente = useRef('')

  useEffect(() => {
    const texto = busqueda.trim()
    if (texto === '') return
    const t = setTimeout(() => {
      // El `.catch` deja la lista como estaba: una búsqueda que falla (la
      // sesión venció, se cortó la red) no tiene nada mejor que mostrar, y
      // sin él el navegador registra un rechazo sin manejar.
      buscarEquipos(texto)
        .then((r) => {
          if (vigente.current.trim() === texto) setResultados(r)
        })
        .catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [busqueda])

  if (elegido) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[9px] border px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">{elegido.nombre}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {precioEnSuMoneda(elegido.precio, elegido.moneda)}
            {elegido.esProducto ? ` · stock ${formatearCantidad(elegido.stock)}` : ' · servicio'}
          </span>
        </div>
        <button
          type="button"
          aria-label="Elegir otro equipo"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          onClick={() => alElegir(null)}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="equipo"
          type="search"
          autoComplete="off"
          placeholder="iPhone 16, código o IMEI"
          value={busqueda}
          onChange={(e) => {
            const texto = e.target.value
            vigente.current = texto
            setBusqueda(texto)
            // El vaciado vive acá y no en el efecto: el lint del proyecto
            // rechaza un setState síncrono en el cuerpo de un efecto.
            if (texto.trim() === '') setResultados([])
          }}
          className="h-10 rounded-[9px] pl-9"
        />
      </div>
      {resultados.length > 0 && (
        <ul className="flex flex-col divide-y overflow-hidden rounded-[9px] border">
          {resultados.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                onClick={() => {
                  alElegir(a)
                  setBusqueda('')
                  vigente.current = ''
                  setResultados([])
                }}
              >
                <span className="min-w-0 truncate text-sm text-foreground">{a.nombre}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {precioEnSuMoneda(a.precio, a.moneda)}
                  {a.esProducto ? ` · stock ${formatearCantidad(a.stock)}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * La calculadora del plan canje. **No escribe nada**: lee la tabla que le
 * pasa la página y calcula en el navegador, con cada tecla, sin ir al servidor
 * más que para buscar el equipo.
 *
 * Tres preguntas en el orden en que se dan en el mostrador: qué se lleva, qué
 * deja, con cuánta batería.
 */
export function Calculadora({ tabla, puedeEditar }: { tabla: TablaDeCanje; puedeEditar: boolean }) {
  const [equipo, setEquipo] = useState<ArticuloVendible | null>(null)
  const [modeloId, setModeloId] = useState('')
  const [bateria, setBateria] = useState('')
  const [dolar, setDolar] = useState('')

  const modelo = tabla.modelos.find((m) => m.id === modeloId) ?? null
  const lectura = leerBateria(bateria)

  return (
    // Se apila en el teléfono; en `lg:` las preguntas a la izquierda y la
    // cuenta a la derecha, a la vista mientras se completa.
    <div className="flex flex-col gap-3 p-[14px] lg:flex-row lg:items-start lg:gap-4 lg:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border bg-card p-[18px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>La operación</h2>

        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="equipo" className={ROTULO}>
            1. El equipo que se lleva
          </Label>
          <BuscadorDeEquipo elegido={equipo} alElegir={setEquipo} />
        </div>

        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="modelo" className={ROTULO}>
            2. El usado que entrega
          </Label>
          {tabla.modelos.length === 0 ? (
            <SinModelos puedeEditar={puedeEditar} />
          ) : (
            <Select value={modeloId} onValueChange={setModeloId}>
              <SelectTrigger id="modelo" className="h-10! w-full rounded-[9px]">
                <SelectValue placeholder="Elegí el modelo" />
              </SelectTrigger>
              <SelectContent>
                {tabla.modelos.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex flex-col gap-[5px]">
          <Label htmlFor="bateria" className={ROTULO}>
            3. La batería del usado (%)
          </Label>
          {/* type="text" e inputMode numeric: "88 %" con el signo se acepta
              (`leerBateria`), y un input numérico lo borraría. */}
          <Input
            id="bateria"
            inputMode="numeric"
            autoComplete="off"
            placeholder="88"
            value={bateria}
            onChange={(e) => setBateria(e.target.value)}
            aria-invalid={bateria.trim() !== '' && !lectura.ok}
            aria-describedby="bateria-ayuda"
            className="h-10 w-full rounded-[9px] tabular-nums lg:w-[120px]"
          />
          <p id="bateria-ayuda" className="text-[11px] text-muted-foreground">
            {bateria.trim() !== '' && !lectura.ok
              ? lectura.mensaje
              : 'La que muestra el equipo en Ajustes › Batería › Estado.'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:w-[380px] lg:gap-4">
        <PanelDeResultado
          tabla={tabla}
          equipo={equipo}
          modelo={modelo}
          bateriaTexto={bateria}
          dolar={dolar}
          alCambiarDolar={setDolar}
        />
      </div>
    </div>
  )
}

/** Sin modelos cargados la calculadora no tiene qué cotizar, y lo dice con la
 *  salida que corresponde a quien la mira: el que puede, a la tabla; el que
 *  no, al encargado. */
export function SinModelos({ puedeEditar }: { puedeEditar: boolean }) {
  return (
    <p className="rounded-xl border bg-muted px-[14px] py-3 text-[13px] leading-[1.45] text-foreground">
      Todavía no hay valores cargados para ningún usado.{' '}
      {puedeEditar ? (
        <Link href="/plan-canje/valores" className={ENLACE}>
          Cargar la tabla
        </Link>
      ) : (
        'Pedile al encargado que cargue la tabla.'
      )}
    </p>
  )
}
