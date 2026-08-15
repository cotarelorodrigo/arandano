import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearFecha } from '@/lib/formato/mostrar'
import { ESTADOS, ABIERTOS, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
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
  const donde = {
    anuladaEn: null,
    // Sin filtro explícito, las ABIERTAS: el equipo entregado ya no es problema
    // de nadie, y el tablero es la lista de lo que sigue en el local.
    estado: filtro ? { equals: filtro } : { in: [...ABIERTOS] },
    ...(busqueda
      ? {
          OR: [
            { equipoModelo: { contains: busqueda, mode: 'insensitive' as const } },
            { equipoMarca: { contains: busqueda, mode: 'insensitive' as const } },
            { equipoSerie: { contains: busqueda, mode: 'insensitive' as const } },
            { cliente: { nombre: { contains: busqueda, mode: 'insensitive' as const } } },
            // El número se busca como número, no como texto: `?q=42` tiene que
            // encontrar la orden 42 y no las que contienen un 4 y un 2.
            ...(Number.isInteger(Number(busqueda)) ? [{ numero: Number(busqueda) }] : []),
          ],
        }
      : {}),
  }

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
        cliente: { select: { nombre: true } },
      },
    }),
    prisma.ordenDeTrabajo.count({ where: donde }),
    // Los contadores hablan de TODAS las abiertas, no de lo que el filtro
    // muestra: si contaran lo filtrado, elegir "Listo" pondría el resto en cero
    // y no se podría volver.
    prisma.ordenDeTrabajo.groupBy({
      by: ['estado'],
      where: { anuladaEn: null, estado: { in: [...ABIERTOS] } },
      _count: { _all: true },
    }),
  ])

  const cuenta = new Map(porEstado.map((f) => [f.estado, f._count._all]))
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
        <Link
          href={conParametros({ estado: null, p: 1 })}
          aria-current={filtro === null ? 'true' : undefined}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            filtro === null ? 'border-primary font-semibold' : 'text-muted-foreground'
          }`}
        >
          Todas · {[...cuenta.values()].reduce((a, b) => a + b, 0)}
        </Link>
        {ABIERTOS.map((e) => (
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

      {ordenes.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No hay equipos que mostrar con estos filtros.
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
                <span className="shrink-0 self-center text-sm">{NOMBRE_ESTADO[o.estado]}</span>
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
