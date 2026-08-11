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
