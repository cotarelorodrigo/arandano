import Link from 'next/link'
import type { Prisma } from '@/generated/prisma/client'
import { Search } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import { estadoDeFila, ChipEstado, type EstadoDeFila } from './chip-estado'
import { PanelDeCategorias, SIN_CATEGORIA, categoriaDeQuery } from './panel-categorias'
import { arbolDeCategorias, cuentaSinCategoria, type RamaConHijas } from '@/lib/inventario/categorias'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

/** El filtro de tipo (design/arandano.pen, nodo `OgOlK`): `null` es "Todos". */
export type TipoFiltro = 'PRODUCTO' | 'SERVICIO'

/**
 * El `?tipo=` del query string, o `null` para "Todos".
 *
 * Cualquier valor que no sea uno de los dos válidos cae en "Todos" en vez de
 * filtrar por algo que no existe: mismo criterio que `fechaOhoy` en
 * `/ventas` y el clamp de `?p` acá mismo — un query string escrito a mano no
 * puede servir un 500 ni un listado vacío por un typo.
 */
export function tipoDeQuery(valor: string | undefined): TipoFiltro | null {
  return valor === 'PRODUCTO' || valor === 'SERVICIO' ? valor : null
}

/** La rama elegida, ya resuelta contra el árbol: qué ids de categoría entran
 *  en el filtro. `null` es "Todos". */
export type RamaElegida = { ids: string[] } | { sinCategoria: true }

/**
 * Traduce el `?cat` a la rama del árbol, o `null` si no corresponde a ninguna.
 *
 * **Filtrar por un rubro incluye a sus marcas**: elegir "Fundas" y ver sólo las
 * que no tienen marca sería casi ninguna, y no es lo que nadie espera. Es un
 * `OR` de un solo nivel —no una consulta recursiva— porque el árbol tiene dos.
 *
 * Un id bien formado que NO está en el árbol —una categoría borrada, o de otro
 * tenant, que RLS vuelve invisible— cae en "Todos". Filtrar a cero resultados
 * sin explicación es peor que ignorar el parámetro.
 */
export function ramaDelArbol(arbol: RamaConHijas[], cat: string | null): RamaElegida | null {
  if (cat === null) return null
  if (cat === SIN_CATEGORIA) return { sinCategoria: true }
  for (const rubro of arbol) {
    if (rubro.id === cat) return { ids: [rubro.id, ...rubro.hijas.map((h) => h.id)] }
    const marca = rubro.hijas.find((h) => h.id === cat)
    if (marca) return { ids: [marca.id] }
  }
  return null
}

/** El `where` de Prisma para el listado: el mismo para la página, el conteo
 *  total y el conteo de negativos, así que las tres cosas de la pantalla
 *  hablan siempre del mismo conjunto de filas. */
export function construirDonde({
  busqueda,
  verInactivos,
  tipo,
  categoria = null,
}: {
  busqueda: string
  verInactivos: boolean
  tipo: TipoFiltro | null
  categoria?: RamaElegida | null
}): Prisma.ArticuloWhereInput {
  return {
    // `null` literal y no `undefined`: acá el null ES el filtro ("los que no
    // cuelgan de ninguna rama"), mientras undefined le diría a Prisma que no
    // filtre. Son dos cosas distintas y el spread de abajo las distingue.
    ...(categoria === null
      ? {}
      : 'sinCategoria' in categoria
        ? { categoriaId: null }
        : { categoriaId: { in: categoria.ids } }),
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
    ...(tipo ? { tipo } : {}),
  }
}

/**
 * El link a `/inventario` con el filtro que corresponda — usado por la
 * paginación y por las tabs de Tipo. Es el mismo mecanismo que ya manejaba
 * `verInactivos` y la paginación por query string: las tabs son un filtro
 * más, del mismo tipo, no un mecanismo nuevo.
 */
export function hrefListado({
  busqueda,
  verInactivos,
  tipo,
  cat = null,
  pagina,
  conservarPagina = false,
}: {
  busqueda: string
  verInactivos: boolean
  tipo: TipoFiltro | null
  cat?: string | null
  pagina?: number
  /** Sólo la paginación la conserva. Ver el comentario de abajo. */
  conservarPagina?: boolean
}): string {
  const u = new URLSearchParams()
  if (busqueda) u.set('q', busqueda)
  if (verInactivos) u.set('inactivos', '1')
  if (tipo) u.set('tipo', tipo)
  if (cat) u.set('cat', cat)
  // Cambiar de rama o de filtro DESCARTA la página, y sólo la paginación pide
  // conservarla: quedarse en la página 3 de un listado que ahora tiene ocho
  // artículos muestra un vacío que parece un error.
  if (conservarPagina && pagina && pagina > 1) u.set('p', String(pagina))
  const s = u.toString()
  return s ? `/inventario?${s}` : '/inventario'
}

/**
 * Hasta 5 números de página centrados en `actual`, recortados a `[1, total]`.
 *
 * Copiado de `app/(app)/ventas/page.tsx` (mismo nombre, mismo cuerpo): es
 * chico y autocontenido, y esta task no es el ciclo que extrae el duplicado a
 * un lib compartido — queda anotado acá para quien lo haga.
 */
export function ventanaDePaginas(actual: number, total: number): number[] {
  if (total <= 0) return []
  const tam = Math.min(5, total)
  const inicioCentrado = actual - Math.floor(tam / 2)
  const fin = Math.min(total, Math.max(tam, inicioCentrado + tam - 1))
  const inicio = fin - tam + 1
  const out: number[] = []
  for (let n = inicio; n <= fin; n++) out.push(n)
  return out
}

const VALOR_TODOS = 'TODOS'

const OPCIONES_TIPO: { valor: TipoFiltro | null; rotulo: string }[] = [
  { valor: null, rotulo: 'Todos' },
  { valor: 'PRODUCTO', rotulo: 'Productos' },
  { valor: 'SERVICIO', rotulo: 'Servicios' },
]

/**
 * La fila de filtros (design/arandano.pen, nodo `PmgHg`): buscador, la
 * pastilla "Ver desactivados" y el segmentado de Tipo.
 *
 * El buscador y "Ver desactivados" viven en un `<form method="get">` propio,
 * con un botón "Buscar" de submit real: el checkbox por sí solo no dispara
 * nada al tildarlo (nunca lo hizo, ni con el `<input>` nativo de antes ni con
 * el `Checkbox` de shadcn que se probó en su lugar), así que sin un submit
 * explícito la única forma de aplicar el filtro era poner el foco en el
 * buscador y apretar Enter — algo que nadie descubre solo. El checkbox es un
 * `<input type="checkbox">` nativo y no el `Checkbox` de shadcn a propósito:
 * ese último es un `<button type="button" role="checkbox">` cuyo toggle lo
 * arma React — sin JavaScript ni siquiera se puede tildar. El tipo activo
 * viaja como campo oculto para no perderse al tipear una búsqueda o tildar la
 * pastilla.
 *
 * El segmentado de Tipo es tres `<Link>` a secas, con la clase condicionada a
 * si `o.valor === tipo` — el mismo mecanismo (y el mismo criterio) que ya usa
 * `/ventas` para su segmentado de rango. **No** el `Tabs` de shadcn: la
 * versión anterior de esta task lo usaba con `TabsTrigger asChild` envolviendo
 * el `Link`, sin ningún `TabsContent` (I8 de la review) — no hay ningún panel
 * que estas "tabs" controlen, sólo un filtro que navega, así que cada
 * `aria-controls` que Radix generaba apuntaba a un id que no existe (una
 * referencia ARIA rota), y el roving `tabindex` del widget dejaba las tres
 * con `tabindex="-1"` en el HTML servido: con mouse se podía elegir cualquiera,
 * pero con teclado y sin JavaScript ninguna era alcanzable. Un link plano no
 * tiene ese problema — es nativamente enfocable y no reclama un rol de pestaña
 * que no puede cumplir.
 */
export function FiltrosDeInventario({
  busqueda,
  verInactivos,
  tipo,
  cat = null,
}: {
  busqueda: string
  verInactivos: boolean
  tipo: TipoFiltro | null
  cat?: string | null
}) {
  return (
    <div className="flex items-center gap-[10px]">
      <form method="get" className="flex flex-1 items-center gap-[10px]">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        {/* Por lo mismo que el tipo: sin esto, tipear una búsqueda desde una
            rama seleccionada la pierde, y el resultado sale de todo el
            catálogo cuando la persona creía estar buscando adentro del rubro. */}
        {cat && <input type="hidden" name="cat" value={cat} />}
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            name="q"
            defaultValue={busqueda}
            aria-label="Buscar por nombre o código"
            placeholder="Buscar por nombre o código"
            className="h-10 rounded-[9px] border-input bg-card pl-9 text-sm"
          />
        </div>
        <label className="flex h-10 items-center gap-2 rounded-[9px] border border-input bg-card px-[13px] text-[13px] font-normal text-foreground-soft">
          <input
            type="checkbox"
            name="inactivos"
            value="1"
            defaultChecked={verInactivos}
            className="size-[15px] rounded-[4px] border-input accent-primary"
          />
          Ver desactivados
        </label>
        <Button type="submit" size="sm" variant="secondary">
          Buscar
        </Button>
      </form>
      <div className="flex h-auto gap-0.5 rounded-[10px] bg-muted p-[3px]">
        {OPCIONES_TIPO.map((o) => (
          <Link
            key={o.valor ?? VALOR_TODOS}
            href={hrefListado({ busqueda, verInactivos, tipo: o.valor, cat })}
            className={
              o.valor === tipo
                ? 'rounded-lg bg-card px-[13px] py-[7px] text-[12px] font-semibold text-foreground shadow-sm'
                : 'rounded-lg px-[13px] py-[7px] text-[12px] font-medium text-muted-foreground'
            }
          >
            {o.rotulo}
          </Link>
        ))}
      </div>
    </div>
  )
}

/** El tratamiento de la celda Código/Precio: `$ar-ink-2` normal, `$ar-ink-3`
 *  (más apagado) cuando el artículo está desactivado — design/arandano.pen,
 *  filas `wU1j7` (normal) vs. `iZwha` (desactivada). */
function claseCodigoOPrecio(desactivado: boolean): string {
  return desactivado ? 'text-muted-foreground' : 'text-foreground-soft'
}

/** El tratamiento de la celda Stock, según el estado de la fila —
 *  design/arandano.pen: negativo en rojo y en negrita (700), queda poco en
 *  el color de aviso, desactivado apagado y sin negrita, el resto normal
 *  (600). Un servicio nunca pasa por acá: su celda es un guion aparte. */
function claseStock(estado: EstadoDeFila): string {
  switch (estado) {
    case 'DESACTIVADO':
      return 'font-normal text-muted-foreground'
    case 'NEGATIVO':
      return 'font-bold text-destructive'
    case 'QUEDA_POCO':
      return 'font-semibold text-warn'
    default:
      return 'font-semibold text-foreground'
  }
}

export default async function Inventario({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; p?: string; inactivos?: string; tipo?: string; cat?: string
  }>
}) {
  const sesion = await exigirSesion()
  const { q = '', p = '1', inactivos, tipo: tipoQuery, cat: catQuery } = await searchParams

  const busqueda = q.trim()
  // Truncado y con techo, no sólo `Math.max`: `?p=2.3` daría un `skip` con
  // decimales y `?p=1e300` uno fuera del rango de un Int, y Prisma rechaza los
  // dos con un error que nadie atrapa — o sea un 500 servido desde un query
  // string escrito a mano. El techo es holgado a propósito: una página más allá
  // de los datos simplemente no muestra nada, que es la respuesta correcta.
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const verInactivos = inactivos === '1'
  const tipo = tipoDeQuery(tipoQuery)

  const prisma = prismaParaTenant(sesion.tenant.id)

  // El árbol va primero y solo: `ramaDelArbol` lo necesita para saber qué ids
  // entran en el filtro —un rubro arrastra a sus marcas—, así que no puede
  // ir en el Promise.all de abajo.
  const [arbol, sinCategoria] = await Promise.all([
    arbolDeCategorias(sesion.tenant.id, { verInactivos }),
    cuentaSinCategoria(sesion.tenant.id, { verInactivos }),
  ])
  const catPedida = categoriaDeQuery(catQuery)
  const rama = ramaDelArbol(arbol, catPedida)
  // Si el id no correspondía a ninguna rama, la pantalla se comporta como
  // "Todos" — y el panel tampoco marca ninguna fila como activa.
  const cat = rama === null ? null : catPedida

  const donde = construirDonde({ busqueda, verInactivos, tipo, categoria: rama })

  const [articulos, total, negativos] = await Promise.all([
    prisma.articulo.findMany({
      where: donde,
      orderBy: { nombre: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, sku: true, nombre: true, tipo: true, precio: true,
        stock: true, desactivadoEn: true, categoria: true,
      },
    }),
    prisma.articulo.count({ where: donde }),
    // Sobre `donde` y no sobre toda la tabla: el conteo tiene que hablar de lo
    // que el listado está mostrando, o el subtítulo diría "3 con stock
    // negativo" mientras la búsqueda filtrada no muestra ninguno. Con la tab
    // "Servicios" activa ningún artículo visible tiene stock —ninguno es un
    // PRODUCTO—, así que el conteo se fuerza a 0 sin ni siquiera consultar:
    // lo contrario sería contar productos negativos que la tab ni muestra.
    tipo === 'SERVICIO'
      ? 0
      : prisma.articulo.count({ where: { ...donde, tipo: 'PRODUCTO', stock: { lt: 0 } } }),
  ])

  // La cuenta de "Todos los artículos" del panel: el CATÁLOGO, no el resultado.
  // `total` está filtrado por búsqueda, tipo y rama; usarlo acá haría que
  // todas las ramas mostraran 0 apenas se escribe algo en el buscador, y el
  // árbol dejaría de servir para navegar justo cuando más se lo necesita.
  const totalDelCatalogo =
    arbol.reduce((t, rubro) => t + rubro.cuenta, 0) + sinCategoria

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  return (
    <>
      <Encabezado
        titulo="Inventario"
        subtitulo={
          /* Sólo si hay algo que contar: en un local recién dado de alta, un
             "0 artículos · 0 con stock negativo" es ruido debajo del título
             justo cuando la pantalla ya tiene su propio texto de vacío. */
          total > 0 ? (
            <>
              {total === 1 ? '1 artículo' : `${total} artículos`}
              {verInactivos ? '' : ' activos'}
              {negativos > 0 &&
                ` · ${negativos === 1 ? '1 con stock negativo' : `${negativos} con stock negativo`}`}
            </>
          ) : undefined
        }
        acciones={
          sesion.usuario.rol === 'DUENO' ? (
            <Button asChild size="sm">
              <Link href="/inventario/nuevo">Artículo nuevo</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <FiltrosDeInventario busqueda={busqueda} verInactivos={verInactivos} tipo={tipo} cat={cat} />

        {/* El frame `Contenido` de la maqueta (design/arandano.pen): el panel
            de 248 a la izquierda y el listado ocupando lo que queda. Los
            filtros quedan ARRIBA, cruzando las dos columnas, porque el
            buscador manda sobre las dos. */}
        <div className="flex flex-1 items-stretch gap-4">
          <PanelDeCategorias
            arbol={arbol}
            total={totalDelCatalogo}
            sinCategoria={sinCategoria}
            activa={cat}
            esDuenio={sesion.usuario.rol === 'DUENO'}
            href={(destino) => hrefListado({ busqueda, verInactivos, tipo, cat: destino })}
          />

        {/* El listado, dentro de su propia card (design/arandano.pen, nodo
            `BT29h`) — antes era una <table> suelta en la pantalla. */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
          {articulos.length === 0 ? (
            <p className="p-[18px] text-sm text-muted-foreground">
              {/* Los dos vacíos no son el mismo vacío (hallazgo M8 del
                  barrido final): con `total > 0` la página quedó fuera de
                  rango (`?p` se clampea a [1, 1.000.000], no a `paginas`), y
                  el <nav> de paginación vive DENTRO de la rama
                  `articulos.length > 0` de más abajo — sin este link, ese
                  vacío por página fuera de rango no ofrece ningún control
                  para volver, y quien llegó ahí (un link viejo, una URL
                  editada a mano) queda sin forma de ver el listado salvo
                  editando la URL de nuevo. Mismo criterio que ya usa
                  `/ventas` para el mismo caso. */}
              {total > 0 ? (
                <>
                  Esta página no tiene artículos.{' '}
                  <Link href={hrefListado({ busqueda, verInactivos, tipo, cat, pagina: 1 })} className="underline">
                    Volver a la primera
                  </Link>
                  .
                </>
              ) : cat ? (
                /* El vacío CON una rama activa necesita salida, y por eso es su
                   propio caso y no el mensaje de búsqueda de abajo: sin este
                   link, buscar algo que existe pero está en otra rama se ve
                   exactamente igual que buscar algo que no existe. El link
                   limpia la rama y CONSERVA la búsqueda, que es lo que la
                   persona quería hacer. */
                <>
                  {busqueda
                    ? `No hay artículos que coincidan con "${busqueda}" en esta categoría.`
                    : 'Esta categoría todavía no tiene artículos.'}{' '}
                  <Link
                    href={hrefListado({ busqueda, verInactivos, tipo, cat: null })}
                    className="underline"
                  >
                    Buscar en todo el inventario
                  </Link>
                  .
                </>
              ) : busqueda ? (
                // Un local recién dado de alta llega acá con cero artículos, y ésta es
                // la primera pantalla que ve. En blanco no diría qué hacer.
                `No hay artículos que coincidan con "${busqueda}".`
              ) : sesion.usuario.rol === 'DUENO' ? (
                'Todavía no cargaste ningún artículo. Empezá por «Artículo nuevo».'
              ) : (
                'Todavía no hay artículos cargados.'
              )}
            </p>
          ) : (
            <>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="h-auto w-[100px] px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Código
                    </TableHead>
                    <TableHead className="h-auto px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Nombre
                    </TableHead>
                    <TableHead className="h-auto w-[110px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Tipo
                    </TableHead>
                    <TableHead className="h-auto w-[140px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Precio
                    </TableHead>
                    <TableHead className="h-auto w-[110px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Stock
                    </TableHead>
                    {/* Sin rótulo, a propósito (design/arandano.pen, nodo
                        `BIcFE`): es el encabezado del chip de estado, y la
                        mayoría de las filas no lleva ninguno. */}
                    <TableHead className="h-auto w-[120px] px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold text-muted-foreground" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {articulos.map((a) => {
                    const desactivado = a.desactivadoEn !== null
                    const estado = estadoDeFila({ tipo: a.tipo, stock: a.stock, desactivado })
                    return (
                      <TableRow key={a.id}>
                        <TableCell
                          className={cn(
                            estilos.archivo,
                            'p-[11px] px-[7px] pl-[18px] text-sm',
                            claseCodigoOPrecio(desactivado),
                          )}
                        >
                          {a.sku}
                        </TableCell>
                        <TableCell className="p-[11px] px-[7px] whitespace-normal">
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/inventario/${a.id}`}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {a.nombre}
                            </Link>
                            {/* Segunda línea, bajo el nombre (nodo `HU2a7`):
                                un string de dos niveles ya tipeado a mano por
                                quien carga el artículo ("Accesorios ·
                                Protección"), no una jerarquía que el código
                                interprete. Ausente en la mayoría de los
                                artículos hoy: nullable, y sin ella la fila
                                no pierde ninguna línea. */}
                            {a.categoria && (
                              <span className="text-[11px] text-muted-foreground">{a.categoria}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="p-[11px] px-[7px] text-foreground">
                          {a.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            estilos.archivo,
                            'p-[11px] px-[7px] text-right font-semibold tabular-nums',
                            claseCodigoOPrecio(desactivado),
                          )}
                        >
                          {formatearPrecio(a.precio.toString())}
                        </TableCell>
                        <TableCell
                          className={cn(
                            estilos.archivo,
                            'p-[11px] px-[7px] text-right tabular-nums',
                            a.tipo === 'SERVICIO' ? 'font-normal text-muted-foreground' : claseStock(estado),
                          )}
                        >
                          {a.tipo === 'SERVICIO' ? (
                            // Un guion y NO un 0: el motor no le descuenta
                            // stock a un servicio (lib/ventas/crear.ts filtra
                            // por esProducto), así que un 0 se leería como
                            // faltante y alguien saldría a comprar lo que no
                            // existe.
                            '—'
                          ) : (
                            formatearCantidad(a.stock.toString())
                          )}
                        </TableCell>
                        <TableCell className="p-[11px] px-[7px] pr-[18px] text-right">
                          <ChipEstado estado={estado} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {paginas > 1 && (
                <nav
                  aria-label="Paginación"
                  className="mt-auto flex items-center justify-between border-t px-[18px] py-3"
                >
                  <span className="text-[12px] text-muted-foreground">
                    {formatearCantidad(String((pagina - 1) * POR_PAGINA + 1))}–
                    {formatearCantidad(String(Math.min(pagina * POR_PAGINA, total)))} de{' '}
                    {formatearCantidad(String(total))} {total === 1 ? 'artículo' : 'artículos'}
                  </span>
                  <div className="flex items-center gap-[6px]">
                    {ventanaDePaginas(pagina, paginas).map((n) =>
                      n === pagina ? (
                        <Button
                          key={n}
                          type="button"
                          aria-current="page"
                          size="icon-sm"
                          className={`${estilos.archivo} size-[30px] rounded-lg text-[13px] font-semibold`}
                        >
                          {n}
                        </Button>
                      ) : (
                        <Button
                          key={n}
                          asChild
                          variant="outline"
                          size="icon-sm"
                          className={`${estilos.archivo} size-[30px] rounded-lg text-[13px] font-semibold text-foreground-soft`}
                        >
                          <Link href={hrefListado({ busqueda, verInactivos, tipo, cat, pagina: n, conservarPagina: true })}>{n}</Link>
                        </Button>
                      ),
                    )}
                  </div>
                </nav>
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </>
  )
}
