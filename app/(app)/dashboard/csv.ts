// Pura, SIN `'use server'`: `ENCABEZADO_CSV`/`filaDeVenta` tienen que ser
// exports sueltos para poder testearse (`csv.test.ts`) sin sesión ni Prisma
// de por medio, y un archivo `'use server'` de MÓDULO sólo puede exportar
// funciones async (`test/use-server.test.ts`). `exportarVentas`
// (`./acciones.ts`) es la única acción de esta pantalla y vive sola en su
// propio archivo, como en toda pantalla del repo — éste es su vecino puro,
// no otra acción.
import type { Moneda } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'
import {
  formatearPrecio, formatearDolares, formatearFechaCorta, formatearHora,
} from '@/lib/formato/mostrar'
import { cobradoDePagos } from '@/lib/ventas/cobrado'
import { CONSUMIDOR_FINAL, rotuloDeMedios, type Medio } from '@/lib/ventas/medios'

/**
 * El encabezado del CSV: número, fecha y hora por separado —no el combinado
 * "21/08/2026 · 14:28" que arma `historial-${sku}.csv` en
 * `app/(app)/inventario/acciones.ts`—, porque una hoja de cálculo saca más
 * provecho de dos columnas propias que de un string para leer.
 *
 * "Vendido" y "Cobrado" van CADA UNO partido en ARS/USD, cuatro columnas y no
 * dos con el signo de moneda adentro: es la misma distinción de
 * `lib/ventas/cobrado.ts` (la mercadería a precio de lista contra la plata
 * que entró, apiladas por la moneda en que se movieron, sin convertir nada
 * entre sí) — un contador no puede sumar una columna que mezcla pesos y
 * dólares en la misma celda.
 *
 * **Sin Costo ni Margen, aunque quien lo baje tenga el permiso `COSTOS`**: un
 * CSV sale del sistema y sigue circulando —se manda por mail, se guarda en
 * una carpeta compartida—, y el alcance de este ciclo es el dashboard, no un
 * reporte de rentabilidad. Es una decisión de PRODUCTO, no una limitación
 * técnica: `./acciones.ts` ni siquiera consulta `costoUnitario`. La garantía
 * real es esa —lo que el `select` de `exportarVentas` NUNCA pide—, no este
 * array de strings: nada impide, en principio, nombrar una columna futura
 * "Costo unitario" y seguir sin violar un `toContain('Costo')`. Ver
 * `csv.test.ts` para cómo se prueba cada mitad.
 */
export const ENCABEZADO_CSV = [
  'Número', 'Fecha', 'Hora', 'Cliente', 'Medios',
  'Vendido ARS', 'Vendido USD', 'Cobrado ARS', 'Cobrado USD',
  'Recargo', 'Estado',
]

/** Lo que `./acciones.ts` selecciona de cada venta —sin `costoUnitario` en
 *  ningún lado, ver el docblock de `ENCABEZADO_CSV`—. */
export type VentaParaCsv = {
  numero: number
  creadoEn: Date
  total: Prisma.Decimal
  totalUsd: Prisma.Decimal
  recargo: Prisma.Decimal
  anuladaEn: Date | null
  cliente: { nombre: string } | null
  pagos: { medio: Medio; moneda: Moneda; monto: Prisma.Decimal }[]
}

/**
 * Una venta, ya resuelta a las once columnas de `ENCABEZADO_CSV`.
 *
 * "Estado" usa los MISMOS dos rótulos que `ChipEstado`
 * (`app/(app)/ventas/chip-estado.tsx`, "Cobrada"/"Anulada"): dos palabras
 * distintas para lo mismo en la pantalla y en el CSV es la clase de
 * inconsistencia que confunde a quien cruza los dos.
 *
 * Una venta ANULADA se exporta igual, con su plata tal como se cobró antes de
 * anular —mismo criterio que ya documenta el listado de /ventas ("Las
 * anuladas se MUESTRAN")—: el CSV es el historial completo del período, no
 * sólo lo vigente.
 */
export function filaDeVenta(v: VentaParaCsv): string[] {
  const cobrado = cobradoDePagos(v.pagos)
  return [
    String(v.numero),
    formatearFechaCorta(v.creadoEn),
    formatearHora(v.creadoEn),
    v.cliente?.nombre ?? CONSUMIDOR_FINAL,
    rotuloDeMedios(v.pagos),
    formatearPrecio(v.total.toString()),
    formatearDolares(v.totalUsd.toString()),
    formatearPrecio(cobrado.ars.toString()),
    formatearDolares(cobrado.usd.toString()),
    formatearPrecio(v.recargo.toString()),
    v.anuladaEn ? 'Anulada' : 'Cobrada',
  ]
}
