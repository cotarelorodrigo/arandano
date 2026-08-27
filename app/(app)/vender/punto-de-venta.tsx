'use client'

import { Fragment, useActionState, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleAlert, Minus, Plus, ScanBarcode, TriangleAlert, X } from 'lucide-react'
import { cobrar, buscarArticulos, type EstadoCobro } from './acciones'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import {
  aCentavos, aMilesimas, cantidadEnMilesimas, cotizacionEnDiezMilesimas, deCentavos,
  deMilesimas, dineroEnCentavos, pesosDePagoEnCentavos, porcentajeEnMilesimas,
  recargoEnCentavos, subtotalEnCentavos, totalDePagosEnCentavos, totalEnCentavos,
} from '@/lib/ventas/centavos'
// De TIPO y no de valor: `lib/planes/consultar.ts` importa Prisma, y un import
// de valor desde este archivo —que lleva 'use client'— arrastraría `pg` al
// bundle del navegador. Mismo caso que `ArticuloVendible`, y lo que vigila
// test/limite-cliente-servidor.test.ts.
import type { PlanVisible } from '@/lib/planes/consultar'
import { formatearPrecio, formatearCantidad, montoSinSigno } from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import estilos from '@/components/importe.module.css'
import estilosCobro from './cobro.module.css'

const INICIAL: EstadoCobro = { error: null, venta: null }

type Linea = {
  articuloId: string
  sku: string
  descripcion: string
  precio: string
  stock: string
  esProducto: boolean
  // Lo que la persona tipeó, tal cual: se parsea al calcular y se manda como
  // texto, que es lo que el server action espera.
  cantidad: string
}

type Pago = {
  medio: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_DEBITO' | 'TARJETA_CREDITO'
  moneda: 'ARS' | 'USD'
  // Lo que este pago cubre de la venta, a precio de lista. Se rotula "Monto"
  // en pantalla y es lo que viaja al servidor; el monto que entra a la caja lo
  // calcula el motor sumándole el recargo del plan (`lib/ventas/crear.ts`).
  base: string
  cotizacion: string
  // Sólo UI: con cuánto paga el cliente, para calcular el vuelto. NO se manda
  // al servidor y NO se guarda — el pago que entra a la caja es el monto, no
  // lo que el cliente apoyó sobre el mostrador.
  recibido: string
  // El plan con el que se cobra ESTA parte, o null para precio de lista. Sólo
  // puede tener valor un pago del medio del plan y en pesos: el motor rechaza
  // lo demás (PLAN_NO_CORRESPONDE, PLAN_EN_DOLARES), así que la fila lo limpia
  // en cuanto cambia el medio o la moneda.
  planId: string | null
}

/**
 * El valor del ítem "Precio de lista" del selector de plan.
 *
 * Un centinela y NO la cadena vacía: Radix reserva `''` para "sin selección" y
 * un `SelectItem` con `value=""` tira en runtime. Nunca viaja al servidor — la
 * fila lo traduce a `null` antes de tocar el estado, y el JSON escondido manda
 * `undefined`, que `JSON.stringify` descarta.
 */
const SIN_PLAN = 'sin-plan'

/**
 * Qué carrito es éste, para la clave de idempotencia.
 *
 * Artículos y cantidades, que es lo que define la venta; el orden cuenta, y
 * está bien que cuente: reordenar es un cambio del carrito como cualquier otro
 * y lo único que provoca es una clave nueva.
 */
function firmaDelCarrito(lineas: Linea[]): string {
  return JSON.stringify(lineas.map((l) => [l.articuloId, l.cantidad]))
}

// La firma del carrito vacío, que es con lo que arranca la pantalla. Como
// constante y no calculada al vuelo: es el valor inicial del estado, y tiene
// que ser el MISMO en el render del servidor y en el del navegador.
const CARRITO_VACIO = firmaDelCarrito([])

/**
 * Un paso del stepper de cantidad: +1 o -1 unidad completa (1000 milésimas),
 * el mismo incremento que ya usa `agregar()` al reescanear un artículo
 * repetido.
 *
 * Exportada (y no interna) porque es la única forma de probar la aritmética
 * del stepper de verdad: este archivo se testea con `renderToStaticMarkup`
 * (sin jsdom ni fireEvent, ver la nota de `ticket.test.tsx`), que no ejecuta
 * handlers de clic. Llamar la función pura es lo que reemplaza a "apretar el
 * botón" en ese harness.
 *
 * Si lo tipeado no se entiende (NaN) el paso no hace nada: pisarlo con
 * basura sería peor que dejar la línea como está, mismo criterio que ya usa
 * `agregar()` con una cantidad a medio tipear. Restar tampoco baja de cero:
 * una cantidad negativa no significa nada acá, y sacar la línea entera es el
 * trabajo del botón "quitar" (el ícono x), no de este stepper.
 */
export function pasoDeCantidad(cantidad: string, delta: 1 | -1): string {
  const actual = cantidadEnMilesimas(cantidad)
  if (Number.isNaN(actual)) return cantidad
  return deMilesimas(Math.max(0, actual + delta * 1000))
}

/**
 * Los dos botones del stepper de cantidad, como DATO y no como dos bloques
 * JSX casi idénticos escritos a mano.
 *
 * La review de esta task encontró el motivo de que sea un array: con dos
 * <button> separados —cada uno con su propio `-1`/`1` tipeado al lado—,
 * invertir el signo de uno solo (el "−" suma, el "+" resta) es un cambio de
 * una palabra que ningún test atrapaba, porque `pasoDeCantidad` se probaba
 * aislada y nunca importaba QUÉ botón le pasa qué `delta`. Con el cableado
 * reducido a este array y renderizado con un `.map()` (ver más abajo), el
 * único lugar donde el signo se puede romper es ACÁ, y
 * `punto-de-venta.test.tsx` lo prueba directo, sin jsdom.
 */
export const PASOS_STEPPER: { verbo: string; delta: 1 | -1; Icono: typeof Minus }[] = [
  { verbo: 'Restar', delta: -1, Icono: Minus },
  { verbo: 'Sumar', delta: 1, Icono: Plus },
]

/**
 * Si esta tecla es el atajo que enfoca el buscador (F2), y ninguna otra.
 *
 * Extraída como función pura —sin tocar `buscador.current` ni el DOM—
 * porque es la ÚNICA parte del listener de F2 que se puede probar sin
 * jsdom, que este repo no tiene (ver la nota de `ticket.test.tsx`, que
 * explica por qué ese archivo tampoco lo necesita). `punto-de-venta.test.tsx`
 * prueba esta función.
 *
 * Lo que ESE test NO cubre, para que no se lea como cobertura completa: que
 * el listener esté realmente enganchado a `window`, que dispare
 * `preventDefault()`, y que `buscador.current?.focus()` mueva el foco de
 * verdad — eso es el cableado del `useEffect` de abajo, y sin jsdom no hay
 * forma de simular un `keydown` real ni de leer qué elemento quedó
 * enfocado. Si algún día ese cableado se rompe (el listener se desengancha,
 * o deja de llamar a `.focus()`), esta función seguiría en verde: prueba la
 * REGLA ("¿es F2?"), no el efecto de apretarla.
 */
export function esAtajoDeBuscador(tecla: string): boolean {
  return tecla === 'F2'
}

/**
 * Si esta tecla es el atajo que cobra (Enter), y ninguna otra.
 *
 * Sola no alcanza para decidir si el atajo TIENE que disparar — eso lo
 * completa `puedeDispararCobroDesdeFoco`, la otra mitad de la regla, separada
 * porque prueba algo distinto: ésta mira la tecla, aquélla mira dónde está
 * el foco.
 */
export function esAtajoDeCobro(tecla: string): boolean {
  return tecla === 'Enter'
}

/**
 * Si el foco en un elemento con esta etiqueta deja pasar el atajo global de
 * Enter-para-cobrar.
 *
 * ALLOW-LIST y no deny-list — cambiado en la revisión final del rediseño,
 * porque la deny-list original (negar INPUT/TEXTAREA/SELECT/BUTTON) tenía un
 * defecto de runtime real: afirmaba que "los selects de medio/moneda ya se
 * activan solos con Enter", cierto mientras eran `<select>` nativos, pero
 * FALSO desde que pasaron a `Select` de shadcn (Radix, ver
 * docs/pantallas.md). Radix no renderiza ningún `<select>` — el trigger es
 * un `<button>` y cada opción del popup abierto es un `<div role="option">`,
 * así que 'SELECT' quedó negando algo que ya no existe en esta pantalla, y
 * el `<div>` con el foco (la opción resaltada de un dropdown abierto)
 * quedaba FUERA de la lista negada. Con el foco ahí, apretar Enter elegía la
 * opción en Radix Y —en el mismo evento, porque ni `@radix-ui/react-select`
 * ni `DismissableLayer` cortan la propagación hacia `window`— disparaba el
 * atajo global con el medio/moneda TODAVÍA no actualizado en el estado de
 * React: cobraba la venta con el medio o la moneda anteriores. Verificado en
 * runtime, no sólo leído.
 *
 * La regla ahora es la inversa: el atajo sólo dispara con el foco en
 * `BODY`, o sin ningún elemento enfocado — exactamente donde Enter no
 * significa nada para NADIE más. Cualquier OTRO tagName se abstiene,
 * incluidos los que ya cambiaron de primitiva una vez (SELECT → Radix) y los
 * que puedan volver a cambiar. Una allow-list no se rompe cuando un
 * componente cambia de primitiva; una deny-list sí, que es exactamente lo
 * que acaba de pasar acá.
 *
 * Esto sigue resolviendo, SIN un caso especial para el buscador, el
 * requisito puntual de la task ("Enter no puede cobrar mientras el foco está
 * en el buscador, ahí Enter agrega el artículo"): el buscador es un INPUT
 * con foco propio, así que nunca es `BODY`.
 *
 * No es la única defensa: el listener global también se abstiene ENTERO
 * mientras haya un overlay de Radix abierto (ver `hayOverlayDeRadixAbierto`,
 * más abajo) — esa guarda cubre el caso general (cualquier tecla, cualquier
 * overlay); ésta cubre el caso puntual de Enter incluso cuando el foco quedó
 * en otro control que no es un overlay (el trigger ya cerrado, un botón de
 * la cinta, etc.).
 */
export function puedeDispararCobroDesdeFoco(etiqueta: string | undefined): boolean {
  return etiqueta === undefined || etiqueta === 'BODY'
}

/**
 * Si esta tecla es el atajo que arma/confirma el vaciado del carrito (Esc), y
 * ninguna otra.
 */
export function esAtajoDeVaciar(tecla: string): boolean {
  return tecla === 'Escape'
}

/**
 * "N artículos · N unidades" de la banda del total, con el singular que le
 * corresponde a cada mitad — en castellano cero y "muchos" comparten el
 * plural, así que 1 es la única excepción en los dos casos (mismo criterio ya
 * usado en `app/(app)/inventario/page.tsx` para "N artículos").
 *
 * Exportada por el mismo motivo que `pasoDeCantidad` y `esAtajoDeBuscador`:
 * este archivo se testea con `renderToStaticMarkup` sobre el carrito VACÍO
 * (ver la nota de `render()` en el test), así que un carrito con líneas de
 * verdad —4 artículos, 5 unidades— nunca llega a renderizarse ahí. Llamar la
 * función directo es lo único que prueba la pluralización con un carrito no
 * vacío.
 */
export function resumenDelCarrito(articulos: number, unidadesMilesimas: number): string {
  const unidadesTexto = formatearCantidad(deMilesimas(unidadesMilesimas))
  const arts = articulos === 1 ? '1 artículo' : `${articulos} artículos`
  const unids = unidadesTexto === '1' ? '1 unidad' : `${unidadesTexto} unidades`
  return `${arts} · ${unids}`
}

/**
 * Las unidades totales del carrito, en milésimas: la suma de cantidades de
 * TODAS las líneas, no la cantidad de líneas (eso ya lo da `lineas.length`,
 * el otro término de `resumenDelCarrito`). Una línea inválida (NaN) suma 0
 * acá — no puede envenenar el conteo entero, a diferencia de `totalCentavos`,
 * que si es el precio de esa línea el que importa se vuelve "—" más abajo.
 *
 * Extraída como función pura por el mismo motivo que `resumenDelCarrito`
 * arriba: la review final de esta task encontró que forzar este resultado a
 * una constante (0), escrito inline en el cuerpo del componente sin nombre
 * propio, dejaba los tests de entonces en verde — el cableado que SÍ se
 * probaba (`resumenDelCarrito(lineas.length, unidadesMilesimas)`, el caso de
 * abajo) sigue intacto aunque la cuenta de adentro esté rota, porque ese
 * caso nunca mira DE DÓNDE sale el segundo argumento.
 */
export function unidadesDelCarrito(enCentavos: { cantidadMilesimas: number }[]): number {
  return enCentavos.reduce((acc, l) => acc + (Number.isNaN(l.cantidadMilesimas) ? 0 : l.cantidadMilesimas), 0)
}

/**
 * Cuántos pesos entran por un pago en dólares, para el renglón "Entran $X"
 * que sólo se muestra bajo un pago en USD (design/arandano.pen, nodo
 * `OTlAa`).
 *
 * Reusa `pesosDePagoEnCentavos` (lib/ventas/centavos.ts) —el mismo cálculo
 * que ata el total de la venta contra la suma de los pagos— en vez de
 * reinventar "monto × cotización" a mano acá: son los mismos centavos que el
 * motor ya suma para decidir si la venta cierra, y escribir la cuenta dos
 * veces es la forma en que este archivo se desincronizaría de esa cuenta sin
 * que ningún test lo note.
 */
export function entranPesosCentavos(montoUsd: string, cotizacion: string): number {
  return pesosDePagoEnCentavos(dineroEnCentavos(montoUsd), cotizacionEnDiezMilesimas(cotizacion))
}

/**
 * Los planes que UN pago puede elegir: los de su medio, y sólo si es en pesos.
 *
 * Las dos mitades son la misma regla —no ofrecer lo que el servidor va a
 * rechazar—, con dos códigos distintos del motor detrás: un plan de otro medio
 * es `PLAN_NO_CORRESPONDE` y cualquier plan sobre un pago en dólares es
 * `PLAN_EN_DOLARES` (`lib/ventas/crear.ts`). Un selector que ofrezca
 * cualquiera de las dos cosas es un selector que ofrece un error.
 *
 * Función pura y exportada por el mismo motivo que `hayFaltanteDeVenta` o
 * `unidadesDelCarrito`: un filtro escrito inline en el JSX se puede invertir
 * —o perder una de las dos mitades— sin que ningún caso de render lo note,
 * porque este harness sólo llega a montar el pago en efectivo y en pesos que
 * arranca solo.
 */
export function planesOfrecidos(
  pago: { medio: Pago['medio']; moneda: Pago['moneda'] },
  planes: PlanVisible[],
): PlanVisible[] {
  if (pago.moneda !== 'ARS') return []
  return planes.filter((p) => p.medio === pago.medio)
}

/** Un importe del pie, con la misma guarda de NaN que el resto de la plata de
 *  esta pantalla: un monto a medio tipear deja la cuenta en NaN, y
 *  `formatearPrecio(NaN)` imprime "$ NaN". */
function montoDelPie(centavos: number): string {
  return Number.isNaN(centavos) ? '—' : formatearPrecio(deCentavos(centavos))
}

/**
 * Las tres líneas del pie del panel de cobro —Mercadería, Recargo y Total a
 * cobrar—, o ninguna cuando no hay ningún plan elegido: sin recargo el pie no
 * crece y la pantalla queda exactamente como estaba.
 *
 * **La banda de `--marca` sigue mostrando la MERCADERÍA**, que es el ancla de
 * contenido de esta pantalla y el número contra el que se reparten los pagos.
 * El total a cobrar vive acá, en el panel donde se decide cuánta plata entra.
 *
 * **El total a cobrar es mercadería + recargo**, no la suma de los pagos: es
 * lo que va a entrar a la caja cuando la venta cierre, y sale del mismo número
 * que la banda de arriba en vez de una segunda cuenta que pueda decir otra
 * cosa.
 *
 * El recargo se calcula con `recargoEnCentavos` y `porcentajeEnMilesimas`
 * (`lib/ventas/centavos.ts`), que son el espejo exacto de `recargoDePago` del
 * servidor —`centavos.test.ts` compara las dos aritméticas caso por caso—, y
 * no con una cuenta propia: un porcentaje aplicado dos veces de dos formas es
 * la manera de que el pie diga un número y el motor cobre otro. Sobre la BASE
 * ya convertida a pesos, igual que el servidor, que sólo acepta plan con
 * cotización 1.
 *
 * Un recargo en NaN (monto a medio tipear) NO esconde el pie: `NaN !== 0`, así
 * que las tres líneas siguen ahí con "—" donde no se puede calcular. Esconder
 * el bloque entero mientras se retipea un monto haría parpadear tres líneas en
 * cada tecla.
 */
export function lineasDelPieDeCobro(
  mercaderiaCentavos: number,
  pagos: { base: string; cotizacion: string; planId: string | null }[],
  planes: PlanVisible[],
): { rotulo: string; monto: string }[] {
  const conPlan = pagos.flatMap((p) => {
    const plan = planes.find((pl) => pl.id === p.planId)
    return plan ? [{ pago: p, plan }] : []
  })
  const recargoCentavos = conPlan.reduce(
    (acc, { pago, plan }) =>
      acc +
      recargoEnCentavos(
        entranPesosCentavos(pago.base, pago.cotizacion),
        porcentajeEnMilesimas(plan.porcentaje),
      ),
    0,
  )
  if (recargoCentavos === 0) return []

  // Con UN solo plan elegido el rótulo lo nombra ("Recargo 3 cuotas"): un
  // "Recargo" pelado no dice de qué recargo habla. Con dos planes distintos el
  // número es la suma de los dos, así que nombrar a uno sería atribuirle un
  // recargo que no es suyo.
  const nombres = [...new Set(conPlan.map(({ plan }) => plan.nombre))]
  return [
    { rotulo: 'Mercadería', monto: montoDelPie(mercaderiaCentavos) },
    { rotulo: nombres.length === 1 ? `Recargo ${nombres[0]}` : 'Recargo', monto: montoDelPie(recargoCentavos) },
    { rotulo: 'Total a cobrar', monto: montoDelPie(mercaderiaCentavos + recargoCentavos) },
  ]
}

/**
 * Si UN pago puede mostrar su chip de vuelto, dado el estado de PAGO
 * agregado de toda la venta.
 *
 * Vuelto y faltante son estados excluyentes a propósito, y hasta esta task
 * nada lo garantizaba: mostrar "te sobran $10.000" en un pago en efectivo
 * mientras la VENTA completa sigue corta —porque hay otro pago insuficiente
 * al lado— le dice al cajero que dé vuelto sobre una venta que en conjunto no
 * cerró. `hayFaltante` tiene que venir calculado sobre TODOS los pagos
 * (`faltanCentavos > 0`, ver el cuerpo de `PuntoDeVenta`), no sobre éste
 * solo — por eso es un parámetro y no algo que esta función recalcule.
 */
export function puedeMostrarVuelto(esEfectivoArs: boolean, hayFaltante: boolean): boolean {
  return esEfectivoArs && !hayFaltante
}

/**
 * Si la VENTA completa tiene faltante, dado cuánto falta en centavos.
 *
 * NaN (un monto a medio tipear en CUALQUIER pago) cuenta como "sí hay
 * faltante" — "no se sabe si cierra" no es licencia para mostrarle vuelto a
 * nadie, mismo criterio conservador que ya usa `hayLineaInvalida` en el
 * cuerpo de `PuntoDeVenta`.
 *
 * Extraída como función pura por el mismo motivo que `pasoDeCantidad` o
 * `resumenDelCarrito` más arriba: la review final de esta task encontró que
 * invertir esta cuenta a mano (adentro del cuerpo del componente, sin
 * nombre propio) dejaba los tests de entonces en verde — nada la probaba
 * aislada, y el cableado que SÍ se probaba (`hayFaltante={hayFaltante}`, más
 * abajo) sigue intacto aunque la cuenta de adentro esté invertida.
 */
export function hayFaltanteDeVenta(faltanCentavos: number): boolean {
  return Number.isNaN(faltanCentavos) || faltanCentavos > 0
}

/**
 * Si hay algún overlay de Radix abierto ahora mismo: el listbox de un
 * `Select` desplegado, un dialog o un menu. Los tres primitivos comparten el
 * mismo defecto (ver el comentario largo de `puedeDispararCobroDesdeFoco` y
 * el del efecto que llama a esta función): ninguno corta la propagación del
 * evento hacia `window`, así que el listener global de esta pantalla ve el
 * mismo Enter/Escape que Radix ya está atendiendo. La salida no es adivinar
 * qué tecla hace qué cosa en cada primitivo — es que el listener se
 * ABSTENGA por completo mientras el overlay siga montado.
 *
 * `[role="listbox"]` (y análogos) sólo existen en el DOM mientras el overlay
 * está DESPLEGADO: `SelectContent` de `@radix-ui/react-select` se monta con
 * `<Presence present={context.open}>` y se DESMONTA al cerrar —no lo oculta
 * con `display:none` ni con un atributo `data-state="closed"` que quedara
 * dando vueltas—, así que alcanza con preguntarle al DOM en cada tecla, sin
 * guardar estado propio por cada `SelectContent` de la pantalla (la tercera
 * opción que la review consideró, y la que este archivo NO eligió).
 *
 * SIN TEST: usa `document`, que es DOM real (ver la nota del efecto que la
 * llama). Se verificó en runtime con un test de jsdom escrito para esta
 * task y borrado después de confirmar — el resultado queda en el reporte
 * final, no acá.
 */
function hayOverlayDeRadixAbierto(): boolean {
  return document.querySelector('[role="listbox"], [role="dialog"], [role="menu"]') !== null
}

export function PuntoDeVenta({
  cotizacionInicial,
  planes,
}: {
  cotizacionInicial: string | null
  // Los planes ACTIVOS del local, leídos en el servidor (`page.tsx`) por lo
  // mismo que la cotización: el cliente no consulta la base. Vacío es el caso
  // normal de un local que no cargó ninguno, y entonces la pantalla no dibuja
  // un solo control nuevo.
  planes: PlanVisible[]
}) {
  const [estado, accion, cobrando] = useActionState(cobrar, INICIAL)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ArticuloVendible[]>([])
  // Una clave por CARRITO, no por formulario: se renueva cuando cambia lo que
  // se está vendiendo (ver el ajuste de más abajo). Atarla a la vida del
  // componente —renovarla sólo al cobrar bien— tenía un modo de falla que es
  // el espejo del que la clave existe para evitar: si la respuesta del cobro
  // se pierde en el camino, quien cobra no ve el cartel de éxito, agrega el
  // artículo que faltaba y vuelve a apretar Cobrar con la misma clave; el
  // motor devuelve la venta ANTERIOR, la pantalla dice "cobrada" y el artículo
  // agregado no se cobró ni se descontó del stock. Un carrito distinto es una
  // venta distinta. El doble click y el F5 no cambian el carrito, así que
  // siguen cubiertos.
  //
  // Arranca vacía —y no con un uuid— para que el render del servidor y el del
  // navegador coincidan: `crypto.randomUUID()` en el estado inicial daba dos
  // valores distintos. Con el carrito vacío no hay nada que cobrar, así que
  // una clave vacía nunca llega a enviarse.
  const [clave, setClave] = useState('')
  const [carritoReflejado, setCarritoReflejado] = useState(CARRITO_VACIO)
  // La última venta ya procesada por la limpieza de abajo, para no repetirla
  // en cada render.
  const [ventaProcesada, setVentaProcesada] = useState<string | null>(null)
  const [pagos, setPagos] = useState<Pago[]>([])
  // El último total que los pagos ya reflejaron, para el ajuste de más abajo:
  // sin esto, "seguir el total" se repetiría en cada render y pisaría un monto
  // que la persona ya tocó a mano.
  const [totalReflejado, setTotalReflejado] = useState<number | null>(null)
  const buscador = useRef<HTMLInputElement>(null)
  // La búsqueda vigente, para que la respuesta de una búsqueda vieja no pueda
  // pisar la de una más nueva: `clearTimeout` cancela el TIMER si `busqueda`
  // cambió antes de los 200ms, pero no puede cancelar una promesa que ya está
  // en vuelo. Se actualiza en un efecto sin dependencias (corre después de
  // cada render) para no repetir el mismo lint que ya se peleó en el efecto
  // de abajo: mutar un ref no es un setState.
  const busquedaVigente = useRef(busqueda)
  useEffect(() => {
    busquedaVigente.current = busqueda
  })
  // Guarda de reentrada para el Enter del buscador. Sin estado a propósito:
  // no hay que re-renderizar por esto, y un ref no entra en las reglas de
  // set-state que este archivo ya tuvo que esquivar.
  const consultando = useRef(false)
  // El <form> de Cobro, para que el atajo global de Enter pueda dispararlo
  // desde CUALQUIER parte de la pantalla (no sólo con el foco adentro del
  // form) sin duplicar la lógica de envío: `requestSubmit()` es el mismo
  // camino que ya usa el botón, con la misma validación de campos.
  const formularioCobro = useRef<HTMLFormElement>(null)
  // Si el primer Esc ya armó la confirmación de vaciado, esperando el
  // segundo. Ver el comentario largo en el useEffect de abajo para el
  // porqué de dos pasos.
  const [vaciadoArmado, setVaciadoArmado] = useState(false)
  // El timer que desarma la confirmación sola, para que un Esc de hace un
  // rato no quede "cargado" esperando un segundo Esc que ya no tiene que ver
  // con el primero.
  const desarmarVaciado = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Buscar mientras se tipea, con un respiro para no pegarle al servidor en
  // cada tecla. 200ms es lo que separa "tipeando" de "terminó de tipear". El
  // vaciado cuando el texto queda vacío vive en `alCambiarBusqueda`, no acá:
  // el lint del proyecto (react-hooks/set-state-in-effect) rechaza un setState
  // síncrono en el cuerpo de un efecto.
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto === '') return
    const t = setTimeout(() => {
      buscarArticulos(texto).then((r) => {
        // Sólo se acepta si el cuadro sigue diciendo lo mismo que cuando se
        // pidió esta búsqueda. Sin esto, tipear rápido de "coca" a "cola" y
        // mandar Enter antes de que vuelva la respuesta de "coca" agregaría
        // el artículo equivocado a una venta en curso.
        if (busquedaVigente.current.trim() === texto) setResultados(r)
      })
    }, 200)
    return () => clearTimeout(t)
  }, [busqueda])

  const enCentavos = lineas.map((l) => ({
    cantidadMilesimas: cantidadEnMilesimas(l.cantidad),
    precioCentavos: aCentavos(l.precio),
  }))
  const totalCentavos = totalEnCentavos(enCentavos)
  // NaN cubre las tres formas de estar mal, porque `cantidadEnMilesimas`
  // devuelve NaN para todas: no es un número, la gramática lo considera
  // ambiguo, o el campo quedó VACÍO. El vacío importa aparte: antes contaba
  // como cero, la línea pasaba por buena, Cobrar se encendía y el servidor
  // rechazaba la venta entera con "falta la cantidad".
  const hayLineaInvalida = enCentavos.some((l) => Number.isNaN(l.cantidadMilesimas))
  const hayCarrito = lineas.length > 0 && totalCentavos > 0 && !hayLineaInvalida

  // unidadesDelCarrito (arriba): la suma de cantidades, no la cantidad de
  // líneas (eso ya lo da `lineas.length`, el otro término de
  // `resumenDelCarrito`).
  const unidadesMilesimas = unidadesDelCarrito(enCentavos)

  // Clave nueva en cuanto el carrito deja de ser el que la clave describe.
  // Ajuste durante el render, con la misma forma que los dos bloques de abajo:
  // se compara contra lo último reflejado y ese mismo estado se actualiza acá,
  // así que el render siguiente ya no entra y no hay ciclo.
  const firmaActual = firmaDelCarrito(lineas)
  if (firmaActual !== carritoReflejado) {
    setCarritoReflejado(firmaActual)
    // Sin carrito no hay venta que identificar, y una clave sin usar gastada
    // en cada limpieza no molesta a nadie pero tampoco sirve.
    setClave(lineas.length === 0 ? '' : crypto.randomUUID())
  }

  // Cuando el carrito cambia y hay un solo pago en pesos, se le sigue el
  // total: el caso del 90% es cobrar todo junto y no tener que retocar el
  // monto cada vez que se agrega un artículo. Con dos pagos, o con uno en
  // dólares, se deja de tocar — ahí la persona ya decidió cómo reparte.
  // Ajuste durante el render (no un efecto) por la misma razón que el bloque
  // de `ventaProcesada` de abajo: comparar contra `totalReflejado`, que este
  // mismo bloque actualiza, es lo que hace que el segundo render no vuelva a
  // dispararlo.
  //
  // Una cantidad a medio tipear deja `totalCentavos` en NaN, y `NaN !==
  // NaN` es siempre verdadero: sin este `!Number.isNaN`, la guarda nunca
  // cerraría y `setPagos` seguiría devolviendo un array y un objeto nuevos en
  // cada pasada —aunque `setTotalReflejado(NaN)` sí frene por el bail-out de
  // React, `Object.is(NaN, NaN)` es `true`— hasta "Too many re-renders",
  // perdiendo la venta en curso. Mientras la línea sea inválida los pagos se
  // quedan con el último total bueno; el botón ya está apagado por
  // `hayLineaInvalida`, así que no hace falta nada más.
  if (!Number.isNaN(totalCentavos) && totalCentavos !== totalReflejado) {
    setTotalReflejado(totalCentavos)
    setPagos((previos) => {
      if (previos.length === 0) {
        return [
          {
            medio: 'EFECTIVO',
            moneda: 'ARS',
            base: deCentavos(totalCentavos),
            cotizacion: '1',
            recibido: '',
            planId: null,
          },
        ]
      }
      if (previos.length === 1 && previos[0].moneda === 'ARS') {
        return [{ ...previos[0], base: deCentavos(totalCentavos) }]
      }
      return previos
    })
  }

  // Al cobrar bien: carrito vacío y pagos vacíos (la clave se renueva sola,
  // por el ajuste de la firma de más arriba), calculado
  // durante el render en vez de en un efecto — es el patrón que React
  // documenta para "ajustar estado cuando cambia otro estado" (comparar
  // contra la última venta ya procesada), y el único que este lint acepta
  // para un setState síncrono.
  if (estado.venta && estado.venta.id !== ventaProcesada) {
    setVentaProcesada(estado.venta.id)
    setLineas([])
    setBusqueda('')
    setResultados([])
    // La clave no se toca acá: vaciar el carrito ya la renueva por el ajuste
    // de arriba, y tenerla en un solo lugar es lo que evita que las dos
    // reglas se contradigan.
    // Pagos vacíos y no la fila fija de antes: el ajuste de arriba la vuelve
    // a poner en el próximo render, ya por el total de la venta siguiente
    // (0 hasta que se agregue el primer artículo).
    setPagos([])
  }

  // El foco sí necesita un efecto de verdad: tocar el DOM sólo puede pasar
  // después de que React confirmó el render, no durante.
  useEffect(() => {
    if (ventaProcesada) buscador.current?.focus()
  }, [ventaProcesada])

  // F2 enfoca el buscador desde cualquier parte de la pantalla: es el atajo
  // que el chip de al lado promete, no sólo lo anuncia. En un mostrador que
  // se opera sin mouse, un chip que muestra un atajo que no hace nada es peor
  // que no tenerlo.
  //
  // SIN TEST de este efecto en sí —sólo de `esAtajoDeBuscador`, la regla que
  // decide la tecla (ver su comentario)—. Enganchar `window`, disparar
  // `preventDefault` y mover el foco de verdad son DOM real, y este repo no
  // corre jsdom (ver la nota de `ticket.test.tsx`). Quede anotado así a
  // propósito, para que la presencia de un test sobre `esAtajoDeBuscador` no
  // se lea como si este bloque entero estuviera cubierto.
  useEffect(() => {
    function alApretarTecla(e: KeyboardEvent) {
      if (!esAtajoDeBuscador(e.key)) return
      e.preventDefault()
      buscador.current?.focus()
    }
    window.addEventListener('keydown', alApretarTecla)
    return () => window.removeEventListener('keydown', alApretarTecla)
  }, [])

  function alCambiarBusqueda(valor: string) {
    setBusqueda(valor)
    // Vacío no dispara el debounce del efecto de arriba (ver el `return`
    // temprano ahí), así que el vaciado va acá.
    if (valor.trim() === '') setResultados([])
  }

  // Cualquier cambio en el carrito significa que la persona ya dejó de mirar
  // el resultado de la venta anterior y está armando la siguiente: el cartel
  // de éxito se apaga acá, no recién cuando llegue la próxima venta cobrada.
  function actualizarCarrito(actualizar: (previas: Linea[]) => Linea[]) {
    setLineas(actualizar)
    setVentaProcesada((actual) => (actual ? null : actual))
    // Cualquier cambio real en el carrito desarma una confirmación de
    // vaciado que hubiera quedado pendiente: si la persona siguió vendiendo
    // en vez de confirmar el segundo Esc, un vaciado que dispara solo unos
    // segundos después sobre un carrito YA DISTINTO sería peor que el
    // problema que el armado existe para evitar.
    if (desarmarVaciado.current) {
      clearTimeout(desarmarVaciado.current)
      desarmarVaciado.current = null
    }
    setVaciadoArmado((actual) => (actual ? false : actual))
  }

  function agregar(a: ArticuloVendible) {
    actualizarCarrito((previas) => {
      const yaEsta = previas.find((l) => l.articuloId === a.id)
      // Incrementa en vez de duplicar: dos pasadas del lector sobre el mismo
      // código son dos unidades, no dos líneas iguales.
      if (yaEsta) {
        return previas.map((l) => {
          if (l.articuloId !== a.id) return l
          const actual = cantidadEnMilesimas(l.cantidad)
          // Si lo que había tipeado es inválido (NaN), sumar propagaría esa
          // NaN a texto: mejor dejar la línea como está que pisarla con
          // basura — ver `deMilesimas`, que es aritmética entera y no
          // flotante, a propósito.
          if (Number.isNaN(actual)) return l
          return { ...l, cantidad: deMilesimas(actual + 1000) }
        })
      }
      return [
        ...previas,
        {
          articuloId: a.id,
          sku: a.sku,
          descripcion: a.nombre,
          precio: a.precio,
          stock: a.stock,
          esProducto: a.esProducto,
          cantidad: '1',
        },
      ]
    })
    setBusqueda('')
    setResultados([])
    buscador.current?.focus()
  }

  async function alTeclearEnBuscador(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    // ANTES del primer await, siempre: después de un await ya no tiene
    // efecto, y es un modo de falla que no se ve leyendo por encima.
    e.preventDefault()

    const texto = busqueda.trim()
    if (texto === '') return

    // Un Enter mientras otro está consultando se descarta. Cuando el handler
    // era sincrónico esto no hacía falta: el segundo Enter encontraba el
    // cuadro ya vacío (`agregar` lo vacía) y salía por el early-return de
    // arriba. Ahora el cuadro recién se vacía cuando la consulta resuelve,
    // así que sin esta guarda un doble golpe —o el key-repeat— suma la
    // cantidad dos veces por una sola intención, sin nada visible que lo
    // delate: es cobrar de más en un mostrador.
    if (consultando.current) return
    consultando.current = true
    try {
      // Se CONSULTA en vez de leerse de `resultados`: un lector de código de
      // barras tipea y manda Enter en mucho menos que los 200ms del
      // debounce, así que al momento del Enter `resultados` todavía no tiene
      // nada de este scan —y puede tener lo de una búsqueda anterior—.
      // Leerlo perdía el scan en silencio, o peor, agregaba el artículo
      // equivocado a una venta en curso.
      const encontrados = await buscarArticulos(texto)

      // Si mientras se consultaba la persona siguió tipeando, este Enter ya
      // no describe lo que hay en el cuadro: se descarta entero. Agregar
      // igual sumaría un artículo que ya no se pidió Y le borraría lo que
      // está escribiendo, porque `agregar` limpia el buscador.
      if (busquedaVigente.current.trim() !== texto) return

      // Coincidencia EXACTA de código primero: eso es lo que manda un
      // lector. Si no la hay, el primer resultado, que es lo que espera
      // quien busca por nombre.
      const exacto = encontrados.find((a) => a.sku.toLowerCase() === texto.toLowerCase())
      const elegido = exacto ?? encontrados[0]
      if (elegido) agregar(elegido)
    } finally {
      // En `finally` y no al final del try: si la consulta falla, el
      // buscador tiene que quedar usable igual, no trabado para siempre.
      consultando.current = false
    }
  }

  function cambiarPago(i: number, cambio: Partial<Pago>) {
    setPagos((previos) => previos.map((p, j) => (j === i ? { ...p, ...cambio } : p)))
  }

  // `totalDePagosEnCentavos` y NO `totalEnCentavos`: la cotización se guarda
  // con CUATRO decimales, así que tiene su propia conversión. Convertirla con
  // `aMilesimas` truncaría el cuarto —`1234,5678` a `1234,567`— y sobre un
  // pago grande eso mueve el total lo suficiente como para que la pantalla
  // diga que cierra y el motor rechace con PAGOS_NO_CIERRAN. La Task 3 dejó
  // las dos funciones separadas justamente por esto.
  const pagadoCentavos = totalDePagosEnCentavos(
    pagos.map((p) => ({
      montoCentavos: dineroEnCentavos(p.base),
      cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(p.cotizacion),
    })),
  )
  const faltanCentavos = totalCentavos - pagadoCentavos
  const cierra = hayCarrito && faltanCentavos === 0
  // hayFaltanteDeVenta (arriba): NaN (un monto a medio tipear en CUALQUIER
  // pago) cuenta como "sí hay faltante" — "no se sabe si cierra" no es
  // licencia para mostrarle vuelto a nadie, es exactamente el mismo criterio
  // conservador que ya usa `hayLineaInvalida` más arriba.
  const hayFaltante = hayFaltanteDeVenta(faltanCentavos)

  // El pie del panel de cobro: vacío mientras no haya ningún plan elegido (ver
  // `lineasDelPieDeCobro`). Se calcula sobre `totalCentavos` —el MISMO número
  // que pinta la banda de --marca— para que las dos mitades de la pantalla no
  // puedan decir mercaderías distintas.
  const lineasDelPie = lineasDelPieDeCobro(totalCentavos, pagos, planes)

  // Enter cobra y Esc vacía el carrito — los otros dos atajos que promete la
  // leyenda bajo el botón (design/arandano.pen, nodo `k1dDB`). Van en un
  // efecto aparte del de F2 de arriba: ese no depende de nada del estado de
  // la venta (deps `[]`), y este sí —si cierra, si ya está cobrando, cuántas
  // líneas hay, si el vaciado ya está armado—, así que mezclarlos forzaría a
  // re-enganchar también el listener de F2 en cada tecla.
  //
  // SIN TEST de este efecto en sí, mismo motivo que el de F2: enganchar
  // `window`, leer `document.activeElement` y llamar `requestSubmit()` es
  // DOM real, y este repo no corre jsdom (ver la nota de `ticket.test.tsx`).
  // Lo que SÍ se prueba son las reglas puras que deciden cada atajo:
  // `esAtajoDeCobro`, `puedeDispararCobroDesdeFoco` y `esAtajoDeVaciar`.
  //
  // LA GUARDA QUE FALTABA, encontrada en la revisión final de esta task: un
  // `<Select>` de Radix abierto (el de medio o el de moneda, en cualquier
  // `FilaDePago`) deja pasar Enter y Esc hacia ACÁ sin avisar. Ninguno de los
  // dos corta la propagación del evento —`@radix-ui/react-select` no llama a
  // `stopPropagation` ni una vez, y `DismissableLayer` escucha Escape en
  // `document` en fase de CAPTURA pero tampoco la corta—, así que este
  // listener en `window` ve exactamente el mismo evento que Radix ya está
  // atendiendo. Con Enter eso cobraba la venta con el medio/moneda todavía
  // no actualizado en React (ver el comentario largo de
  // `puedeDispararCobroDesdeFoco`); con Esc, cerraba el dropdown Y armaba (o
  // confirmaba) el vaciado del carrito en el mismo golpe de tecla — dos Esc
  // sueltos para abrir "Medio" y "Moneda" alcanzaban para vaciar un carrito
  // de 15 ítems sin que la persona lo pidiera. `hayOverlayDeRadixAbierto()`
  // es la abstención que cierra los dos a la vez: si hay un overlay
  // montado, este listener no hace NADA con la tecla, y deja que sea Radix
  // quien decida.
  useEffect(() => {
    function alApretarTecla(e: KeyboardEvent) {
      if (hayOverlayDeRadixAbierto()) return

      if (esAtajoDeVaciar(e.key)) {
        // Nada que vaciar: ni vale la pena armar la confirmación.
        if (lineas.length === 0) return
        e.preventDefault()
        if (vaciadoArmado) {
          // El desarme (timer + estado) lo hace `actualizarCarrito` mismo
          // —cualquier cambio de carrito lo hace, ver su comentario—, así
          // que acá no hay que repetirlo.
          actualizarCarrito(() => [])
          setPagos([])
          return
        }
        // Primer Esc: arma la confirmación y NO borra nada todavía — ver el
        // comentario de la leyenda, más abajo en el JSX, para el porqué de
        // dos pasos en vez de un confirm() o un vaciado deshacible.
        setVaciadoArmado(true)
        if (desarmarVaciado.current) clearTimeout(desarmarVaciado.current)
        desarmarVaciado.current = setTimeout(() => setVaciadoArmado(false), 3000)
        return
      }

      if (esAtajoDeCobro(e.key)) {
        const etiqueta = (document.activeElement as HTMLElement | null)?.tagName
        if (!puedeDispararCobroDesdeFoco(etiqueta)) return
        // Mismo chequeo que ya usa el atributo `disabled` del botón: el
        // atajo no puede tener más permiso para cobrar que el botón que
        // dice imitar. `requestSubmit()` sobre un <form> NO respeta por su
        // cuenta que el submit esté disabled —ésa es la razón de este
        // chequeo manual, no una prolijidad de más—.
        if (!cierra || cobrando) return
        e.preventDefault()
        formularioCobro.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', alApretarTecla)
    // Sólo desengancha el listener, y a propósito no toca
    // `desarmarVaciado.current` acá: este efecto se re-ejecuta cada vez que
    // cambia una de sus dependencias —incluida `vaciadoArmado`, que cambia
    // JUSTO al armar—, así que limpiar el timer en este cleanup lo
    // cancelaría en el mismo instante en que se lo acaba de crear. El timer
    // vive en un ref y sobrevive a los re-enganches de este efecto a
    // propósito; si la pantalla se desmonta con el vaciado armado, el
    // `setVaciadoArmado` que dispara 3 segundos después no rompe nada en
    // React 18+ (dejó de advertir por setState de un componente desmontado).
    return () => window.removeEventListener('keydown', alApretarTecla)
  }, [lineas.length, vaciadoArmado, cierra, cobrando])

  return (
    // "Cuerpo": el buscador a todo el ancho, arriba de las dos columnas — el
    // padding de 24px de este frame ya lo pone `app/(app)/vender/page.tsx`
    // (`<div className="p-6">` alrededor de este componente), así que acá
    // sólo hace falta el gap vertical de 18px entre el buscador y la fila de
    // abajo.
    <div className="flex flex-col gap-[18px]">
      {/* El buscador: a todo el ancho del Cuerpo, ya no encajado en la
          columna izquierda. El borde violeta de 2px es PERMANENTE —no sólo
          en foco—: design/arandano.pen lo pide así porque en este mostrador
          el cuadro es lo primero que se mira, y un borde que sólo aparece al
          enfocar no ayuda a encontrarlo de entrada. El resplandor
          (shadow-[...]) también sale del .pen: un halo de 4px con --primary
          al 12% de opacidad, armado con color-mix() y NO con un rgba()/hex
          inventado — docs/sistema-de-diseno.md (vía
          app/login/persiana.module.css) es explícito: "el brillo y el surco
          salen de tokens con color-mix, no de rgba() inventados". Con la
          paleta ya repintada una vez (2026-08-21), un halo con el violeta
          viejo hardcodeado quedaría huérfano la próxima vez y nadie se
          enteraría; con color-mix(var(--primary)) sigue al token. */}
      <div className="relative">
        {/* focus-within y no el focus-visible del <Input>: el ring por
            default aparecería sólo alrededor del campo de texto —que no
            cubre ni el ícono ni el chip F2—, y se vería como un rectángulo
            roto en medio de la barra. El <Input> de adentro apaga su propio
            ring (ver más abajo) para que sea ESTE, el de la barra entera, el
            que se vea al enfocar. */}
        <div className="flex h-[58px] items-center gap-3 rounded-[14px] border-2 border-primary bg-card px-[18px] shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_12%,transparent)] focus-within:ring-3 focus-within:ring-ring/50">
          <ScanBarcode aria-hidden="true" className="size-[22px] shrink-0 text-primary" />
          <Input
            id="buscar"
            ref={buscador}
            autoFocus
            autoComplete="off"
            value={busqueda}
            onChange={(e) => alCambiarBusqueda(e.target.value)}
            onKeyDown={alTeclearEnBuscador}
            placeholder="Escaneá un código o buscá por nombre…"
            aria-label="Buscar artículo"
            className="h-full flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          />
          <span className="shrink-0 rounded-sm bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground-soft">
            F2
          </span>
        </div>

        {resultados.length > 0 && (
          <ul className="absolute z-10 mt-2 w-full divide-y rounded-md border bg-card shadow-md">
            {resultados.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => agregar(a)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span>
                    {a.nombre} <span className="text-muted-foreground">· {a.sku}</span>
                  </span>
                  <span>
                    <span className={estilos.importe}>{formatearPrecio(a.precio)}</span>
                    {/* El stock no es plata, así que no lleva estilos.importe —
                        pero sigue siendo una cifra que se compara de un
                        vistazo, así que conserva tabular-nums. Un servicio
                        muestra —, nunca 0: el motor no le descuenta stock, y
                        un cero ahí se leería como faltante. */}
                    <span className="ml-3 tabular-nums text-muted-foreground">
                      {a.esProducto ? formatearCantidad(a.stock) : '—'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* "Fila": las dos columnas — el carrito y el cobro. */}
      <div className="flex flex-col gap-[18px] md:flex-row">
        {/* El carrito entero vive dentro de una card con radius y borde
            propios — antes era una <table> suelta. Se contiene con
            max-w-3xl por la misma razón que antes: en un monitor de 22" una
            card sin techo deja un hueco enorme entre el nombre del artículo y
            su precio, que es más de lo que el ojo enlaza de una sola pasada.
            `max-w-3xl` es un token de max-width de Tailwind, no un paso de la
            escala de espaciado, así que no cae bajo la regla del
            subconjunto. */}
        <Card className="max-w-3xl flex-1 gap-0 rounded-[16px] border py-0 ring-0">
          <Table className="table-fixed">
            <TableHeader>
              {/* Fila "hundida": fondo --muted, padding [12,18] y 14 de gap
                  entre columnas. Una tabla no tiene `gap` de verdad entre
                  celdas, así que el hueco se arma con el padding de cada
                  celda: la mitad (7px) contra la celda vecina y el resto
                  (18px) contra el borde de la card. */}
              <TableRow className="bg-muted hover:bg-muted">
                <TableHead className="h-auto px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Artículo
                </TableHead>
                <TableHead className="h-auto w-[104px] px-[7px] py-3 text-center text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Cantidad
                </TableHead>
                <TableHead className="h-auto w-[110px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Precio
                </TableHead>
                <TableHead className="h-auto w-[130px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                  Subtotal
                </TableHead>
                {/* La columna de "Quitar" queda vacía en el encabezado. */}
                <TableHead className="h-auto w-7 px-[7px] py-3 pr-[18px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineas.map((l, i) => {
                const cantidadMilesimas = cantidadEnMilesimas(l.cantidad)
                const invalida = Number.isNaN(cantidadMilesimas)
                const quedaria = aMilesimas(l.stock) - cantidadMilesimas
                return (
                  <TableRow key={l.articuloId}>
                    <TableCell className="p-[11px] px-[7px] pl-[18px] whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{l.descripcion}</span>
                        <div className="flex items-center gap-2">
                          {/* El SKU bajo el nombre: antes sólo se veía en el
                              buscador. Un servicio no tiene SKU de stock, así
                              que muestra "Servicio" en su lugar — mismo
                              criterio que ya usa la lista de resultados para
                              el stock de un servicio (una raya, no un cero). */}
                          <span className="text-[11px] text-muted-foreground">
                            {l.esProducto ? `SKU ${l.sku}` : 'Servicio'}
                          </span>
                          {/* Antes que el aviso de stock: una cantidad que no
                              se entiende ni siquiera se puede evaluar contra
                              el stock (`quedaria` también sería NaN). Ésta sí
                              queda en rojo: a diferencia del aviso de stock,
                              una cantidad ilegible SÍ impide seguir —apaga
                              Cobrar—, así que acá el rojo es el color
                              correcto (docs/sistema-de-diseno.md: "el ámbar
                              no es un rojo suave", el rojo es para lo que
                              bloquea). */}
                          {invalida && (
                            <span className="text-[11px] font-semibold text-destructive">
                              cantidad inválida
                            </span>
                          )}
                          {/* Se advierte y NO se bloquea: el motor permite
                              vender sin stock a propósito, y la pantalla no
                              puede ser más estricta que el motor sin volverse
                              mentirosa. Ámbar y no rojo: vender con stock
                              negativo está PERMITIDO en este producto, así
                              que esto es "hay que mirar", no "no se puede
                              seguir" — el rojo queda para lo que sí bloquea
                              (arriba). */}
                          {!invalida && l.esProducto && quedaria < 0 && (
                            <Badge
                              variant="outline"
                              className="h-auto gap-[5px] border-transparent bg-warn-soft px-[7px] py-[2px] text-[10px] font-semibold text-warn"
                            >
                              <TriangleAlert aria-hidden="true" />
                              sin stock suficiente
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="p-[11px] px-[7px]">
                      {/* El stepper [-] [valor] [+]: los botones cubren sumar
                          y restar de a una unidad completa, pero el campo del
                          medio sigue siendo editable a mano — el motor admite
                          cantidades con hasta tres decimales a propósito
                          (lib/formato/mostrar.ts: "Medio kilo de harina
                          necesita los decimales"), y +1/-1 no alcanza para
                          tipear "0,5". Los dos botones salen de
                          `PASOS_STEPPER.map(...)` y no de dos <button>
                          escritos a mano: ver el porqué en la definición del
                          array, un poco más arriba. */}
                      {/* focus-within por la misma razón que la barra del
                          buscador: el <Input> del medio apaga su propio ring
                          para que el foco se vea en el stepper entero, no en
                          un rectángulo que ignora los botones [-]/[+]. */}
                      <div className="flex h-9 w-[104px] items-center rounded-[9px] border border-input focus-within:ring-3 focus-within:ring-ring/50">
                        {PASOS_STEPPER.map(({ verbo, delta, Icono }) => (
                          <Fragment key={verbo}>
                            <button
                              type="button"
                              aria-label={`${verbo} una unidad a ${l.descripcion}`}
                              className="flex h-full w-8 items-center justify-center text-foreground-soft hover:bg-muted"
                              onClick={() =>
                                actualizarCarrito((p) =>
                                  p.map((x, j) =>
                                    j === i ? { ...x, cantidad: pasoDeCantidad(x.cantidad, delta) } : x,
                                  ),
                                )
                              }
                            >
                              <Icono className="size-[13px]" />
                            </button>
                            {/* El valor editable va entre los dos botones:
                                se intercala acá, después del primero
                                (Restar), en vez de partir el .map en dos para
                                no perder el orden visual [-] [valor] [+]. */}
                            {delta === -1 && (
                              <Input
                                inputMode="decimal"
                                value={l.cantidad}
                                onChange={(e) =>
                                  actualizarCarrito((p) =>
                                    p.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)),
                                  )
                                }
                                aria-label={`Cantidad de ${l.descripcion}`}
                                className={`h-full flex-1 border-0 bg-transparent px-0 py-0 text-center font-semibold text-foreground shadow-none focus-visible:ring-0 ${estilos.importe}`}
                              />
                            )}
                          </Fragment>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className={`p-[11px] px-[7px] text-right text-foreground-soft ${estilos.importe}`}>
                      {formatearPrecio(l.precio)}
                    </TableCell>
                    <TableCell
                      className={`p-[11px] px-[7px] pr-[18px] text-right text-[15px] font-semibold text-foreground ${estilos.importe}`}
                    >
                      {invalida
                        ? '—'
                        : formatearPrecio(
                            deCentavos(subtotalEnCentavos(cantidadMilesimas, aCentavos(l.precio))),
                          )}
                    </TableCell>
                    <TableCell className="p-[11px] pr-[18px] pl-[7px] text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => actualizarCarrito((p) => p.filter((_, j) => j !== i))}
                        aria-label={`Quitar ${l.descripcion}`}
                        className="text-muted-foreground"
                      >
                        <X className="size-[15px]" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          {lineas.length === 0 && (
            <p className="px-[18px] py-3 text-sm text-muted-foreground">
              Buscá un artículo para empezar la venta.
            </p>
          )}

          {/* Empuja la banda del total al fondo de la card cuando el panel
              de Cobro de al lado es más alto que la cinta. */}
          <div className="flex-1" />

          {/* La banda del total: la ÚNICA superficie de --marca de esta
              pantalla (design/arandano.pen, nodo `B7teV`), alrededor del dato
              que /vender existe para mostrar — docs/sistema-de-diseno.md,
              sección "Un ancla de contenido por pantalla". El avatar del pie
              del sidebar también pinta con --marca, pero ancla la identidad
              de quién está adentro del sistema en las diez pantallas, no el
              dato de ÉSTA en particular: las dos conviven a propósito, según
              ese mismo documento.

              bg/color con var(--token) inline, y no una utilidad de
              Tailwind: --marca y sus variantes no están en @theme (ver el
              comentario en app/globals.css) porque nada más que este tipo de
              superficie las consume, así que ninguna clase de Tailwind las
              resuelve — mismo patrón que ya usa
              components/shell/sidebar-arandano.tsx para el avatar.

              Está siempre, incluso con el carrito vacío en $ 0,00 — un ancla
              que aparece y desaparece no es un ancla. Con una cantidad a
              medio tipear `totalCentavos` queda en NaN, y el monto muestra
              "—", igual que ya hace la columna Subtotal de cada línea
              inválida unas líneas más arriba. */}
          <div
            className="flex items-center justify-between px-[22px] py-5"
            style={{ backgroundColor: 'var(--marca)' }}
          >
            <div className="flex flex-col gap-0.5">
              {/* letter-spacing 1.4 y no 0.8: es más ancho que el de los
                  encabezados de columna de arriba, a propósito — el .pen no
                  los iguala (ver docs/sistema-de-diseno.md). */}
              <span
                className="text-[10px] font-bold tracking-[1.4px] uppercase"
                style={{ color: 'var(--marca-soft)' }}
              >
                Total
              </span>
              {/* Rol "Meta" sobre la banda oscura: --marca-dim, no
                  --marca-soft (docs/sistema-de-diseno.md, "Meta" en la
                  escala) — de los dos tintes de marca la maqueta eligió el
                  más apagado para el texto que acompaña sin competir. */}
              <span className="text-xs" style={{ color: 'var(--marca-dim)' }}>
                {resumenDelCarrito(lineas.length, unidadesMilesimas)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={estilos.signo} style={{ color: 'var(--marca-soft)' }}>
                $
              </span>
              <span className={estilos.total} style={{ color: 'var(--marca-foreground)' }}>
                {Number.isNaN(totalCentavos)
                  ? '—'
                  : // El "$ " que formatearPrecio() ya antepone se descarta con
                    // montoSinSigno() (lib/formato/mostrar.ts): el signo es SU
                    // PROPIO elemento (arriba), no parte de esta cadena — es
                    // justo lo que separa esta banda del pie viejo.
                    montoSinSigno(formatearPrecio(deCentavos(totalCentavos)))}
              </span>
            </div>
          </div>
        </Card>

        {/* w-96 (384px) y no el w-80 (320px) de antes: design/arandano.pen,
            nodo `Cyias`. gap-0/py-0/ring-0 por el mismo motivo que ya anota
            la card del Carrito de arriba: las secciones de adentro (el
            encabezado, el pie) traen su propio padding y su propio borde, y
            el `Card` de shadcn por default suma los suyos. */}
        <Card className="gap-0 rounded-[16px] border py-0 ring-0 md:w-96">
          {/* El encabezado: título + contador de pagos en la MISMA fila
              (design/arandano.pen, nodos `EszMA`/`NyUYT`) — no `CardHeader`
              de shadcn, que arma una grilla pensada para título+acción con
              ícono, no para dos textos en los extremos de una fila. */}
          <div className="flex items-center justify-between border-b px-[18px] py-[14px]">
            {/* "Cobro" y no "Cobrar": el botón de abajo dice Cobrar, y una
                acción tiene un solo nombre en todo el flujo. La card nombra
                la zona, el botón nombra lo que pasa al apretarlo. Archivo
                600 vía cobro.module.css — ver ese archivo para el porqué de
                un módulo nuevo. */}
            <span className={`${estilosCobro.titulo} text-base text-foreground`}>Cobro</span>
            <span className="text-xs text-muted-foreground">
              {pagos.length === 1 ? '1 pago' : `${pagos.length} pagos`}
            </span>
          </div>

          <form ref={formularioCobro} action={accion} className="flex flex-1 flex-col">
            <input type="hidden" name="clave" value={clave} />
            <input
              type="hidden"
              name="items"
              value={JSON.stringify(
                lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.cantidad })),
              )}
            />
            <input
              type="hidden"
              name="pagos"
              value={JSON.stringify(
                // `recibido` NO viaja: es una ayuda de pantalla para calcular
                // el vuelto, y lo que entra a la caja es el monto.
                pagos.map((p) => ({
                  medio: p.medio,
                  moneda: p.moneda,
                  base: p.base,
                  cotizacion: p.cotizacion,
                  // `undefined` y no `null` cuando no hay plan: JSON.stringify
                  // descarta la clave entera, así que un local sin planes manda
                  // exactamente el mismo JSON que antes de que este campo
                  // existiera.
                  planId: p.planId ?? undefined,
                })),
              )}
            />

            <div className="flex flex-col gap-3 p-4">
              {pagos.map((p, i) => (
                <FilaDePago
                  key={i}
                  pago={p}
                  indice={i}
                  cotizacionInicial={cotizacionInicial}
                  planes={planes}
                  hayFaltante={hayFaltante}
                  onCambiar={(cambio) => cambiarPago(i, cambio)}
                  onQuitar={() => setPagos((p2) => p2.filter((_, j) => j !== i))}
                  puedeQuitar={pagos.length > 1}
                />
              ))}
              {/* outline y con ícono "+", ya no relleno gris (design/arandano.pen,
                  nodo `RJII3`) — border-input y no el border-border del outline
                  por default: la maqueta pinta este borde con el mismo
                  $ar-line-strong que ya usan los selects y el stepper, no con
                  el borde tenue genérico de una card. */}
              <Button
                type="button"
                variant="outline"
                className="h-[38px] gap-[7px] rounded-[9px] border-input text-[13px] font-semibold text-foreground-soft"
                onClick={() =>
                  setPagos((p) => [
                    ...p,
                    {
                      medio: 'EFECTIVO',
                      moneda: 'ARS',
                      // Vacío y no `deCentavos(NaN)` si una línea del carrito
                      // está a medio tipear: `Math.max(0, NaN)` es NaN,
                      // `deCentavos(NaN)` es el string literal "NaN.NaN", y el
                      // campo Monto de la fila nueva arrancaba mostrando eso —
                      // el mismo defecto preexistente que "Entran $X", acá del
                      // otro lado del cálculo (el precargado, no el mostrado).
                      base: Number.isNaN(faltanCentavos) ? '' : deCentavos(Math.max(0, faltanCentavos)),
                      cotizacion: '1',
                      recibido: '',
                      // A precio de lista: el pago nuevo arranca en efectivo, y
                      // heredar el plan del pago de al lado sería cobrar un
                      // recargo que nadie eligió para esta parte.
                      planId: null,
                    },
                  ])
                }
              >
                <Plus className="size-[14px]" aria-hidden="true" />
                Agregar pago
              </Button>
            </div>

            {/* Empuja el pie al fondo de la card cuando hay pocos pagos —
                mismo rol que el espaciador análogo del Carrito. */}
            <div className="flex-1" />

            <div className="flex flex-col gap-2.5 border-t p-4">
              {estado.error && (
                <Alert variant="destructive">
                  <AlertDescription>{estado.error}</AlertDescription>
                </Alert>
              )}
              {/* Sólo mientras `ventaProcesada` siga siendo ésta: en cuanto el
                  carrito cambia (ver `actualizarCarrito`) el cartel se apaga,
                  para que no quede colgado mientras se arma la venta
                  siguiente. */}
              {estado.venta && estado.venta.id === ventaProcesada && (
                <Alert>
                  <AlertDescription>
                    Venta #{estado.venta.numero} cobrada.{' '}
                    <Link href={`/ventas/${estado.venta.id}`} className="underline">
                      Ver detalle
                    </Link>
                  </AlertDescription>
                </Alert>
              )}

              {/* El pie de tres líneas, sólo cuando hay algún plan elegido
                  (ver `lineasDelPieDeCobro`). design/arandano.pen no dibuja
                  este bloque —la maqueta es anterior a los planes de pago, y
                  la deuda queda anotada en
                  docs/correcciones-pendientes-del-pen.md—, así que el
                  tratamiento se toma prestado del renglón "Entran $X" de cada
                  fila de pago, que es el otro sitio de esta pantalla donde un
                  rótulo y un importe conviven en una línea: rótulo 12px en
                  --muted-foreground, importe 13px semibold en Archivo.

                  Va DESPUÉS de los carteles de error/éxito y ANTES del chip de
                  faltante: los carteles son transitorios y ya viven arriba del
                  pie; estas tres líneas y el chip son lo que se lee de un
                  vistazo justo antes de apretar Cobrar, así que quedan
                  pegadas al botón.

                  La última línea es el total a cobrar, y se destaca: borde
                  arriba y el mismo peso que el chip. Se decide por POSICIÓN
                  (la última de las tres) y no por un flag en el dato, porque
                  el orden lo fija `lineasDelPieDeCobro` y es el único que
                  tiene sentido — mercadería, lo que se le suma, y el
                  resultado. */}
              {lineasDelPie.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {lineasDelPie.map(({ rotulo, monto }, i) => {
                    const esTotal = i === lineasDelPie.length - 1
                    return (
                      <div
                        key={rotulo}
                        className={`flex items-center justify-between px-0.5 ${
                          esTotal ? 'border-t pt-2' : ''
                        }`}
                      >
                        <span
                          className={
                            esTotal
                              ? 'text-xs font-semibold text-foreground'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          {rotulo}
                        </span>
                        <span
                          className={`${estilos.importe} ${
                            esTotal
                              ? 'text-[15px] font-bold text-foreground'
                              : 'text-[13px] font-semibold text-foreground-soft'
                          }`}
                        >
                          {monto}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* El chip de faltante/sobrante (design/arandano.pen, nodo
                  `G9w7U`, sólo modela "Faltan"). "Sobran" no está en la
                  maqueta —el ejemplo que dibuja ya cierra corto, nunca de
                  más—, pero el motor SÍ deja pagar de más (dos pagos que
                  suman más que el total), y avisarlo ya evitaba un cobro de
                  más antes de este rediseño. Se mantiene en el mismo chip,
                  con el verde de "--ok" en vez de reinventar un color que
                  ningún nodo del .pen pide, y SIN el ícono `circle-alert` —
                  ver el comentario de `puedeMostrarVuelto` sobre el ícono.

                  `role="status"` porque el cartel aparece y cambia de texto
                  sin que nadie lo mire, y es la única pista de por qué el
                  botón sigue apagado — se perdió al migrar de un <p> suelto
                  a este `Badge` (que es un <span> pelado, ver
                  components/ui/badge.tsx) en la Task 3 del rediseño, sin que
                  ningún test lo reclamara. `punto-de-venta.test.tsx` ahora
                  lo fija. */}
              {!Number.isNaN(faltanCentavos) && faltanCentavos !== 0 && hayCarrito && (
                <Badge
                  role="status"
                  variant="outline"
                  className={`h-auto w-full justify-between gap-3 rounded-[10px] border-transparent px-3 py-[9px] ${
                    faltanCentavos > 0 ? 'bg-destructive-soft' : 'bg-ok-soft'
                  }`}
                >
                  <span
                    className={`flex items-center gap-[7px] text-xs font-semibold ${
                      faltanCentavos > 0 ? 'text-destructive' : 'text-ok'
                    }`}
                  >
                    {faltanCentavos > 0 && <CircleAlert className="size-[14px]" aria-hidden="true" />}
                    {faltanCentavos > 0 ? 'Faltan' : 'Sobran'}
                  </span>
                  <span
                    className={`${estilos.importe} text-[15px] font-bold ${
                      faltanCentavos > 0 ? 'text-destructive' : 'text-ok'
                    }`}
                  >
                    {formatearPrecio(deCentavos(Math.abs(faltanCentavos)))}
                  </span>
                </Badge>
              )}

              {/* 54px de alto, ícono arrow-right, texto en Archivo
                  (design/arandano.pen, nodo `yJaPt`) — el orden texto-luego-
                  ícono importa: es el orden de los hijos en el .pen, no un
                  detalle visual libre. */}
              <Button
                type="submit"
                disabled={!cierra || cobrando}
                className={`h-[54px] gap-[9px] rounded-[12px] text-[17px] ${estilosCobro.boton}`}
              >
                {cobrando ? 'Cobrando…' : 'Cobrar'}
                <ArrowRight className="size-[18px]" aria-hidden="true" />
              </Button>

              {/* La leyenda de los atajos (design/arandano.pen, nodo
                  `k1dDB`), que cambia de texto y de color mientras el Esc
                  está armado: es la única señal de que hay una confirmación
                  pendiente, y sin ella el primer Esc parecería no haber
                  hecho nada.

                  POR QUÉ DOS PASOS Y NO UN confirm() NI UN VACIADO
                  DESHACIBLE. Esc es la tecla que este mismo atajo pone a un
                  solo toque de distancia de vaciar un carrito de quince
                  ítems sin red — la task lo pide explícito. Un `confirm()`
                  del navegador bloquea el hilo y no se puede estilar; un
                  diálogo (Sheet/Dialog) suma una capa de foco atrapado y
                  Radix le pone su PROPIO manejo de Escape encima, que
                  competiría con este mismo atajo por la misma tecla. Un
                  vaciado "deshacible" (un toast con Deshacer) necesita una
                  librería que este repo no tiene y un estado extra para
                  guardar el carrito viejo mientras dura la ventana de
                  deshacer. Confirmar con un SEGUNDO Esc, en cambio, reusa
                  exactamente el mismo mecanismo que `AnularVenta`
                  (app/(app)/ventas/formularios.tsx) ya eligió para "esto es
                  irreversible pero frecuente": confirmación en dos pasos
                  sobre la MISMA tecla/botón, sin diálogo y sin dependencia
                  nueva. El desarme solo a los 3 segundos (o al tocar
                  cualquier línea del carrito, ver `actualizarCarrito`) es lo
                  que evita que un Esc de hace un rato "cargue" un vaciado
                  que ya no tiene que ver con la intención actual. */}
              <p
                className={`text-center text-[11px] ${
                  vaciadoArmado ? 'font-semibold text-destructive' : 'text-muted-foreground'
                }`}
              >
                {vaciadoArmado ? 'Esc de nuevo para vaciar el carrito' : 'Enter para cobrar · Esc para vaciar'}
              </p>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}

/**
 * Un campo de monto con su rótulo: Monto, Cotización o "Con cuánto paga"
 * comparten exactamente el mismo tratamiento en design/arandano.pen (rótulo
 * 11px/600 + input de 40px con el valor en Archivo, alineado a la derecha) —
 * sólo cambia la etiqueta y qué campo de `Pago` atan. Extraído para no
 * escribir ese bloque tres veces dentro de `FilaDePago`.
 */
function CampoMonto({
  id,
  etiqueta,
  valor,
  onChange,
}: {
  id: string
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-[5px]">
      <Label htmlFor={id} className="text-[11px] font-semibold text-foreground-soft">
        {etiqueta}
      </Label>
      {/* El relevamiento pide 15px/600 para Monto/Cotización/Recibido. El
          TAMAÑO no se fuerza a propósito —queda en el `text-base`/`md:text-sm`
          responsivo que ya trae `Input` por default (docs/sistema-de-diseno.md,
          "text-base en inputs hasta md"): abajo de 16px iOS hace zoom al
          enfocar, y en una tablet de mostrador eso es la pantalla saltando en
          cada pago. El PESO sí —`font-semibold`—, hallazgo de la review final:
          no tiene la misma excusa, y sin él quedaba en el 400 por default. */}
      <Input
        id={id}
        inputMode="decimal"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={`h-10 rounded-[9px] border-input text-right font-semibold ${estilos.importe}`}
      />
    </div>
  )
}

/**
 * Una fila del formulario de pago: medio, moneda, monto, cotización (sólo si
 * es USD) y el campo de vuelto (sólo si es efectivo en pesos).
 *
 * Extraída de adentro del `pagos.map` de `PuntoDeVenta`: ese mapeo por sí
 * solo eran ~110 líneas de JSX inline en un componente que ya era el más
 * grande del proyecto, y fue justo ahí donde se escondió el bug de "Too many
 * re-renders" del primer round de review — el tamaño del bloque es lo que lo
 * hizo difícil de mirar. Es una mudanza sin cambio de comportamiento
 * respecto de lo que había antes de esta extracción.
 */
function FilaDePago({
  pago,
  indice,
  cotizacionInicial,
  planes,
  hayFaltante,
  onCambiar,
  onQuitar,
  puedeQuitar,
}: {
  pago: Pago
  indice: number
  cotizacionInicial: string | null
  // TODOS los planes del local, sin filtrar: la fila filtra por su propio
  // medio y su moneda (`planesOfrecidos`), y ese filtro tiene que rehacerse en
  // cada cambio de medio.
  planes: PlanVisible[]
  // Si la VENTA completa (todos los pagos, no sólo éste) sigue corta — ver
  // `puedeMostrarVuelto` para el porqué de este parámetro.
  hayFaltante: boolean
  onCambiar: (cambio: Partial<Pago>) => void
  onQuitar: () => void
  puedeQuitar: boolean
}) {
  // El vuelto sólo tiene sentido calculado en pesos: `formatearPrecio` está
  // cableado a ARS, así que un vuelto en dólares saldría formateado como si
  // fueran pesos (US$20 de vuelto se leería "$ 20,00"). En dólares el vuelto
  // no se calcula así de todos modos, así que el campo directamente no se
  // ofrece.
  const esEfectivoArs = pago.medio === 'EFECTIVO' && pago.moneda === 'ARS'
  // Calculado ACÁ, una sola vez, y no adentro del JSX de "Entran $X": monto o
  // cotización a medio tipear (el campo vacío incluido) dejan
  // `entranPesosCentavos` en NaN, y `formatearPrecio` de un NaN imprime
  // "$ NaN" — el único importe de la pantalla que no aplicaba la guarda que
  // el resto del archivo ya usa por regla escrita (ver `:916` la banda del
  // total, `:1112` el chip de faltante). Guardado en una constante para que
  // el guard de renderizado y el guard de "Agregar pago" (más abajo, en el
  // componente padre) no puedan divergir en cómo detectan el NaN.
  const pesosDelPagoCentavos = entranPesosCentavos(pago.base, pago.cotizacion)
  // Los planes que ESTA fila puede ofrecer: los de su medio y sólo en pesos
  // (ver `planesOfrecidos`). Vacío significa que la fila no dibuja ningún
  // control de plan — un local sin planes no ve nada nuevo.
  const planesDelMedio = planesOfrecidos(pago, planes)

  return (
    // fill $ar-bg (--background) y no --card: design/arandano.pen pinta cada
    // pago con el mismo gris del lienzo, para que se distinga de la card
    // blanca de Cobro que lo contiene (nodos `XdYjF`/`VnEsm`).
    <div className="flex flex-col gap-2.5 rounded-xl bg-background p-3">
      <div className="flex items-center gap-2">
        {/* Cambiar el medio LIMPIA el plan, en el mismo cambio de estado: un
            plan de crédito que sobreviva a un cambio a efectivo es
            exactamente el PLAN_NO_CORRESPONDE que el motor rechaza, con la
            pantalla mostrando algo que se ve válido. Esconder el selector no
            alcanza — el `planId` viejo seguiría en el estado y viajando en el
            JSON escondido. */}
        <Select
          value={pago.medio}
          onValueChange={(medio) => onCambiar({ medio: medio as Pago['medio'], planId: null })}
        >
          {/* h-9! (important): SelectTrigger fija su alto con
              data-[size=default]:h-8, una clase condicionada por atributo que
              gana por especificidad a un h-9 suelto — sin el !, el trigger se
              queda en 32px y el radio 9 (design/arandano.pen pide 36px). */}
          <SelectTrigger
            aria-label={`Medio del pago ${indice + 1}`}
            className="h-9! flex-1 justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="EFECTIVO">Efectivo</SelectItem>
            <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
            <SelectItem value="TARJETA_DEBITO">Débito</SelectItem>
            <SelectItem value="TARJETA_CREDITO">Crédito</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={pago.moneda}
          onValueChange={(valor) => {
            const moneda = valor as Pago['moneda']
            onCambiar({
              moneda,
              // Un pago en pesos lleva cotización 1 SIEMPRE; uno en dólares
              // arranca con la última que usó el local.
              cotizacion: moneda === 'ARS' ? '1' : (cotizacionInicial ?? '1'),
              // Y limpia el plan, por lo mismo que el selector de medio de al
              // lado: un plan sobre un pago en dólares es el PLAN_EN_DOLARES
              // que el motor rechaza. Se limpia en las DOS direcciones —de
              // vuelta a pesos también— porque un plan que reaparezca solo al
              // volver de dólares es un recargo que nadie volvió a elegir.
              planId: null,
            })
          }}
        >
          <SelectTrigger
            aria-label={`Moneda del pago ${indice + 1}`}
            className="h-9! w-[92px] justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">$</SelectItem>
            <SelectItem value="USD">US$</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* El selector de plan, SÓLO si el medio elegido tiene planes cargados:
          un local que no cargó ninguno no ve un solo control nuevo, que es la
          promesa explícita del spec.

          En su propia fila y no al lado de Medio/Moneda: en un panel de 384px
          un tercer control apretaría justo el de Medio, que es el que más se
          toca, y el nombre de un plan ("Crédito 3 cuotas sin interés") es
          largo. design/arandano.pen no dibuja este control —la maqueta es
          anterior a los planes de pago, y la deuda queda anotada en
          docs/correcciones-pendientes-del-pen.md—, así que el tratamiento es
          el mismo del selector de Medio de arriba, que es el control hermano. */}
      {planesDelMedio.length > 0 && (
        <Select
          value={pago.planId ?? SIN_PLAN}
          onValueChange={(valor) => onCambiar({ planId: valor === SIN_PLAN ? null : valor })}
        >
          <SelectTrigger
            aria-label={`Plan del pago ${indice + 1}`}
            className="h-9! w-full justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Un valor centinela y no "": Radix reserva la cadena vacía para
                "sin selección" y un SelectItem con value="" tira en runtime. */}
            <SelectItem value={SIN_PLAN}>Precio de lista</SelectItem>
            {planesDelMedio.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {pago.moneda === 'USD' ? (
        // Monto y Cotización lado a lado (design/arandano.pen, frame
        // "Montos" del Pago 2) — sólo en dólares, porque sólo ahí hay un
        // segundo campo con el que compartir la fila.
        <div className="flex gap-2">
          <CampoMonto
            id={`monto-${indice}`}
            etiqueta="Monto"
            valor={pago.base}
            onChange={(v) => onCambiar({ base: v })}
          />
          <CampoMonto
            id={`cot-${indice}`}
            etiqueta="Cotización"
            valor={pago.cotizacion}
            onChange={(v) => onCambiar({ cotizacion: v })}
          />
        </div>
      ) : (
        <CampoMonto
          id={`monto-${indice}`}
          etiqueta="Monto"
          valor={pago.base}
          onChange={(v) => onCambiar({ base: v })}
        />
      )}

      {pago.moneda === 'USD' && (
        // "Entran $X": cuántos pesos representa este pago en dólares
        // (design/arandano.pen, nodo `OTlAa`). entranPesosCentavos reusa el
        // mismo cálculo que cierra la venta — ver su comentario. Guarda de
        // NaN igual que el resto de la plata de esta pantalla: borrar el
        // campo Monto o Cotización para retipearlo deja `pesosDelPagoCentavos`
        // en NaN, y "Entran $ NaN" es un cartel sin sentido.
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">Entran</span>
          <span className={`${estilos.importe} text-[13px] font-semibold text-foreground-soft`}>
            {Number.isNaN(pesosDelPagoCentavos) ? '—' : formatearPrecio(deCentavos(pesosDelPagoCentavos))}
          </span>
        </div>
      )}

      {esEfectivoArs && (
        <CampoMonto
          id={`rec-${indice}`}
          etiqueta="Con cuánto paga (opcional)"
          valor={pago.recibido}
          onChange={(v) => onCambiar({ recibido: v })}
        />
      )}
      {/* El chip de vuelto: verde, con el monto en Archivo
          (design/arandano.pen, nodo `USFQ3`) — y gateado por
          puedeMostrarVuelto, no sólo por esEfectivoArs: mientras la VENTA
          completa siga corta (hayFaltante), este pago no muestra vuelto,
          aunque el campo "con cuánto paga" de arriba siga disponible para
          tipear. Sin ícono, a diferencia del chip de Faltante — el .pen no le
          pone uno (nodo `USFQ3` sólo tiene rótulo + monto). */}
      {puedeMostrarVuelto(esEfectivoArs, hayFaltante) &&
        pago.recibido.trim() !== '' &&
        dineroEnCentavos(pago.recibido) > dineroEnCentavos(pago.base) && (
          <Badge
            variant="outline"
            className="h-auto w-full justify-between gap-2 rounded-[9px] border-transparent bg-ok-soft px-[11px] py-2"
          >
            <span className="text-xs font-semibold text-ok">Vuelto</span>
            <span className={`${estilos.importe} text-[15px] font-bold text-ok`}>
              {formatearPrecio(
                deCentavos(dineroEnCentavos(pago.recibido) - dineroEnCentavos(pago.base)),
              )}
            </span>
          </Badge>
        )}
      {puedeQuitar && (
        <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
          Quitar pago
        </Button>
      )}
    </div>
  )
}
