import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

export default async function Inventario({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; inactivos?: string }>
}) {
  const sesion = await exigirSesion()
  const { q = '', p = '1', inactivos } = await searchParams

  const busqueda = q.trim()
  // Truncado y con techo, no sólo `Math.max`: `?p=2.3` daría un `skip` con
  // decimales y `?p=1e300` uno fuera del rango de un Int, y Prisma rechaza los
  // dos con un error que nadie atrapa — o sea un 500 servido desde un query
  // string escrito a mano. El techo es holgado a propósito: una página más allá
  // de los datos simplemente no muestra nada, que es la respuesta correcta.
  const PAGINA_MAXIMA = 1_000_000
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const verInactivos = inactivos === '1'

  const prisma = prismaParaTenant(sesion.tenant.id)
  const donde = {
    // `null` y no `undefined`: undefined le diría a Prisma "no filtres".
    ...(verInactivos ? {} : { desactivadoEn: null }),
    ...(busqueda
      ? {
          OR: [
            { nombre: { contains: busqueda, mode: 'insensitive' as const } },
            { sku: { contains: busqueda, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [articulos, total, negativos] = await Promise.all([
    prisma.articulo.findMany({
      where: donde,
      orderBy: { nombre: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, sku: true, nombre: true, tipo: true, precio: true,
        stock: true, desactivadoEn: true,
      },
    }),
    prisma.articulo.count({ where: donde }),
    // Sobre `donde` y no sobre toda la tabla: el conteo tiene que hablar de lo
    // que el listado está mostrando, o el subtítulo diría "3 con stock
    // negativo" mientras la búsqueda filtrada no muestra ninguno.
    // Sólo PRODUCTO: un servicio no lleva stock, y su columna es un guion.
    prisma.articulo.count({ where: { ...donde, tipo: 'PRODUCTO', stock: { lt: 0 } } }),
  ])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conParametros = (n: number) => {
    const u = new URLSearchParams()
    if (busqueda) u.set('q', busqueda)
    if (verInactivos) u.set('inactivos', '1')
    if (n > 1) u.set('p', String(n))
    const s = u.toString()
    return s ? `/inventario?${s}` : '/inventario'
  }

  return (
    <main className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">Inventario</h1>
          {/* Sólo si hay algo que contar: en un local recién dado de alta, un
              "0 artículos · 0 con stock negativo" es ruido debajo del título
              justo cuando la pantalla ya tiene su propio texto de vacío. */}
          {total > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {total === 1 ? '1 artículo' : `${total} artículos`}
              {verInactivos ? '' : ' activos'}
              {negativos > 0 &&
                ` · ${negativos === 1 ? '1 con stock negativo' : `${negativos} con stock negativo`}`}
            </p>
          )}
        </div>
        {sesion.usuario.rol === 'DUENO' && (
          <Button asChild size="sm">
            <Link href="/inventario/nuevo">Artículo nuevo</Link>
          </Button>
        )}
      </div>

      {/* method="get" y no una action: anda sin JavaScript, y la URL con la
          búsqueda adentro se puede compartir o dejar guardada. El buscador
          por código es además lo que habilita un lector de código de barras,
          que tipea y manda Enter. */}
      <form method="get" className="mb-6 flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar por nombre o código
          </label>
          <Input id="q" name="q" defaultValue={busqueda} />
        </div>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={verInactivos} />
          Ver desactivados
        </label>
        <Button type="submit" size="sm" variant="secondary">
          Buscar
        </Button>
      </form>

      {articulos.length === 0 ? (
        // Un local recién dado de alta llega acá con cero artículos, y ésta es
        // la primera pantalla que ve. En blanco no diría qué hacer.
        <p className="text-sm text-muted-foreground">
          {busqueda
            ? `No hay artículos que coincidan con "${busqueda}".`
            : sesion.usuario.rol === 'DUENO'
              ? 'Todavía no cargaste ningún artículo. Empezá por «Artículo nuevo».'
              : 'Todavía no hay artículos cargados.'}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Stock</th>
            </tr>
          </thead>
          <tbody>
            {articulos.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2">{a.sku}</td>
                <td>
                  <Link href={`/inventario/${a.id}`} className="underline">
                    {a.nombre}
                  </Link>
                  {a.desactivadoEn && (
                    <span className="ml-2 text-muted-foreground">(desactivado)</span>
                  )}
                </td>
                <td>{a.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}</td>
                {/* tabular-nums text-right en toda columna de plata o de
                    cantidad: sin eso las columnas bailan y comparar dos
                    precios de un vistazo deja de funcionar. */}
                <td className="text-right tabular-nums">{formatearPrecio(a.precio.toString())}</td>
                <td className="text-right tabular-nums">
                  {a.tipo === 'SERVICIO' ? (
                    // Un guion y NO un 0: el motor no le descuenta stock a un
                    // servicio (lib/ventas/crear.ts filtra por esProducto), así
                    // que un 0 se leería como faltante y alguien saldría a
                    // comprar lo que no existe.
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={a.stock.lessThan(0) ? 'text-destructive' : undefined}>
                      {formatearCantidad(a.stock.toString())}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {paginas > 1 && (
        <nav className="mt-6 flex items-center gap-4 text-sm">
          {pagina > 1 && (
            <Link href={conParametros(pagina - 1)} className="underline">
              ← Anterior
            </Link>
          )}
          <span className="text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas && (
            <Link href={conParametros(pagina + 1)} className="underline">
              Siguiente →
            </Link>
          )}
        </nav>
      )}
    </main>
  )
}
