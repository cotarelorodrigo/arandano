'use client'

import { useActionState, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Minus, Plus, ScanBarcode, TriangleAlert, X } from 'lucide-react'
import { cobrar, buscarArticulos, type EstadoCobro } from './acciones'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import {
  aCentavos, aMilesimas, cantidadEnMilesimas, cotizacionEnDiezMilesimas, deCentavos,
  deMilesimas, dineroEnCentavos, subtotalEnCentavos, totalDePagosEnCentavos, totalEnCentavos,
} from '@/lib/ventas/centavos'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import estilos from '@/components/importe.module.css'

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
  monto: string
  cotizacion: string
  // Sólo UI: con cuánto paga el cliente, para calcular el vuelto. NO se manda
  // al servidor y NO se guarda — el pago que entra a la caja es el monto, no
  // lo que el cliente apoyó sobre el mostrador.
  recibido: string
}

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

export function PuntoDeVenta({ cotizacionInicial }: { cotizacionInicial: string | null }) {
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
          { medio: 'EFECTIVO', moneda: 'ARS', monto: deCentavos(totalCentavos), cotizacion: '1', recibido: '' },
        ]
      }
      if (previos.length === 1 && previos[0].moneda === 'ARS') {
        return [{ ...previos[0], monto: deCentavos(totalCentavos) }]
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
  useEffect(() => {
    function alApretarTecla(e: KeyboardEvent) {
      if (e.key !== 'F2') return
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
      montoCentavos: dineroEnCentavos(p.monto),
      cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(p.cotizacion),
    })),
  )
  const faltanCentavos = totalCentavos - pagadoCentavos
  const cierra = hayCarrito && faltanCentavos === 0

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
          (shadow-[...]) también sale del .pen: un halo violeta muy tenue de
          4px, no un valor inventado. */}
      <div className="relative">
        {/* focus-within y no el focus-visible del <Input>: el ring por
            default aparecería sólo alrededor del campo de texto —que no
            cubre ni el ícono ni el chip F2—, y se vería como un rectángulo
            roto en medio de la barra. El <Input> de adentro apaga su propio
            ring (ver más abajo) para que sea ESTE, el de la barra entera, el
            que se vea al enfocar. */}
        <div className="flex h-[58px] items-center gap-3 rounded-[14px] border-2 border-primary bg-card px-[18px] shadow-[0_0_0_4px_#4A2AA51F] focus-within:ring-3 focus-within:ring-ring/50">
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
                              className="h-auto gap-[5px] border-transparent bg-warn-soft px-[7px] py-[2px] text-[11px] font-semibold text-warn"
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
                          tipear "0,5". */}
                      {/* focus-within por la misma razón que la barra del
                          buscador: el <Input> del medio apaga su propio ring
                          para que el foco se vea en el stepper entero, no en
                          un rectángulo que ignora los botones [-]/[+]. */}
                      <div className="flex h-9 w-[104px] items-center rounded-[9px] border border-input focus-within:ring-3 focus-within:ring-ring/50">
                        <button
                          type="button"
                          aria-label={`Restar una unidad a ${l.descripcion}`}
                          className="flex h-full w-8 items-center justify-center text-foreground-soft hover:bg-muted"
                          onClick={() =>
                            actualizarCarrito((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, cantidad: pasoDeCantidad(x.cantidad, -1) } : x,
                              ),
                            )
                          }
                        >
                          <Minus className="size-[13px]" />
                        </button>
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
                        <button
                          type="button"
                          aria-label={`Sumar una unidad a ${l.descripcion}`}
                          className="flex h-full w-8 items-center justify-center text-foreground-soft hover:bg-muted"
                          onClick={() =>
                            actualizarCarrito((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, cantidad: pasoDeCantidad(x.cantidad, 1) } : x,
                              ),
                            )
                          }
                        >
                          <Plus className="size-[13px]" />
                        </button>
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

          {/* El pie de la cinta: doble regla y el total. Está siempre, incluso con
              el carrito vacío en $ 0,00 — un ancla que aparece y desaparece no es
              un ancla. Supera al cartel de 24 px, y eso está declarado como
              enmienda con su límite en docs/sistema-de-diseno.md.

              `border-t-4 border-double` y no un valor arbitrario de 3 px: la doble
              regla necesita al menos 3 px para dibujarse, y 4 es el paso de la
              escala de bordes de Tailwind. Un ancho de borde no es un paso de
              espaciado, igual que el `gap-px` de la grilla de tiles de /ventas
              (docs/sistema-de-diseno.md, sección Espaciado y radio).

              Con una cantidad a medio tipear `totalCentavos` queda en NaN, y
              "$ NaN" en 40 px es un cartel roto en una pantalla de plata. Muestra
              "—", que es exactamente lo que ya hace la columna Subtotal de cada
              línea inválida unas líneas más arriba. */}
          <div className="mt-2 flex items-baseline justify-between border-t-4 border-double border-foreground px-[18px] pt-3 pb-[18px]">
            <span className="text-xs tracking-wider text-muted-foreground uppercase">Total</span>
            <span className={`${estilos.total} text-right`}>
              {Number.isNaN(totalCentavos) ? '—' : formatearPrecio(deCentavos(totalCentavos))}
            </span>
          </div>
        </Card>

        <Card className="md:w-80">
          <CardHeader>
            {/* "Cobro" y no "Cobrar": el botón de abajo dice Cobrar, y una acción
                tiene un solo nombre en todo el flujo. La card nombra la zona, el
                botón nombra lo que pasa al apretarlo. */}
            <CardTitle>Cobro</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={accion} className="flex flex-col gap-4">
              <input type="hidden" name="clave" value={clave} />
              <input
                type="hidden"
                name="items"
                value={JSON.stringify(
                  lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.cantidad })),
                )}
              />
              <div className="flex flex-col gap-3">
                {pagos.map((p, i) => (
                  <FilaDePago
                    key={i}
                    pago={p}
                    indice={i}
                    cotizacionInicial={cotizacionInicial}
                    onCambiar={(cambio) => cambiarPago(i, cambio)}
                    onQuitar={() => setPagos((p2) => p2.filter((_, j) => j !== i))}
                    puedeQuitar={pagos.length > 1}
                  />
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setPagos((p) => [
                      ...p,
                      {
                        medio: 'EFECTIVO',
                        moneda: 'ARS',
                        monto: deCentavos(Math.max(0, faltanCentavos)),
                        cotizacion: '1',
                        recibido: '',
                      },
                    ])
                  }
                >
                  Agregar pago
                </Button>
              </div>

              {/* `!Number.isNaN` primero: un monto a medio tipear (una coma de
                  más, una letra) deja `faltanCentavos` en NaN, y `faltanCentavos
                  > 0` da falso ahí, así que sin esta guarda se cae a la rama de
                  "Sobran" y se imprime "Sobran $ NaN" — un cartel sin sentido
                  para un estado que ya deja el botón apagado. `role="status"`
                  porque el cartel aparece y cambia de texto sin que nadie lo
                  mire, y es la única pista de por qué el botón sigue
                  apagado. */}
              {!Number.isNaN(faltanCentavos) && faltanCentavos !== 0 && hayCarrito && (
                <p role="status" className="text-sm tabular-nums text-destructive">
                  {faltanCentavos > 0
                    ? `Faltan ${formatearPrecio(deCentavos(faltanCentavos))}`
                    : `Sobran ${formatearPrecio(deCentavos(-faltanCentavos))}`}
                </p>
              )}

              <input
                type="hidden"
                name="pagos"
                value={JSON.stringify(
                  // `recibido` NO viaja: es una ayuda de pantalla para calcular
                  // el vuelto, y lo que entra a la caja es el monto.
                  pagos.map((p) => ({
                    medio: p.medio,
                    moneda: p.moneda,
                    monto: p.monto,
                    cotizacion: p.cotizacion,
                  })),
                )}
              />

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

              <Button type="submit" disabled={!cierra || cobrando}>
                {cobrando ? 'Cobrando…' : 'Cobrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// Las clases de `Input` (components/ui/input.tsx), copiadas a mano y no
// importadas: un `<select>` nativo no es un `<input>`, así que no hay
// wrapper de shadcn para reusar sin sumar uno. Se transcriben en vez de
// cambiar los dos `<select>` por el `Select` de shadcn porque eso sumaría
// componente y comportamiento (popover, navegación por teclado propia) fuera
// del alcance visual de este ciclo — ver docs/sistema-de-diseno.md, sección
// *Espaciado y radio*, la excepción de los medios pasos copiados de
// components/ui/. El ancho queda afuera (`flex-1` el de medio, `w-24` el de
// moneda); `h-8` entra, porque el alto sí es común a los dos selects.
const CLASES_SELECT_COMO_INPUT =
  'h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm'

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
  onCambiar,
  onQuitar,
  puedeQuitar,
}: {
  pago: Pago
  indice: number
  cotizacionInicial: string | null
  onCambiar: (cambio: Partial<Pago>) => void
  onQuitar: () => void
  puedeQuitar: boolean
}) {
  // El vuelto sólo tiene sentido calculado en pesos: `formatearPrecio` está
  // cableado a ARS, así que un vuelto en dólares saldría formateado como si
  // fueran pesos (US$20 de vuelto se leería "$ 20,00"). En dólares el vuelto
  // no se calcula así de todos modos, así que el campo directamente no se
  // ofrece.
  const mostrarVuelto = pago.medio === 'EFECTIVO' && pago.moneda === 'ARS'

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex gap-2">
        <select
          aria-label={`Medio del pago ${indice + 1}`}
          className={`${CLASES_SELECT_COMO_INPUT} flex-1`}
          value={pago.medio}
          onChange={(e) => onCambiar({ medio: e.target.value as Pago['medio'] })}
        >
          <option value="EFECTIVO">Efectivo</option>
          <option value="TRANSFERENCIA">Transferencia</option>
          <option value="TARJETA_DEBITO">Débito</option>
          <option value="TARJETA_CREDITO">Crédito</option>
        </select>
        <select
          aria-label={`Moneda del pago ${indice + 1}`}
          className={`${CLASES_SELECT_COMO_INPUT} w-24`}
          value={pago.moneda}
          onChange={(e) => {
            const moneda = e.target.value as Pago['moneda']
            onCambiar({
              moneda,
              // Un pago en pesos lleva cotización 1 SIEMPRE; uno en dólares
              // arranca con la última que usó el local.
              cotizacion: moneda === 'ARS' ? '1' : (cotizacionInicial ?? '1'),
            })
          }}
        >
          <option value="ARS">$</option>
          <option value="USD">US$</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`monto-${indice}`}>Monto</Label>
        <Input
          id={`monto-${indice}`}
          inputMode="decimal"
          className={`${estilos.importe} text-right`}
          value={pago.monto}
          onChange={(e) => onCambiar({ monto: e.target.value })}
        />
      </div>
      {pago.moneda === 'USD' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`cot-${indice}`}>Cotización</Label>
          <Input
            id={`cot-${indice}`}
            inputMode="decimal"
            className={`${estilos.importe} text-right`}
            value={pago.cotizacion}
            onChange={(e) => onCambiar({ cotizacion: e.target.value })}
          />
        </div>
      )}
      {mostrarVuelto && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`rec-${indice}`}>Con cuánto paga (opcional)</Label>
          <Input
            id={`rec-${indice}`}
            inputMode="decimal"
            className={`${estilos.importe} text-right`}
            value={pago.recibido}
            onChange={(e) => onCambiar({ recibido: e.target.value })}
          />
          {pago.recibido.trim() !== '' &&
            dineroEnCentavos(pago.recibido) > dineroEnCentavos(pago.monto) && (
              <p className={`${estilos.importe} text-sm`}>
                Vuelto:{' '}
                {formatearPrecio(
                  deCentavos(dineroEnCentavos(pago.recibido) - dineroEnCentavos(pago.monto)),
                )}
              </p>
            )}
        </div>
      )}
      {puedeQuitar && (
        <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
          Quitar pago
        </Button>
      )}
    </div>
  )
}
