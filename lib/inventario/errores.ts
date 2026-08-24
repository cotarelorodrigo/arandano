import { Prisma } from '@/generated/prisma/client'

export type CodigoErrorDeInventario =
  | 'ARTICULO_INEXISTENTE'
  // Lo tira `exigirUsuario` (lib/ventas/pertenencia.ts) y lo hace con
  // `ErrorDeVenta`, no con la clase de acá: la función se comparte con el motor
  // de ventas y duplicarla para cambiarle la clase al error sería tener dos
  // chequeos de pertenencia que se pueden desincronizar. El CÓDIGO está en este
  // union porque es un código que este módulo efectivamente hace salir, y los
  // tests assertean por código. Que llegue a la pantalla como 500 y no como
  // cartel rojo es correcto: con una sesión válida no puede pasar —RLS garantiza
  // que el usuario de la sesión es de este tenant—, así que si pasa es un bug y
  // tiene que llegar a Sentry, no quedar tapado por un mensaje amable.
  | 'USUARIO_INEXISTENTE'
  | 'TENANT_INEXISTENTE'
  | 'CANTIDAD_INVALIDA'
  | 'ESCALA_EXCEDIDA'
  | 'MOTIVO_INVALIDO'
  // Un servicio no tiene stock: el motor de ventas ni siquiera le genera
  // movimientos (ver el filtro por `esProducto` en lib/ventas/crear.ts).
  // Dejarle mover stock crearía un número que después nadie descuenta.
  | 'SERVICIO_SIN_STOCK'
  | 'COSTO_INVALIDO'
  | 'NOMBRE_VACIO'
  | 'PRECIO_INVALIDO'
  | 'SKU_REPETIDO'
  | 'SKU_VACIO'
  // Lo tira `asegurarCategoria` cuando el INSERT no insertó (o sea: ya
  // existía) y el SELECT que sigue tampoco la encuentra. Adentro de una
  // transacción eso no puede pasar, así que si sale es un bug y tiene que
  // verse como tal — está acá para que el llamador reciba un error con
  // código en vez del TypeError de leer `[0].id` sobre un array vacío.
  | 'CATEGORIA_INDETERMINADA'
  // Lo tira `traducirErrorDeBase` de acá abajo ante el desborde numérico de
  // Postgres. Es el único fallo de la base que el motor NO puede anticipar con
  // una validación previa: el stock se escribe con un UPDATE relativo
  // (`stock = stock + delta`) a propósito, así que el valor de partida sólo se
  // conoce adentro de la transacción y ya con el lock tomado. Leerlo antes para
  // validarlo sería exactamente la carrera que el UPDATE relativo existe para
  // evitar.
  | 'FUERA_DE_RANGO'

/**
 * Con código y no sólo con mensaje: la pantalla tiene que poder distinguir
 * "ese SKU ya está usado" de "el precio no es válido" sin parsear strings.
 * Mismo patrón que lib/ventas/errores.ts y lib/usuarios/errores.ts.
 */
export class ErrorDeInventario extends Error {
  constructor(
    readonly codigo: CodigoErrorDeInventario,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeInventario'
  }
}

/**
 * Traduce a `ErrorDeInventario` el desborde numérico de Postgres.
 *
 * Propio y no el de `lib/ventas/errores.ts`, que hace lo mismo pero devuelve un
 * `ErrorDeVenta`: la pantalla de inventario filtra por `ErrorDeInventario` para
 * decidir qué mostrar, así que un error de otra clase le llega como un 500 en
 * vez de como un cartel que la persona puede corregir tipeando distinto.
 *
 * Devuelve el error tal cual si no lo reconoce: envolver lo que no se entiende
 * es perder el diagnóstico.
 */
export function traducirErrorDeBase(e: unknown): unknown {
  // P2020 = "Value out of range for the type". Adentro trae el 22003
  // (`numeric field overflow`) de Postgres.
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2020') {
    return new ErrorDeInventario(
      'FUERA_DE_RANGO',
      'un valor no entra en la columna que lo guarda: revisá la cantidad o el ' +
        'stock resultante',
    )
  }
  // P2007 ("Data validation error") y P2023 ("Inconsistent column data") son
  // las dos formas en que Postgres rechaza un `articuloId` que no tiene forma
  // de uuid antes de que la fila se busque: `findUnique` lo tira directo, y
  // `updateMany` (editarArticulo, desactivarArticulo, reactivarArticulo) lo
  // tira con el otro código para el mismo motivo. Se traducen a
  // ARTICULO_INEXISTENTE y no a un código nuevo, a propósito: un id que no es
  // uuid no puede nombrar ninguna fila, así que "no existe" es la respuesta
  // honesta, y es la MISMA que recibe un id bien formado de otro tenant. El
  // llamador no puede actuar distinto ante "escribiste cualquier cosa" que
  // ante "ese artículo no es tuyo" — inventar una distinción filtraría qué ids
  // tienen forma válida, información que no le sirve a nadie del otro lado.
  if (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === 'P2007' || e.code === 'P2023')
  ) {
    return new ErrorDeInventario('ARTICULO_INEXISTENTE', 'el artículo no existe en este tenant')
  }
  return e
}
