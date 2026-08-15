import { randomUUID } from 'node:crypto'
import { exigirSesion } from '@/lib/auth/sesion'
import { buscarClientes } from '@/lib/clientes/administrar'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Recibir un equipo</h1>

      {/* Un form GET aparte y NO adentro del de recepción: los formularios no
          se anidan, y así el buscador anda sin una línea de JavaScript, como
          todas las pantallas de este producto. El precio es que buscar recarga
          la pantalla, y por eso el buscador va primero: lo que se haya tipeado
          del equipo se pierde. */}
      <form className="mt-6 space-y-2" action="/servicio-tecnico/nuevo">
        <Label htmlFor="buscar-cliente">Buscar al cliente por nombre o teléfono</Label>
        <div className="flex gap-2">
          <Input
            id="buscar-cliente"
            name="cliente"
            defaultValue={busqueda}
            placeholder="Juan Pérez, 1155667788"
          />
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Buscá primero: al buscar se recarga la pantalla y se pierde lo que hayas cargado del
          equipo.
        </p>
      </form>

      {/* La clave se genera EN EL SERVIDOR, una vez por carga de la pantalla:
          si la generara el cliente en cada render, cambiaría con cada
          re-render y no serviría para nada. */}
      <FormularioRecepcion
        accion={recibirEquipo}
        clientes={encontrados}
        busquedaCliente={busqueda}
        claveIdempotencia={randomUUID()}
      />
    </main>
  )
}
