export type CodigoErrorDeUsuario =
  | 'MAIL_REPETIDO'
  | 'ULTIMO_DUENO'
  | 'NO_EXISTE'
  | 'CLAVE_CORTA'
  // Sumado en la auto-revisión: `resetearClave` pasó a validar el máximo
  // además del mínimo (ver administrar.ts), porque `ctx.password.hash` no
  // valida ninguno de los dos por su cuenta. Un código propio y no
  // `CLAVE_CORTA` reutilizado: la UI que lea `codigo` sin parsear el mensaje
  // merece distinguir "corta" de "larga", que es exactamente lo que este tipo
  // existe para permitir.
  | 'CLAVE_LARGA'

/**
 * Con código y no sólo con mensaje: la UI tiene que poder decidir qué mostrar
 * sin parsear strings, que es lo que se rompe en silencio al traducir un texto.
 * Mismo patrón que lib/ventas/errores.ts.
 */
export class ErrorDeUsuario extends Error {
  constructor(
    readonly codigo: CodigoErrorDeUsuario,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeUsuario'
  }
}
