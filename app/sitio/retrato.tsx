import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { Card, CardContent } from '@/components/ui/card'
import estilos from '@/components/cartel.module.css'

/**
 * El producto, mostrado en vez de contado.
 *
 * NO es una captura de pantalla y no debería serlo nunca: un PNG se ve borroso
 * en pantalla densa, pesa, y —lo peor— se pudre en silencio cuando la pantalla
 * cambia. Esto usa los mismos componentes y el MISMO formateo de plata que el
 * punto de venta, así que un cambio de formato llega hasta acá solo.
 *
 * Tampoco es la pantalla: no hay botones ni campos. Es un retrato, con datos
 * fijos, y `app/sitio/retrato.test.tsx` lo afirma para que nadie lo convierta
 * de a poco en una demo a medias.
 *
 * El nombre del local va en Archivo, que es la única cara de display del
 * sistema y escribe exactamente esto: nombres de local (docs/sistema-de-diseno.md).
 */

const ITEMS = [
  { descripcion: 'Vidrio templado 6.1"', cantidad: '1', precio: '8500' },
  { descripcion: 'Cambio de pantalla A54', cantidad: '1', precio: '96500' },
]

const TOTAL = '105000'
const EN_PESOS = '55000'
const EN_DOLARES = '50'
const COTIZACION = '1000'

export function Retrato() {
  return (
    <Card
      className="overflow-hidden"
      role="img"
      aria-label="Una venta en el punto de venta de Arándano: dos artículos, total de ciento cinco mil pesos, pagada mitad en pesos y mitad en dólares."
    >
      <CardContent className="space-y-6">
        <div aria-hidden="true">
          <span className={estilos.cartel}>Flor Celulares</span>
        </div>

        <table className="w-full text-sm" aria-hidden="true">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="pb-2 text-left font-medium">Artículo</th>
              <th className="pb-2 text-right font-medium">Cant.</th>
              <th className="pb-2 text-right font-medium">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((item) => (
              <tr key={item.descripcion} className="border-b">
                <td className="py-2">{item.descripcion}</td>
                <td className="py-2 text-right tabular-nums">{item.cantidad}</td>
                <td className="py-2 text-right tabular-nums">{formatearPrecio(item.precio)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div aria-hidden="true">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-4xl tabular-nums">{formatearPrecio(TOTAL)}</p>
        </div>

        <div className="space-y-2 border-t pt-4 text-sm" aria-hidden="true">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Efectivo</span>
            <span className="tabular-nums">{formatearPrecio(EN_PESOS)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Efectivo {formatearDolares(EN_DOLARES)} a {formatearPrecio(COTIZACION)}
            </span>
            <span className="tabular-nums">{formatearPrecio(EN_PESOS)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
