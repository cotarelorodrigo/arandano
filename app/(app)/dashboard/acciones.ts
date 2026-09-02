// SIN 'use server' arriba, y es la única `acciones.ts` del repo así — a
// propósito, no por descuido.
//
// `filaCsv`/`ENCABEZADO_CSV` tienen que poder importarse sueltos desde
// `acciones.test.ts` para probar el escapado RFC 4180 sin sesión ni Prisma de
// por medio. Un archivo `'use server'` de MÓDULO sólo puede exportar
// funciones async (`test/use-server.test.ts`: Next.js convierte cada export
// en un endpoint RPC y tira abajo la pantalla al EVALUAR el módulo si
// encuentra una constante o una función sincrónica — en runtime, con el
// build en verde). Así que este archivo no puede llevar el directive de
// módulo y exportar `ENCABEZADO_CSV`/`filaCsv`/`filaDeVenta` a la vez.
//
// La consecuencia real: la acción que toca la base (`exportarVentas`) NO
// vive acá, vive en `./exportar-accion.ts`, con `'use server'` de módulo
// para ella sola. No es sólo para cumplir el contrato de arriba: es también
// lo que mantiene a este archivo SEGURO de importar desde un componente
// cliente. Si `exportarVentas` viviera en ESTE archivo (aunque fuera con un
// directive de FUNCIÓN, adentro del cuerpo, en vez de arriba del módulo),
// éste seguiría sin declarar `'use server'` de módulo, así que
// `test/limite-cliente-servidor.test.ts` —que sólo trata un archivo como
// frontera cuando su PRIMERA línea es `'use server'`— seguiría cruzándolo de
// largo y encontraría el `import { prismaParaTenant } from
// '@/lib/tenant/prisma'` que esa acción necesita: exactamente uno de los tres
// módulos "sensibles" que ese test prohíbe alcanzar desde un Client Component
// (verificado a mano: con `exportarVentas` acá, con directive de función, ese
// test falla apuntando a `app/(app)/dashboard/exportar.tsx -> lib/tenant/
// prisma.ts`). Separar el archivo entero —no sólo la línea del import— es lo
// que lo evita: `exportar.tsx` importa `exportarVentas` de
// `./exportar-accion` (que SÍ es `'use server'` de módulo, y ahí el BFS de
// ese test se frena sin mirar sus imports), nunca de acá.
//
// Mismo patrón, mismo motivo, que `lib/clientes/rotulos.ts` — invertido: allá
// se sacó la función PURA para que un Client Component pudiera importarla sin
// arrastrar el módulo que la rodeaba; acá se saca la función IMPURA (la que
// toca Postgres) para que el módulo puro pueda exportar de más sin romper el
// contrato de `'use server'`.
import { Prisma } from '@/generated/prisma/client'
import type { Moneda } from '@/generated/prisma/client'
import {
  formatearPrecio, formatearDolares, formatearFechaCorta, formatearHora,
} from '@/lib/formato/mostrar'
import { cobradoDePagos } from '@/lib/ventas/cobrado'
import { CONSUMIDOR_FINAL, type Medio } from '@/lib/ventas/medios'
// Reusado y no reimplementado: es la MISMA regla ya escrita y testeada que
// arma la celda "Medios" del listado de /ventas — dos implementaciones de
// "cómo se resume una lista de pagos en un rótulo" es exactamente la clase de
// bug que este repo ya pagó (el selector de categoría duplicado entre el alta
// y la ficha, CLAUDE.md, 2026-08-28). Importar desde otra página de `app/` y
// no desde `lib/` es un poco atípico, pero es seguro ACÁ porque este archivo
// nunca lo alcanza un componente cliente (ver el comentario de arriba): sólo
// `./exportar-accion.ts`, que es `'use server'` de módulo, lo importa, y ese
// archivo ya actúa de frontera para cualquier test de bundling.
import { rotuloDeMedios } from '@/app/(app)/ventas/page'

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
 * técnica: `exportar-accion.ts` ni siquiera consulta `costoUnitario`.
 */
export const ENCABEZADO_CSV = [
  'Número', 'Fecha', 'Hora', 'Cliente', 'Medios',
  'Vendido ARS', 'Vendido USD', 'Cobrado ARS', 'Cobrado USD',
  'Recargo', 'Estado',
]

/**
 * Un apóstrofe adelante si el valor arranca con `=`, `+`, `-` o `@`: sin él,
 * Excel y Google Sheets interpretan esos cuatro caracteres iniciales como el
 * comienzo de una fórmula (inyección de fórmulas vía CSV, guía de OWASP). No
 * es un caso de laboratorio acá tampoco: un nombre de cliente cargado como
 * "=HOY()" —para lo que sea que alguien haya querido probar en el mostrador—
 * alcanza para disparrlo en cuanto ese cliente tenga una venta en el período.
 */
function neutralizarFormula(valor: string): string {
  return /^[=+\-@]/.test(valor) ? `'${valor}` : valor
}

/**
 * Comillas dobles si el valor lleva coma, comilla o salto de línea (RFC
 * 4180); las comillas internas se duplican al doblarlas.
 *
 * Alcanza para que esto importe de verdad: un nombre de cliente cargado como
 * "Pérez, Ana" (con coma) ya rompe la fila en dos celdas al abrirla en una
 * planilla si no se encomilla — no hace falta un caso armado a propósito.
 */
function celdaCsv(valor: string): string {
  const segura = neutralizarFormula(valor)
  return /[",\r\n]/.test(segura) ? `"${segura.replace(/"/g, '""')}"` : segura
}

export function filaCsv(campos: string[]): string {
  return campos.map(celdaCsv).join(',')
}

/** Lo que `exportar-accion.ts` selecciona de cada venta —sin `costoUnitario`
 *  en ningún lado, ver el docblock de `ENCABEZADO_CSV`—. */
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
