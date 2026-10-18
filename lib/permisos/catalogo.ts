/**
 * Los permisos del producto, con lo que la pantalla muestra al lado de cada
 * switch.
 *
 * **Es la única fuente**: el servidor valida contra esta lista y `/usuarios` la
 * renderea, en vez de repetirlos a mano en el JSX. Agregar un permiso es tocar
 * este archivo, el enum del schema y el lugar que lo exige — nada más.
 *
 * **La unión se escribe acá y no se importa de Prisma**, que es lo que ya hace
 * este repo con `RolUsuario` (ver `lib/usuarios/resumen.ts:1`): una sola copia
 * en `lib/`, atada al schema por `test/permisos-catalogo.test.ts` en las dos
 * direcciones.
 *
 * **`COSTOS` es uno y no dos** (ver / cargar): cargar un costo que no podés ver
 * no es un caso que exista, porque el ingreso de mercadería te muestra lo que
 * acabás de escribir. **`ARTICULOS_CREAR` y `ARTICULOS_EDITAR` sí son dos**, y
 * ésa es la asimetría a propósito: cargar un producto nuevo y cambiarle el
 * precio a uno que se viene vendiendo hace meses no tienen el mismo riesgo.
 *
 * **`PLANES_PAGO` no se pliega sobre `ARTICULOS_EDITAR`** por esa misma
 * asimetría, un escalón más arriba: editar un artículo mueve el precio de UN
 * artículo, y tocar el recargo de un plan mueve el precio de TODO el catálogo
 * para esa forma de pago — una palanca de una fila. Quien puede corregir el
 * precio de una funda no necesariamente puede decidir cuánto recarga el local
 * por pagar en doce cuotas.
 *
 * **`CANJE_VALORES` protege la tabla del plan canje y NO la calculadora**, que
 * es el reparto que el pedido describe: el vendedor consulta cuánto vale el
 * usado sin poder cambiarlo. Tampoco se pliega sobre `PLANES_PAGO` ni sobre
 * `ARTICULOS_EDITAR`: no mueve un precio de venta sino lo que el local entrega
 * a cambio de un equipo, y un dueño puede querer que su encargado cotice usados
 * sin tocar los recargos, o al revés.
 *
 * **`COTIZACION` protege CARGAR la cotización del dólar, no verla**: el chip
 * de `/vender` y su historial los ve cualquiera, porque el que cobra tiene que
 * saber a cuánto está el dólar del local y de cuándo es. Cargarla es fijar el
 * número con el que arranca cada pago que cruza monedas. Aparte de
 * `PLANES_PAGO` aunque los dos muevan el precio de todo el catálogo: el dólar
 * se actualiza todos los días y un recargo se decide una vez, así que un dueño
 * puede querer delegar uno y no el otro.
 */
export const PERMISOS = [
  {
    clave: 'ARTICULOS_CREAR',
    nombre: 'Cargar artículos',
    ayuda: 'Dar de alta productos y servicios nuevos, con su precio de venta.',
  },
  {
    clave: 'ARTICULOS_EDITAR',
    nombre: 'Editar artículos',
    ayuda: 'Cambiar el nombre y el precio de un artículo que ya existe, desactivarlo y reactivarlo.',
  },
  {
    clave: 'ARTICULOS_BORRAR',
    nombre: 'Borrar artículos',
    ayuda: 'Borrar del todo un artículo cargado por error, con su historial de stock. Sólo si nunca se vendió.',
  },
  {
    clave: 'COSTOS',
    nombre: 'Ver y cargar costos',
    ayuda: 'Ver el costo de compra y el margen, y cargarlos al recibir mercadería.',
  },
  {
    clave: 'CATEGORIAS',
    nombre: 'Administrar categorías',
    ayuda: 'Crear, renombrar, mover y borrar rubros y marcas del árbol.',
  },
  {
    clave: 'PLANES_PAGO',
    nombre: 'Administrar formas de pago',
    ayuda: 'Crear y editar los planes de pago del local y cuánto recarga cada uno.',
  },
  {
    clave: 'VENTAS_ANULAR',
    nombre: 'Anular ventas',
    ayuda: 'Anular una venta ya cobrada y devolver su stock al inventario.',
  },
  {
    clave: 'VENTAS_EDITAR',
    nombre: 'Corregir ventas',
    ayuda: 'Corregir cómo se pagó una venta ya cobrada: el medio, el plan y el reparto entre pagos.',
  },
  {
    clave: 'BOT',
    nombre: 'Configurar el bot de WhatsApp',
    ayuda: 'Prender y apagar el bot, y editar la información del local que responde.',
  },
  {
    clave: 'ORDENES_ANULAR',
    nombre: 'Anular órdenes de trabajo',
    ayuda: 'Anular una orden de servicio técnico ya abierta.',
  },
  {
    clave: 'CANJE_VALORES',
    nombre: 'Editar los valores del plan canje',
    ayuda: 'Cargar cuánto se paga por cada equipo usado según su batería, y en qué moneda. La calculadora la usa cualquiera.',
  },
  {
    clave: 'COTIZACION',
    nombre: 'Actualizar la cotización del dólar',
    ayuda: 'Cargar a cuánto toma el local el dólar hoy, desde el chip "USD" de Vender. Verla y ver quién la cargó, todos.',
  },
] as const

export type Permiso = (typeof PERMISOS)[number]['clave']

export const CLAVES_DE_PERMISO: readonly Permiso[] = PERMISOS.map((p) => p.clave)

/** Si el texto es una de las claves de la lista, lo devuelve tipado; si no,
 *  null. Es la validación de entrada de la acción que otorga y revoca: un
 *  `permiso` que llega por FormData es texto de afuera hasta que pasa por acá. */
export function comoPermiso(texto: string): Permiso | null {
  return (CLAVES_DE_PERMISO as readonly string[]).includes(texto) ? (texto as Permiso) : null
}
