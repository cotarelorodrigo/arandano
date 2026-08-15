export type CodigoErrorDeOrden =
  | 'TENANT_INEXISTENTE'
  | 'ORDEN_INEXISTENTE'
  // Ni cliente elegido ni cliente nuevo: una orden sin cliente no sirve, porque
  // el punto es saber a quién llamar.
  | 'SIN_CLIENTE'
  | 'MARCA_VACIA'
  | 'MODELO_VACIO'
  | 'FALLA_VACIA'
  | 'TRANSICION_INVALIDA'
  | 'ORDEN_ANULADA'
  | 'MONTO_INVALIDO'

/**
 * Con código y no sólo con mensaje, igual que ErrorDeInventario y ErrorDeVenta:
 * la pantalla distingue "ese salto de estado no existe" de "la falla está
 * vacía" sin parsear strings.
 *
 * `exigirCliente` y `exigirUsuario` (lib/ventas/pertenencia.ts) tiran
 * `ErrorDeVenta` y no esta clase, y se reusan igual: duplicar el chequeo de
 * pertenencia para cambiarle la clase al error sería tener dos chequeos que se
 * pueden desincronizar. Con una sesión válida ninguno de los dos puede saltar
 * —RLS garantiza que el usuario y el cliente son de este tenant—, así que si
 * salta es un bug y tiene que llegar a Sentry como 500, no quedar tapado por
 * un cartel amable. Es el mismo razonamiento que ya está escrito en
 * lib/inventario/errores.ts.
 */
export class ErrorDeOrden extends Error {
  constructor(
    readonly codigo: CodigoErrorDeOrden,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeOrden'
  }
}
