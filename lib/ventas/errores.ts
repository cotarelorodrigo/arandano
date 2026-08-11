import { Prisma } from '@/generated/prisma/client'

export type CodigoErrorDeVenta =
  | 'SIN_ITEMS'
  | 'CANTIDAD_INVALIDA'
  | 'ESCALA_EXCEDIDA'
  | 'ARTICULO_INEXISTENTE'
  | 'CLIENTE_INEXISTENTE'
  | 'USUARIO_INEXISTENTE'
  | 'TENANT_INEXISTENTE'
  | 'MONTO_INVALIDO'
  | 'COTIZACION_INVALIDA'
  | 'PAGOS_NO_CIERRAN'
  | 'VENTA_INEXISTENTE'
  | 'FUERA_DE_RANGO'
  // Distinto de ARTICULO_INEXISTENTE a propósito: para el que está cobrando son
  // dos situaciones con salidas distintas. "No existe" se resuelve buscando de
  // nuevo; "está desactivado" se resuelve reactivándolo desde inventario. Un
  // mensaje que no las distinga manda a la persona al lugar equivocado.
  | 'ARTICULO_DESACTIVADO'

/**
 * Con código y no sólo con mensaje: la UI que venga después tiene que poder
 * distinguir "faltó un artículo" de "los pagos no cierran" para decir algo útil,
 * y parsear el texto de un Error es la forma de que eso se rompa en silencio la
 * primera vez que alguien mejore la redacción.
 */
export class ErrorDeVenta extends Error {
  constructor(
    readonly codigo: CodigoErrorDeVenta,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeVenta'
  }
}

/**
 * Traduce a `ErrorDeVenta` el desborde numérico de Postgres.
 *
 * Es el único fallo de la base que el motor NO puede anticipar con una
 * validación previa, y por eso es el único que se traduce acá en vez de
 * chequearse antes: el stock se escribe con un UPDATE **relativo**
 * (`stock = stock + delta`), a propósito —es lo que hace que dos ventas
 * simultáneas del mismo artículo no se pisen—, así que el valor de partida sólo
 * se conoce adentro de la transacción y ya con el lock tomado. Leerlo antes para
 * validarlo sería exactamente la carrera que el UPDATE relativo existe para
 * evitar.
 *
 * El resto de los P2003/P2002 que llegaban crudos ya no llegan: las FKs se
 * resuelven a mano contra el cliente transaccional (ver `crear.ts`) y el
 * correlativo lo asigna el motor. Sin esta traducción, un desborde salía como
 * error de Prisma sin `codigo` —o sea un 500— en una función donde todo lo demás
 * tiene código.
 *
 * Devuelve el error tal cual si no lo reconoce: envolver lo que no se entiende
 * es perder el diagnóstico.
 */
export function traducirErrorDeBase(e: unknown): unknown {
  // P2020 = "Value out of range for the type". Adentro trae el 22003
  // (`numeric field overflow`) de Postgres.
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2020') {
    return new ErrorDeVenta(
      'FUERA_DE_RANGO',
      'un valor no entra en la columna que lo guarda: revisá la cantidad, el ' +
        'total o el stock resultante',
    )
  }
  return e
}
