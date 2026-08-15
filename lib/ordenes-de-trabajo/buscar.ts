import type { Prisma } from '@/generated/prisma/client'

/**
 * El techo de un `integer` de Postgres, que es el tipo de
 * `ordenes_de_trabajo.numero`.
 *
 * Un IMEI tiene 15 dígitos: ~166.000 veces este número. Pasarlo a Prisma como
 * candidato a `numero` no da "no encontré nada", da un error crudo que en un
 * server component es un 500 — y el placeholder del buscador dice "IMEI", así
 * que era el primer camino que iba a recorrer quien usara la pantalla como está
 * documentada.
 */
export const NUMERO_MAXIMO = 2_147_483_647

/**
 * Qué número de orden se está buscando, si es que se está buscando alguno.
 *
 * Las DOS mitades son necesarias y ninguna alcanza sola:
 *
 * - El regex, porque `Number.isInteger(Number(x))` admite notación científica
 *   (`1e3`), hexadecimal (`0x10`), espacios alrededor (` 42 `) e `Infinity`, y
 *   ninguna de esas cosas es un número de orden que alguien tipee.
 * - El techo, porque `99999999999` pasa el regex igual y sigue sin entrar en un
 *   int4.
 *
 * El propio tablero ya recortaba `?p` por exactamente este motivo unas líneas
 * más arriba (ver el comentario de PAGINA_MAXIMA en
 * app/(app)/servicio-tecnico/page.tsx); lo que faltaba era llevar esa
 * conciencia al buscador.
 */
export function numeroDeOrden(busqueda: string): number | null {
  if (!/^\d+$/.test(busqueda)) return null
  const n = Number(busqueda)
  return n <= NUMERO_MAXIMO ? n : null
}

/**
 * Las condiciones del buscador del tablero: número, cliente, marca, modelo o
 * IMEI. Vive acá y no adentro de la página para poder probarla sin base — el
 * caso que importa es un string raro, no una fila.
 */
export function condicionesDeBusqueda(busqueda: string): Prisma.OrdenDeTrabajoWhereInput[] {
  const numero = numeroDeOrden(busqueda)
  return [
    { equipoModelo: { contains: busqueda, mode: 'insensitive' } },
    { equipoMarca: { contains: busqueda, mode: 'insensitive' } },
    { equipoSerie: { contains: busqueda, mode: 'insensitive' } },
    { cliente: { nombre: { contains: busqueda, mode: 'insensitive' } } },
    // El número se busca como número, no como texto: `?q=42` tiene que
    // encontrar la orden 42 y no las que contienen un 4 y un 2.
    ...(numero !== null ? [{ numero }] : []),
  ]
}
