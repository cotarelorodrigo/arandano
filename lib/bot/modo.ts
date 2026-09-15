/**
 * El modo del bot: apagado, sólo a los números de prueba, o a todos.
 *
 * Puro, sin Prisma, por lo mismo que `lib/bot/numeros-de-prueba.ts`: lo importa
 * la pantalla. `MODOS` está atado al enum `ModoBot` del schema en las dos
 * direcciones por `lib/bot/modo.test.ts`.
 *
 * Tres estados y no un switch más una lista (spec, decisión 1): con una lista
 * que restringe "si tiene números", quitar el último número le soltaría el bot
 * a todos los clientes sin ningún gesto que lo diga.
 */

export const MODOS = ['APAGADO', 'PRUEBA', 'TODOS'] as const
export type Modo = (typeof MODOS)[number]

export function esModo(valor: unknown): valor is Modo {
  return typeof valor === 'string' && (MODOS as readonly string[]).includes(valor)
}

/** Cuánto dura armada la confirmación de Todos. Mismo plazo que el vaciado del
 *  carrito con doble Esc en /vender. */
export const MS_CONFIRMACION_TODOS = 3000

/**
 * Qué hace un toque sobre el segmentado.
 *
 * Pasar a Todos pide dos toques y es la única transición que los pide: es la
 * que manda el bot a clientes reales. Bajar es inmediato. Mismo mecanismo que
 * `AnularVenta` —confirmación en el mismo control, sin diálogo—, acá sobre la
 * misma opción.
 */
export function tocarModo(
  estado: { modo: Modo; armadoTodos: boolean },
  tocado: Modo,
): { cambiarA: Modo | null; armadoTodos: boolean } {
  if (tocado === estado.modo) return { cambiarA: null, armadoTodos: false }
  if (tocado !== 'TODOS') return { cambiarA: tocado, armadoTodos: false }
  if (estado.armadoTodos) return { cambiarA: 'TODOS', armadoTodos: false }
  return { cambiarA: null, armadoTodos: true }
}

export function leyendaDelModo(entrada: {
  modo: Modo
  cantidadNumeros: number
  armadoTodos: boolean
}): string {
  if (entrada.armadoTodos) return 'Tocá de nuevo para que les conteste a todos.'
  switch (entrada.modo) {
    case 'APAGADO':
      return 'No le contesta a nadie. Los mensajes quedan guardados.'
    case 'PRUEBA':
      return entrada.cantidadNumeros === 0
        ? 'Todavía no cargaste ningún número de prueba: no le contesta a nadie.'
        : 'Contesta sólo a los números de prueba.'
    case 'TODOS':
      return 'Les contesta a todos los que escriban.'
  }
}

export function subtituloDelModo(modo: Modo): string {
  switch (modo) {
    case 'APAGADO':
      return 'Apagado'
    case 'PRUEBA':
      return 'En prueba'
    case 'TODOS':
      return 'Contestando'
  }
}
