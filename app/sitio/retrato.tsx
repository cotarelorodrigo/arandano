'use client'

import { useState } from 'react'
import { AnimatePresence, useReducedMotion, type Transition } from 'motion/react'
import * as m from 'motion/react-m'
import { Minus, Plus, RotateCcw, TriangleAlert, X } from 'lucide-react'
import { formatearPrecio, formatearCantidad, montoSinSigno } from '@/lib/formato/mostrar'
import {
  LINEAS_INICIALES, MAXIMO_POR_LINEA, faltaStock, itemPorId,
  subtotalDeLinea, totalDeLineas, unidadesDeLineas, type Linea,
} from './carrito'
import estilos from '@/components/importe.module.css'
import tipografia from './tipografia.module.css'

/**
 * El producto, mostrado en vez de contado — y desde el rediseño de la landing,
 * TOCADO en vez de mostrado.
 *
 * QUÉ CAMBIÓ Y POR QUÉ. Hasta acá esto era un retrato: dos componentes de
 * servidor con datos fijos, sin un solo <button>, y un pie que aclaraba "no es
 * una captura". El problema es que la única forma de comprobar esa frase era
 * creerla. Ahora el carrito se opera: se suben y bajan cantidades, se saca una
 * línea, y el total se rehace con el MISMO formateo de plata que corre en
 * /vender (`lib/formato/mostrar.ts`). La promesa dejó de ser una afirmación y
 * pasó a ser algo que la persona comprueba en cinco segundos.
 *
 * Lo que NO reusa sigue siendo `app/(app)/vender/punto-de-venta.tsx`: ese
 * archivo depende del carrito real, de las server actions de cobro y del stock
 * de la base. Acá se reconstruye el marcado con los mismos componentes y clases
 * visuales, sobre datos fijos de `./carrito`.
 *
 * UN SOLO ÁRBOL PARA LOS DOS ANCHOS. Antes eran `Retrato` (tabla, escritorio) y
 * `RetratoMovil` (cards, teléfono), con el mismo dato renderizado dos veces en
 * el DOM de cada request. Ahora es uno solo: cada fila es un contenedor que
 * apila en el teléfono y pasa a `grid` con las columnas de /vender desde 1024.
 *
 * POR QUÉ NO `lg:contents`, que es el patrón del resto de la app. Un elemento
 * con `display: contents` no tiene caja, y sin caja no se puede animar su
 * salida — que es justamente lo que hace falta cuando se saca una línea. Las
 * filas usan entonces una grilla propia por fila, con la MISMA plantilla de
 * columnas que el encabezado; como cuatro de las cinco columnas miden píxeles
 * fijos, la alineación entre filas está garantizada igual. De paso no hay que
 * devolver a mano el fondo, el borde, el padding y el centrado vertical que
 * `display: contents` se lleva puestos.
 *
 * EL MOVIMIENTO, Y SU ÚNICO MOTIVO. `motion` entra por lo que el CSS no puede
 * hacer: animar la salida de un nodo que React está sacando del árbol. Una
 * transición de CSS necesita que el elemento exista, y cuando se saca una línea
 * ya no existe; `AnimatePresence` lo mantiene montado mientras colapsa. Ése es
 * el motivo que justifica la dependencia, y son dos los lugares donde aplica:
 * la fila que se va y el aviso de stock que aparece o desaparece. El resorte
 * del stepper (`whileTap`) es el tercero, y también es respuesta a una acción:
 * se encadena desde la velocidad actual, así que apretar cinco veces seguidas
 * se siente como cinco toques y no como cinco animaciones reiniciándose.
 *
 * Y EL TERCERO: la venta armándose al cargar. Las cuatro filas se asientan una
 * vez, escalonadas. Es el único movimiento de la página que no responde a una
 * acción, y por eso es uno solo y dura menos de medio segundo.
 *
 * CÓMO NO LE CUESTA NADA AL LCP, que es la objeción obvia en la única página
 * indexable del producto: la entrada anima SÓLO `transform`, nunca `opacity` ni
 * nada que ocupe layout. Las filas están pintadas y legibles desde el primer
 * frame —el navegador ya puede contarlas como contenido pintado— y lo único que
 * pasa es que llegan a su lugar desde 10 px más abajo. Una entrada que arranca
 * en `opacity: 0` sí habría empujado el LCP, y una que anima `height` habría
 * movido el layout; ninguna de las dos cosas ocurre acá.
 *
 * Vive en un envoltorio interno y no en el `<li>` porque ése ya tiene su propia
 * animación de presencia (la de salida, que sí anima `height`): dos animaciones
 * distintas sobre el mismo elemento se pisan.
 */

/** El resorte de las dos animaciones. Corto: es una respuesta a un click, no
 *  una transición de página, y arriba de ~200ms una lista que se reacomoda
 *  empieza a sentirse lenta en vez de suave. */
const TRANSICION: Transition = { duration: 0.18, ease: [0.32, 0.72, 0, 1] }

/** La entrada de cada fila al cargar: más larga que la salida —una entrada se
 *  mira, una salida se saca del medio— y escalonada por fila para que la venta
 *  se lea armándose de arriba hacia abajo. */
const ENTRADA = { duration: 0.42, ease: [0.16, 1, 0.3, 1] as const }
const ESCALON = 0.06

export function Retrato() {
  const [lineas, setLineas] = useState<Linea[]>(LINEAS_INICIALES)
  // El sistema pide no mover nada: con esto las dos animaciones pasan a durar
  // cero, así que la línea desaparece y el aviso aparece de una. Mismo criterio
  // que la persiana del login — sin movimiento, lo que queda tiene que ser una
  // pantalla correcta, no una a medio construir.
  const sinMovimiento = useReducedMotion()
  const transicion: Transition = sinMovimiento ? { duration: 0 } : TRANSICION

  const modificado =
    lineas.length !== LINEAS_INICIALES.length ||
    lineas.some((linea, indice) => linea.cantidad !== LINEAS_INICIALES[indice]?.cantidad)

  function cambiarCantidad(id: string, delta: number) {
    setLineas((previas) =>
      previas.map((linea) =>
        linea.id === id
          ? { ...linea, cantidad: Math.min(MAXIMO_POR_LINEA, Math.max(1, linea.cantidad + delta)) }
          : linea,
      ),
    )
  }

  function quitar(id: string) {
    setLineas((previas) => previas.filter((linea) => linea.id !== id))
  }

  const total = totalDeLineas(lineas)
  const unidades = unidadesDeLineas(lineas)

  return (
    <div className="w-full overflow-hidden rounded-[16px] border bg-card">
        <div className="flex items-center justify-between border-b px-[14px] py-[11px] lg:px-[18px]">
          <span className={`${tipografia.archivo} text-sm font-semibold text-foreground`}>Carrito</span>
          {modificado && (
            <button
              type="button"
              onClick={() => setLineas(LINEAS_INICIALES)}
              className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-xs font-semibold text-primary hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <RotateCcw aria-hidden="true" className="size-[13px]" />
              Reponer
            </button>
          )}
        </div>

        {/* El encabezado de columnas sólo existe donde hay columnas: abajo de
            1024 cada línea es una card apilada y no tendría a qué encabezar.

            `aria-hidden`: es un rótulo VISUAL de las columnas, no semántica de
            tabla. El carrito no se marca como `role="table"` justamente porque
            no lo es en los dos anchos —en el teléfono es una lista de cards— y
            un rol que sólo es cierto arriba de 1024 sería peor que ninguno.
            Lo que se marca es lo que sí es cierto siempre: una LISTA de líneas,
            cada una con su texto completo, así que quien no ve la pantalla
            escucha "Cargador 20W USB-C Baseus, SKU 000198, $ 37.000,00" y no
            una celda suelta sin encabezado que la explique. */}
        <div
          aria-hidden="true"
          className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_104px_110px_130px_28px] lg:items-center lg:bg-muted lg:px-[18px]"
        >
          <span className="px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Artículo
          </span>
          <span className="px-[7px] py-3 text-center text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Cantidad
          </span>
          <span className="px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Precio
          </span>
          <span className="px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
            Subtotal
          </span>
          {/* La columna de "Quitar" no lleva rótulo, igual que en /vender. */}
          <span className="px-[7px] py-3" />
        </div>

        <ul>
          <AnimatePresence initial={false}>
            {lineas.map((linea, indice) => (
              <Fila
                key={linea.id}
                linea={linea}
                indice={indice}
                transicion={transicion}
                sinMovimiento={Boolean(sinMovimiento)}
                onCambiar={cambiarCantidad}
                onQuitar={quitar}
              />
            ))}
          </AnimatePresence>
        </ul>

        {lineas.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-[14px] py-6 lg:px-[18px]">
            <p className="text-sm text-foreground-soft">No queda nada para cobrar.</p>
            <button
              type="button"
              onClick={() => setLineas(LINEAS_INICIALES)}
              className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-xs font-semibold text-primary hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <RotateCcw aria-hidden="true" className="size-[13px]" />
              Reponer la venta
            </button>
          </div>
        )}

        {/* La banda del total: color de marca sólido vía var(), el signo "$"
            como elemento propio separado del monto, cada uno con su rol
            tipográfico. `aria-live`: el total es la consecuencia de lo que la
            persona acaba de tocar, y quien no ve la pantalla necesita
            enterarse de que cambió. */}
        <div
          className="flex items-center justify-between px-4 py-[14px] lg:px-[22px] lg:py-5"
          style={{ backgroundColor: 'var(--marca)' }}
          aria-live="polite"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-bold tracking-[1.4px] uppercase" style={{ color: 'var(--marca-soft)' }}>
              Total
            </span>
            <span className="text-xs" style={{ color: 'var(--marca-dim)' }}>
              {lineas.length} {lineas.length === 1 ? 'artículo' : 'artículos'} · {unidades}{' '}
              {unidades === 1 ? 'unidad' : 'unidades'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={estilos.signo} style={{ color: 'var(--marca-soft)' }}>
              $
            </span>
            <span className={estilos.total} style={{ color: 'var(--marca-foreground)' }}>
              {montoSinSigno(formatearPrecio(total))}
            </span>
          </div>
      </div>
    </div>
  )
}

function Fila({
  linea,
  indice,
  transicion,
  sinMovimiento,
  onCambiar,
  onQuitar,
}: {
  linea: Linea
  indice: number
  transicion: Transition
  sinMovimiento: boolean
  onCambiar: (id: string, delta: number) => void
  onQuitar: (id: string) => void
}) {
  const item = itemPorId(linea.id)
  const sinStock = faltaStock(linea)

  return (
    <m.li
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={transicion}
      className="overflow-hidden border-b last:border-b-0"
    >
      <m.div
        // Sólo `transform`: ver el docblock del archivo. La fila está pintada
        // desde el primer frame y llega a su lugar desde 10 px más abajo.
        initial={sinMovimiento ? false : { y: 10 }}
        animate={{ y: 0 }}
        transition={{ ...ENTRADA, delay: indice * ESCALON }}
        className="flex flex-col gap-2 p-[11px] px-[14px] lg:grid lg:grid-cols-[minmax(0,1fr)_104px_110px_130px_28px] lg:items-center lg:gap-0 lg:px-[18px] lg:py-0"
      >
        <div className="flex items-center gap-[10px] lg:block lg:px-[7px] lg:py-[11px]">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.descripcion}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                {item.sku ? `SKU ${item.sku}` : 'Servicio'}
                <span className="lg:hidden"> · {formatearPrecio(item.precio)} c/u</span>
              </span>
              <AvisoDeStock visible={sinStock} transicion={transicion} />
            </div>
          </div>
          {/* La copia del teléfono de "quitar": arriba a la derecha de la card,
              donde el pulgar la alcanza. Desde 1024 la de la columna propia. */}
          <BotonQuitar item={item.descripcion} onQuitar={() => onQuitar(linea.id)} className="lg:hidden" />
        </div>

        <div className="flex items-center gap-[10px] lg:contents">
          <div className="lg:px-[7px] lg:py-[11px]">
            <div className="flex h-[34px] w-[106px] items-center rounded-[9px] bg-muted lg:h-9 lg:w-[104px] lg:border lg:border-input lg:bg-transparent">
              <BotonDeCantidad
                icono={Minus}
                rotulo={`Restar una unidad de ${item.descripcion}`}
                deshabilitado={linea.cantidad <= 1}
                onClick={() => onCambiar(linea.id, -1)}
              />
              <span
                className={`flex h-full flex-1 items-center justify-center text-center font-semibold text-foreground ${estilos.importe}`}
              >
                {formatearCantidad(String(linea.cantidad))}
              </span>
              <BotonDeCantidad
                icono={Plus}
                rotulo={`Sumar una unidad de ${item.descripcion}`}
                deshabilitado={linea.cantidad >= MAXIMO_POR_LINEA}
                onClick={() => onCambiar(linea.id, 1)}
              />
            </div>
          </div>

          {/* El precio unitario tiene columna propia sólo en escritorio; en el
              teléfono viaja al lado del SKU, que es donde lo pone la maqueta. */}
          <span
            className={`hidden text-right text-foreground-soft lg:block lg:px-[7px] lg:py-[11px] ${estilos.importe}`}
          >
            {formatearPrecio(item.precio)}
          </span>

          <span
            className={`ml-auto text-[15px] font-semibold text-foreground lg:px-[7px] lg:py-[11px] lg:text-right ${estilos.importe}`}
          >
            {formatearPrecio(subtotalDeLinea(linea))}
          </span>

          <div className="hidden lg:block lg:py-[11px] lg:pl-[7px] lg:text-right">
            <BotonQuitar item={item.descripcion} onQuitar={() => onQuitar(linea.id)} className="ml-auto" />
          </div>
        </div>
      </m.div>
    </m.li>
  )
}

function AvisoDeStock({
  visible,
  transicion,
}: {
  visible: boolean
  transicion: Transition
}) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <m.span
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={transicion}
          className="flex items-center gap-[5px] rounded-md bg-warn-soft px-[7px] py-[2px] text-[10px] font-semibold text-warn"
        >
          <TriangleAlert aria-hidden="true" className="size-[11px]" />
          sin stock suficiente
        </m.span>
      )}
    </AnimatePresence>
  )
}

function BotonDeCantidad({
  icono: Icono,
  rotulo,
  deshabilitado,
  onClick,
}: {
  icono: typeof Minus
  rotulo: string
  deshabilitado: boolean
  onClick: () => void
}) {
  return (
    // `whileTap` y no una transición de CSS: el resorte de motion se encadena
    // desde la velocidad actual, así que apretar cinco veces seguidas se siente
    // como cinco toques y no como cinco animaciones reiniciándose. Es la mitad
    // del stepper que el CSS no da.
    <m.button
      type="button"
      aria-label={rotulo}
      disabled={deshabilitado}
      onClick={onClick}
      whileTap={deshabilitado ? undefined : { scale: 0.82 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      className="flex h-full w-8 items-center justify-center rounded-[9px] text-foreground-soft hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40"
    >
      <Icono aria-hidden="true" className="size-[13px]" />
    </m.button>
  )
}

function BotonQuitar({
  item,
  onQuitar,
  className = '',
}: {
  item: string
  onQuitar: () => void
  className?: string
}) {
  return (
    <m.button
      type="button"
      aria-label={`Quitar ${item} del carrito`}
      onClick={onQuitar}
      whileTap={{ scale: 0.85 }}
      transition={{ type: 'spring', stiffness: 700, damping: 30 }}
      className={`flex size-[26px] shrink-0 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none lg:size-7 ${className}`}
    >
      <X aria-hidden="true" className="size-[15px]" />
    </m.button>
  )
}
