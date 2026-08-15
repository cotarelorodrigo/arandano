/**
 * El guard de forma de uuid, en un solo lugar.
 *
 * Toda PK del schema es `@db.Uuid`, así que Prisma tipa el parámetro por
 * columna y **rechaza un id mal formado antes de consultar** — con un error
 * crudo (P2007/P2023) que nadie atrapa. En un server component eso es un 500;
 * en un server action, un 500 en vez del error de dominio que corresponde. Y
 * `/servicio-tecnico/foo` es exactamente lo que alguien escribe en la barra de
 * direcciones.
 *
 * `findFirst` en lugar de `findUnique` **no** evita esto, aunque se haya
 * escrito lo contrario: el rechazo lo hace el driver por el tipo de la columna,
 * no la forma de la consulta.
 *
 * Vive en lib/ y no al lado de una pantalla porque ya lo usaban tres archivos
 * de app/ con tres copias idénticas del mismo regex, y las rutas del módulo de
 * órdenes de trabajo lo necesitan igual: una cuarta copia era la que iba a
 * quedar desincronizada.
 */
const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuid(valor: string): boolean {
  return FORMA_DE_UUID.test(valor)
}
