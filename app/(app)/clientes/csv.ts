// Pura, SIN `'use server'`: el encabezado y `filaDeCliente` tienen que ser
// exports sueltos para poder testearse (`csv.test.ts`) sin sesión ni Prisma, y
// un archivo `'use server'` sólo puede exportar funciones async
// (`test/use-server.test.ts`). Mismo reparto que `app/(app)/dashboard/csv.ts`.
import { formatearFechaCorta } from '@/lib/formato/mostrar'
import type { ClienteDelListado } from '@/lib/clientes/consultar'

/**
 * Las columnas del CSV de clientes, en el orden del spec (decisión 7).
 *
 * "Acepta ofertas" va como "Sí"/"No" y no como true/false: el CSV lo abre el
 * dueño en una planilla para armar a quién escribirle, y filtrar por "Sí" es lo
 * que va a hacer. "Compras" y "Última compra" cuentan sólo ventas no anuladas,
 * igual que el listado.
 */
export const ENCABEZADO_CSV_CLIENTES = [
  'Nombre', 'Teléfono', 'Email', 'Acepta ofertas', 'Fecha de alta',
  'Compras', 'Última compra', 'Notas',
]

/** Un cliente, ya resuelto a las columnas de `ENCABEZADO_CSV_CLIENTES`. Los
 *  vacíos son celdas vacías, no "—": una planilla filtra mejor por vacío. El
 *  escapado (comas, comillas, saltos de línea, fórmulas) lo hace `filaCsv`. */
export function filaDeCliente(c: ClienteDelListado): string[] {
  return [
    c.nombre,
    c.telefono ?? '',
    c.email ?? '',
    c.aceptaOfertas ? 'Sí' : 'No',
    formatearFechaCorta(c.creadoEn),
    String(c.compras),
    c.ultimaCompra ? formatearFechaCorta(c.ultimaCompra) : '',
    c.notas ?? '',
  ]
}
