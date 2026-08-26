/**
 * Los seis permisos, con lo que la pantalla muestra al lado de cada switch.
 *
 * **Es la única fuente**: el servidor valida contra esta lista y `/usuarios` la
 * renderea, en vez de repetir los seis a mano en el JSX. Agregar un permiso es
 * tocar este archivo, el enum del schema y el lugar que lo exige — nada más.
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
    clave: 'VENTAS_ANULAR',
    nombre: 'Anular ventas',
    ayuda: 'Anular una venta ya cobrada y devolver su stock al inventario.',
  },
  {
    clave: 'ORDENES_ANULAR',
    nombre: 'Anular órdenes de trabajo',
    ayuda: 'Anular una orden de servicio técnico ya abierta.',
  },
] as const

export type Permiso = (typeof PERMISOS)[number]['clave']

export const CLAVES_DE_PERMISO: readonly Permiso[] = PERMISOS.map((p) => p.clave)

/** Si el texto es uno de los seis, lo devuelve tipado; si no, null. Es la
 *  validación de entrada de la acción que otorga y revoca: un `permiso` que
 *  llega por FormData es texto de afuera hasta que pasa por acá. */
export function comoPermiso(texto: string): Permiso | null {
  return (CLAVES_DE_PERMISO as readonly string[]).includes(texto) ? (texto as Permiso) : null
}
