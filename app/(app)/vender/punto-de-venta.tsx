'use client'

import { useActionState, useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { cobrar, buscarArticulos, type EstadoCobro } from './acciones'
import type { ArticuloVendible } from '@/lib/ventas/buscar'
import {
  aCentavos, aMilesimas, deCentavos, subtotalEnCentavos, totalEnCentavos,
} from '@/lib/ventas/centavos'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

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

export function PuntoDeVenta() {
  const [estado, accion, cobrando] = useActionState(cobrar, INICIAL)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<ArticuloVendible[]>([])
  // Una clave por venta. Se renueva al cobrar bien, así que la venta siguiente
  // es otra; mientras tanto, todo reintento del mismo carrito manda la misma.
  const [clave, setClave] = useState(() => crypto.randomUUID())
  // La última venta ya procesada por la limpieza de abajo, para no repetirla
  // en cada render.
  const [ventaProcesada, setVentaProcesada] = useState<string | null>(null)
  const buscador = useRef<HTMLInputElement>(null)

  // Buscar mientras se tipea, con un respiro para no pegarle al servidor en
  // cada tecla. 200ms es lo que separa "tipeando" de "terminó de tipear". El
  // vaciado cuando el texto queda vacío vive en `alCambiarBusqueda`, no acá:
  // el lint del proyecto (react-hooks/set-state-in-effect) rechaza un setState
  // síncrono en el cuerpo de un efecto.
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto === '') return
    const t = setTimeout(() => {
      buscarArticulos(texto).then(setResultados)
    }, 200)
    return () => clearTimeout(t)
  }, [busqueda])

  // Al cobrar bien: carrito vacío y clave nueva, calculado durante el render
  // en vez de en un efecto — es el patrón que React documenta para "ajustar
  // estado cuando cambia otro estado" (comparar contra la última venta ya
  // procesada), y el único que este lint acepta para un setState síncrono.
  if (estado.venta && estado.venta.id !== ventaProcesada) {
    setVentaProcesada(estado.venta.id)
    setLineas([])
    setBusqueda('')
    setResultados([])
    setClave(crypto.randomUUID())
  }

  // El foco sí necesita un efecto de verdad: tocar el DOM sólo puede pasar
  // después de que React confirmó el render, no durante.
  useEffect(() => {
    if (ventaProcesada) buscador.current?.focus()
  }, [ventaProcesada])

  function alCambiarBusqueda(valor: string) {
    setBusqueda(valor)
    // Vacío no dispara el debounce del efecto de arriba (ver el `return`
    // temprano ahí), así que el vaciado va acá.
    if (valor.trim() === '') setResultados([])
  }

  function agregar(a: ArticuloVendible) {
    setLineas((previas) => {
      const yaEsta = previas.find((l) => l.articuloId === a.id)
      // Incrementa en vez de duplicar: dos pasadas del lector sobre el mismo
      // código son dos unidades, no dos líneas iguales.
      if (yaEsta) {
        return previas.map((l) =>
          l.articuloId === a.id
            ? { ...l, cantidad: String(aMilesimas(l.cantidad || '0') / 1000 + 1) }
            : l,
        )
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

  function alTeclearEnBuscador(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    // Si lo tipeado coincide EXACTO con un código, se agrega ése. Es lo que
    // hace funcionar un lector de código de barras sin escribir nada para él:
    // tipea el código y manda Enter. Si no hay coincidencia exacta, Enter
    // agrega el primer resultado, que es lo que espera quien busca por nombre.
    const exacto = resultados.find((a) => a.sku.toLowerCase() === busqueda.trim().toLowerCase())
    const elegido = exacto ?? resultados[0]
    if (elegido) agregar(elegido)
  }

  const enCentavos = lineas.map((l) => ({
    cantidadMilesimas: aMilesimas(l.cantidad || '0'),
    precioCentavos: aCentavos(l.precio),
  }))
  const totalCentavos = totalEnCentavos(enCentavos)
  const hayCarrito = lineas.length > 0 && totalCentavos > 0

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex-1">
        <div className="mb-4 flex flex-col gap-2">
          <Label htmlFor="buscar">Buscar artículo</Label>
          <Input
            id="buscar"
            ref={buscador}
            autoFocus
            autoComplete="off"
            value={busqueda}
            onChange={(e) => alCambiarBusqueda(e.target.value)}
            onKeyDown={alTeclearEnBuscador}
            placeholder="Nombre o código"
          />
        </div>

        {resultados.length > 0 && (
          <ul className="mb-6 divide-y rounded-md border">
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
                  <span className="tabular-nums">
                    {formatearPrecio(a.precio)}
                    {/* Un servicio muestra —, nunca 0: el motor no le descuenta
                        stock, y un cero ahí se leería como faltante. */}
                    <span className="ml-3 text-muted-foreground">
                      {a.esProducto ? formatearCantidad(a.stock) : '—'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {lineas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Buscá un artículo para empezar la venta.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Artículo</th>
                <th className="w-24 text-right">Cantidad</th>
                <th className="text-right">Precio</th>
                <th className="text-right">Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const quedaria =
                  aMilesimas(l.stock) - aMilesimas(l.cantidad || '0')
                return (
                  <tr key={l.articuloId} className="border-b">
                    <td className="py-2">
                      {l.descripcion}
                      {/* Se advierte y NO se bloquea: el motor permite vender
                          sin stock a propósito, y la pantalla no puede ser más
                          estricta que el motor sin volverse mentirosa. */}
                      {l.esProducto && quedaria < 0 && (
                        <span className="ml-2 text-destructive">sin stock suficiente</span>
                      )}
                    </td>
                    <td>
                      <Input
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={l.cantidad}
                        onChange={(e) =>
                          setLineas((p) =>
                            p.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)),
                          )
                        }
                        aria-label={`Cantidad de ${l.descripcion}`}
                      />
                    </td>
                    <td className="text-right tabular-nums">{formatearPrecio(l.precio)}</td>
                    <td className="text-right tabular-nums">
                      {formatearPrecio(
                        deCentavos(
                          subtotalEnCentavos(aMilesimas(l.cantidad || '0'), aCentavos(l.precio)),
                        ),
                      )}
                    </td>
                    <td className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setLineas((p) => p.filter((_, j) => j !== i))}
                        aria-label={`Quitar ${l.descripcion}`}
                      >
                        Quitar
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Card className="md:w-80">
        <CardHeader>
          <CardTitle>Cobrar</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-2xl tabular-nums">{formatearPrecio(deCentavos(totalCentavos))}</p>

          <form action={accion} className="flex flex-col gap-4">
            <input type="hidden" name="clave" value={clave} />
            <input
              type="hidden"
              name="items"
              value={JSON.stringify(
                lineas.map((l) => ({ articuloId: l.articuloId, cantidad: l.cantidad })),
              )}
            />
            {/* Un solo pago, en efectivo y por el total: el caso del 90%. La
                Task 7 lo convierte en una lista editable. */}
            <input
              type="hidden"
              name="pagos"
              value={JSON.stringify([
                {
                  medio: 'EFECTIVO',
                  moneda: 'ARS',
                  monto: deCentavos(totalCentavos),
                  cotizacion: '1',
                },
              ])}
            />

            {estado.error && (
              <Alert variant="destructive">
                <AlertDescription>{estado.error}</AlertDescription>
              </Alert>
            )}
            {estado.venta && (
              <Alert>
                <AlertDescription>
                  Venta #{estado.venta.numero} cobrada.{' '}
                  <Link href={`/ventas/${estado.venta.id}`} className="underline">
                    Ver detalle
                  </Link>
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={!hayCarrito || cobrando}>
              {cobrando ? 'Cobrando…' : 'Cobrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
