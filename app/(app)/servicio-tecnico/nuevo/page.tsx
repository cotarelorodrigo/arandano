import { randomUUID } from 'node:crypto'
import { exigirSesion } from '@/lib/auth/sesion'
import { buscarClientes } from '@/lib/clientes/administrar'
import { recibirEquipo } from '../acciones'
import { FormularioRecepcion } from '../formularios'

export const dynamic = 'force-dynamic'

export default async function RecibirEquipo({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>
}) {
  const sesion = await exigirSesion()
  const { cliente = '' } = await searchParams
  const busqueda = cliente.trim()

  // El buscador que el spec pide dos veces ("se busca por nombre o teléfono"),
  // y no el desplegable de los primeros 50 clientes que había acá: pasados 50,
  // los que ordenan después del corte no se podían elegir NUNCA, así que el
  // mostrador creaba un duplicado en cada visita de esa gente. Con la tabla
  // vacía se ve igual; con un local de un año adentro, no.
  //
  // Con el texto vacío devuelve la lista vacía sin tocar la base.
  const encontrados = await buscarClientes(sesion.tenant.id, busqueda)

  // El Encabezado, el buscador (su propio <form> GET) y las cuatro cards del
  // cuerpo los arma FormularioRecepcion entero (design/arandano.pen, frame
  // `lIt3K`): "Guardar e imprimir ticket" vive en el Topbar, así que sólo un
  // componente que llame una vez a useActionState puede repartir el estado
  // de envío al botón de arriba y al <form> invisible de más abajo — mismo
  // criterio que FichaDeArticulo en /inventario.
  return (
    <FormularioRecepcion
      accion={recibirEquipo}
      clientes={encontrados}
      busquedaCliente={busqueda}
      // La clave se genera EN EL SERVIDOR, una vez por carga de la pantalla:
      // si la generara el cliente en cada render, cambiaría con cada
      // re-render y no serviría para nada.
      claveIdempotencia={randomUUID()}
    />
  )
}
