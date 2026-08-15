import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearFecha } from '@/lib/formato/mostrar'
import { ESTADOS, ABIERTOS, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { filtroDelTablero } from '@/lib/ordenes-de-trabajo/buscar'
import type { EstadoOrden } from '@/generated/prisma/client'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

function esEstado(v: string | undefined): v is EstadoOrden {
  return v !== undefined && (ESTADOS as readonly string[]).includes(v)
}

export default async function ServicioTecnico({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; estado?: string }>
}) {
  const sesion = await exigirSesion()
  const { q = '', p = '1', estado } = await searchParams

  const busqueda = q.trim()
  // Truncado y con techo, igual que /inventario: `?p=2.3` daría un skip con
  // decimales y `?p=1e300` uno fuera del rango de un Int, y Prisma rechaza los
  // dos con un error que nadie atrapa — o sea un 500 desde un query string.
  const PAGINA_MAXIMA = 1_000_000
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const filtro = esEstado(estado) ? estado : null

  const prisma = prismaParaTenant(sesion.tenant.id)
  // Por defecto las abiertas; buscando, todas —incluidas las entregadas y las
  // anuladas—. El porqué, largo, vive en lib/ordenes-de-trabajo/buscar.ts, que
  // es también donde el buscador recorta el número para que un IMEI no tire
  // abajo la consulta.
  const donde = filtroDelTablero(busqueda, filtro)

  const [ordenes, total, porEstado] = await Promise.all([
    prisma.ordenDeTrabajo.findMany({
      where: donde,
      // La MÁS VIEJA PRIMERO, al revés que /ventas. En ventas lo último es lo
      // que importa; acá lo que duele es el equipo que lleva tres semanas en el
      // estante.
      orderBy: { creadoEn: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true,
        numero: true,
        estado: true,
        equipoMarca: true,
        equipoModelo: true,
        creadoEn: true,
        // Para rotular la fila: con la búsqueda alcanzando a las anuladas, una
        // fila sin marca no se distingue de una viva.
        anuladaEn: true,
        cliente: { select: { nombre: true } },
      },
    }),
    prisma.ordenDeTrabajo.count({ where: donde }),
    // Los contadores hablan de TODAS las órdenes vivas, no de lo que el filtro
    // muestra: si contaran lo filtrado, elegir "Listo" pondría el resto en cero
    // y no se podría volver.
    prisma.ordenDeTrabajo.groupBy({
      by: ['estado'],
      where: { anuladaEn: null },
      _count: { _all: true },
    }),
  ])

  const cuenta = new Map(porEstado.map((f) => [f.estado, f._count._all]))
  // El chip sin filtro cuenta las ABIERTAS y no la suma de todos los estados:
  // es el que devuelve al listado por defecto, así que su número tiene que ser
  // el de ese listado. Por eso se suma sobre ABIERTOS y no sobre `cuenta`.
  const abiertas = ABIERTOS.reduce((a, e) => a + (cuenta.get(e) ?? 0), 0)
  // Cuando se busca sin chip, el listado se sale de los chips: no hay ninguno
  // que esté "actual", y decirlo evita que el resultado parezca filtrado.
  const buscandoEnTodas = busqueda !== '' && filtro === null
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conParametros = (cambios: { p?: number; estado?: string | null }) => {
    const u = new URLSearchParams()
    if (busqueda) u.set('q', busqueda)
    const e = cambios.estado === undefined ? filtro : cambios.estado
    if (e) u.set('estado', e)
    if (cambios.p && cambios.p > 1) u.set('p', String(cambios.p))
    const s = u.toString()
    return s ? `/servicio-tecnico?${s}` : '/servicio-tecnico'
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Servicio Técnico</h1>
        <Button asChild>
          <Link href="/servicio-tecnico/nuevo">Recibir un equipo</Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {/* "Abiertas" y no "Todas": nunca contó las entregadas, y ahora que
            hay un chip para ésas el nombre viejo mentiría de verdad. */}
        {/* Ojo: no usa conParametros, que siempre reincorpora `q`. Este chip
            promete volver al tablero por defecto, y ese default no lleva
            búsqueda — arrastrar `q` dejaría el href idéntico a la URL actual
            durante una búsqueda, un chip que no hace nada. */}
        <Link
          href="/servicio-tecnico"
          aria-current={filtro === null && !buscandoEnTodas ? 'true' : undefined}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            filtro === null && !buscandoEnTodas
              ? 'border-primary font-semibold'
              : 'text-muted-foreground'
          }`}
        >
          Abiertas · {abiertas}
        </Link>
        {/* ESTADOS y no ABIERTOS: el chip de Entregadas es la otra mitad de que
            un equipo entregado se pueda volver a encontrar. Sale en el lugar
            que le toca del ciclo, porque ESTADOS está en ese orden. */}
        {ESTADOS.map((e) => (
          <Link
            key={e}
            href={conParametros({ estado: e, p: 1 })}
            aria-current={filtro === e ? 'true' : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              filtro === e ? 'border-primary font-semibold' : 'text-muted-foreground'
            }`}
          >
            {NOMBRE_ESTADO[e]} · {cuenta.get(e) ?? 0}
          </Link>
        ))}
      </div>

      <form className="mt-6 flex gap-2" action="/servicio-tecnico">
        {filtro ? <input type="hidden" name="estado" value={filtro} /> : null}
        <Input name="q" defaultValue={busqueda} placeholder="Número, cliente, modelo o IMEI" />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {buscandoEnTodas ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Buscando «{busqueda}» en todas las órdenes, incluidas las entregadas y las anuladas.{' '}
          <Link href="/servicio-tecnico" className="underline">
            Volver a las abiertas
          </Link>
        </p>
      ) : null}

      {ordenes.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {buscandoEnTodas
            ? `No apareció ninguna orden con «${busqueda}».`
            : 'No hay equipos que mostrar con estos filtros.'}
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {ordenes.map((o) => (
            <li key={o.id}>
              <Link href={`/servicio-tecnico/${o.id}`} className="flex gap-4 py-3">
                <span className="w-14 shrink-0 font-mono text-sm">#{o.numero}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {o.equipoMarca} {o.equipoModelo}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {o.cliente.nombre} · desde el {formatearFecha(o.creadoEn)}
                  </span>
                </span>
                {/* Anulada primero y el estado entre paréntesis: la orden
                    conserva el estado que tenía —anular es una columna—, así
                    que mostrar sólo "Recibido" haría pasar por viva a una que
                    no lo está. */}
                <span className="shrink-0 self-center text-sm">
                  {o.anuladaEn ? `Anulada (${NOMBRE_ESTADO[o.estado]})` : NOMBRE_ESTADO[o.estado]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {paginas > 1 ? (
        <nav className="mt-6 flex gap-3 text-sm">
          {pagina > 1 ? <Link href={conParametros({ p: pagina - 1 })}>Anterior</Link> : null}
          <span className="text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas ? <Link href={conParametros({ p: pagina + 1 })}>Siguiente</Link> : null}
        </nav>
      ) : null}
    </main>
  )
}
