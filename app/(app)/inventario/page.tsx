import Link from 'next/link'
import type { Prisma } from '@/generated/prisma/client'
import { Search, Plus, ListTree, X } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
import { estadoDeFila, ChipEstado, type EstadoDeFila } from './chip-estado'
import { PanelDeCategorias } from './panel-categorias'
import {
  SIN_CATEGORIA, categoriaDeQuery, tipoDeQuery, hrefListado, type TipoFiltro,
} from './consulta'

// Re-export para los tests y para quien ya los importaba de acá. Los VALORES
// viven en `./consulta`, que no lleva 'use client' ni toca la base: el panel
// de categorías es un Client Component y necesita `hrefListado`, y Next no
// deja pasarle una función como prop.
export { tipoDeQuery, hrefListado, type TipoFiltro }
import { arbolDeCategorias, cuentaSinCategoria, type RamaConHijas } from '@/lib/inventario/categorias'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

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

/**
 * El nombre a mostrar de la rama activa — el chip del teléfono (design/
 * arandano.pen, nodo `o0cWFv`) lo necesita resuelto contra el árbol, porque
 * `cat` en la URL es sólo un id (o el valor reservado de "sin categoría").
 *
 * No usa `ramaDelArbol`: aquella resuelve a QUÉ IDS filtrar (un rubro
 * arrastra a sus marcas); ésta resuelve el NOMBRE de la rama elegida en sí,
 * que es un dato distinto.
 */
export function nombreDeRama(arbol: RamaConHijas[], cat: string | null): string | null {
  if (cat === null) return null
  if (cat === SIN_CATEGORIA) return 'Sin categoría'
  for (const rubro of arbol) {
    if (rubro.id === cat) return rubro.nombre
    const marca = rubro.hijas.find((h) => h.id === cat)
    if (marca) return marca.nombre
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
 *
 * **Task 6 del ciclo móvil.** El teléfono (design/arandano.pen, `b1jiWO` >
 * `UMq99`) apila el buscador arriba y deja el segmentado a ancho completo
 * junto al botón de 36px que abre el árbol de categorías en un `Sheet` — ese
 * botón se recibe YA ARMADO en `panelCategorias` (mismo criterio que
 * `controlMovil` de `Encabezado`: quien lo arma necesita `arbol`, el total
 * del catálogo y `puedeCategorias`, datos que esta función no usa para nada
 * más).
 * "Ver desactivados" y "Buscar" no los dibuja la maqueta, pero no se sacan —
 * silencio del `.pen` no es instrucción de borrar una capacidad real (mismo
 * criterio que el typeahead de `/vender`); pasan a su propia fila mobile-
 * first, y en escritorio `lg:contents` los devuelve a la fila única de
 * siempre.
 */
export function FiltrosDeInventario({
  busqueda,
  verInactivos,
  tipo,
  cat = null,
  panelCategorias,
}: {
  busqueda: string
  verInactivos: boolean
  tipo: TipoFiltro | null
  cat?: string | null
  /** El botón de 36px + `Sheet` que abre el árbol de categorías en el
   *  teléfono (`lg:hidden` ya resuelto por quien lo arma) — ver el docblock
   *  de esta función. */
  panelCategorias?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-[10px] lg:flex-row lg:items-center">
      <form method="get" className="flex flex-col gap-[10px] lg:flex-1 lg:flex-row lg:items-center">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        {/* Por lo mismo que el tipo: sin esto, tipear una búsqueda desde una
            rama seleccionada la pierde, y el resultado sale de todo el
            catálogo cuando la persona creía estar buscando adentro del rubro. */}
        {cat && <input type="hidden" name="cat" value={cat} />}
        <div className="relative lg:flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
          />
          {/* `h-10` (40px) y no los 46px que dibuja `v3Epdn` (el frame
              "Buscador" de `Móvil / Inventario`): decisión deliberada de
              consistencia, no un olvido. `h-10 rounded-[9px]` es la altura
              de CUALQUIER input de esta app —los buscadores de `/ventas` y
              `/servicio-tecnico`, y cada campo de `formularios.tsx` en esta
              misma carpeta y en `/usuarios`, `/vender`— así que 46px acá
              haría que este buscador fuera el único de la aplicación con su
              propia altura, sin ganar nada a cambio (el resto del frame ya
              sigue la maqueta al pixel). */}
          <Input
            name="q"
            defaultValue={busqueda}
            aria-label="Buscar por nombre o código"
            placeholder="Buscar por nombre o código"
            className="h-10 w-full rounded-[9px] border-input bg-card pl-9 text-sm"
          />
        </div>
        {/* "Ver desactivados" + "Buscar": su propia fila en el teléfono, sin
            dibujo propio en la maqueta; `lg:contents` los devuelve a la fila
            única de escritorio de siempre. */}
        <div className="flex items-center gap-[10px] lg:contents">
          <label className="flex h-10 flex-1 items-center gap-2 rounded-[9px] border border-input bg-card px-[13px] text-[13px] font-normal text-foreground-soft lg:flex-initial">
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
        </div>
      </form>
      {/* El segmentado + el botón de categorías: una sola fila en el
          teléfono (`UMq99`); `lg:contents` la disuelve en escritorio, donde
          el botón desaparece (`lg:hidden`, armado por quien pasa
          `panelCategorias`) y el segmentado vuelve a ser el único hermano
          del form, igual que siempre. */}
      <div className="flex items-center gap-2 lg:contents">
        {/* `flex-1` y `text-center` van EN EL CONTENEDOR Y EN CADA OPCIÓN, y
            los dos se apagan en escritorio. Guardar sólo el contenedor no
            alcanza: a ≥1024 vuelve a `flex: 0 1 auto`, o sea que su ancho lo
            fija el contenido — y el tamaño intrínseco de un contenedor flex
            cuyos ítems son todos `flex: 1 1 0%` es n × el ítem más ancho, así
            que el control se ensancharía y las tres pastillas pasarían a medir
            lo mismo. Antes de esta rama ninguno de los dos existía. Mismo
            tratamiento que el segmentado hermano de /ventas, del que sale
            `lg:flex-none` para las opciones: con el contenedor ya dimensionado
            por su contenido, `flex-none` y `flex-initial` dan exactamente el
            mismo ancho, y así las dos pantallas dicen lo mismo. */}
        <div className="flex h-auto flex-1 gap-0.5 rounded-[10px] bg-muted p-[3px] lg:flex-initial">
          {OPCIONES_TIPO.map((o) => (
            <Link
              key={o.valor ?? VALOR_TODOS}
              href={hrefListado({ busqueda, verInactivos, tipo: o.valor, cat })}
              className={
                o.valor === tipo
                  ? 'flex-1 rounded-lg bg-card px-[13px] py-[7px] text-center text-[12px] font-semibold text-foreground shadow-sm lg:flex-none lg:text-left'
                  : 'flex-1 rounded-lg px-[13px] py-[7px] text-center text-[12px] font-medium text-muted-foreground lg:flex-none lg:text-left'
              }
            >
              {o.rotulo}
            </Link>
          ))}
        </div>
        {panelCategorias}
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

/** Una fila ya resuelta a texto, lista para `Listado`: sin `Decimal` de
 *  Prisma ni ningún otro tipo que no cruce limpio a un fixture de test —
 *  mismo criterio que `FilaDeVenta` en `app/(app)/ventas/page.tsx`. */
export type FilaDeArticulo = {
  id: string
  sku: string
  nombre: string
  categoria: string | null
  tipo: 'PRODUCTO' | 'SERVICIO'
  precioFormateado: string
  /** Ya resuelto — "—" para un servicio, la cantidad formateada si no. Un
   *  solo cómputo (`Inventario`, más abajo): lo muestran por igual la celda
   *  de escritorio y la línea de meta del teléfono. */
  stockTexto: string
  estado: EstadoDeFila
  desactivado: boolean
}

/**
 * El listado: el patrón grid + `display:contents` de la Task 4 (docblock de
 * referencia en `app/(app)/ventas/page.tsx:344-408` — leerlo antes de tocar
 * este componente). Extraído como componente puro (Task 6, ronda de
 * arreglos 1), mismo criterio que `Listado` de `/ventas`: sin esto, la única
 * forma de cubrir el grid, los roles ARIA y las cuatro reglas del patrón era
 * un `readFileSync` + `toContain` sobre el fuente, que no puede distinguir
 * un `cn()` mal compuesto o un anidamiento roto de uno bien puesto — sólo
 * confirma que la substring aparece en algún lugar del archivo. Con esto
 * renderizado de verdad, un test puede afirmar sobre el HTML real. (El chip
 * de la rama activa y el resto de lo que vive directo en `Inventario` —el
 * `<Encabezado>`, el `Sheet` de categorías— siguen sin poder renderizarse:
 * ver el comentario de cabecera de `page.test.tsx`.)
 *
 * Las seis anchuras del `grid-cols` son las mismas que declaraban sus
 * encabezados de antes (100, auto→1fr, 110, 140, 110, 120), y el DOM de
 * cada fila mantiene el MISMO orden 1-a-6 de esas columnas (Código, Nombre,
 * Tipo, Precio, Stock, Estado) — a propósito, sin ningún `order`/`col-start`
 * explícito: mezclarlos con el auto-placement de Grid invita a bugs de
 * packing imposibles de ver sin un browser real (este repo no tiene jsdom).
 *
 * Lo que en el teléfono (design/arandano.pen, `b5J1gV` > `QqV26`) se ve como
 * "Nombre" y "Precio" adyacentes en una sola línea es, en realidad, la fila
 * entera en `flex-wrap`: Código y Tipo —entre medio de Nombre y Precio en el
 * DOM— están `hidden` en el teléfono (`display:none`, fuera del flujo), así
 * que Nombre y Precio quedan pegados igual, sin hueco. La línea de meta (más
 * abajo, con Código+categoría fundidos, el chip y el stock) fuerza el salto
 * a una segunda línea con `basis-full`. En escritorio esa línea de meta se
 * saca entera (`lg:hidden`, no consume columna) y las cuatro celdas ocultas
 * del teléfono vuelven a mostrarse — el resultado es exactamente la tabla de
 * seis columnas de siempre.
 */
export function Listado({
  filas,
  total,
  pagina,
  paginas,
  porPagina,
  busqueda,
  verInactivos,
  tipo,
  cat,
  puedeCrear,
}: {
  filas: FilaDeArticulo[]
  total: number
  pagina: number
  paginas: number
  porPagina: number
  busqueda: string
  verInactivos: boolean
  tipo: TipoFiltro | null
  cat: string | null
  /** El permiso `ARTICULOS_CREAR`: lo único que cambia acá es el texto del
   *  vacío — "Empezá por «Artículo nuevo»" sólo tiene sentido para quien
   *  puede apretar ese botón. */
  puedeCrear: boolean
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
      {filas.length === 0 ? (
        <p className="p-[14px] text-sm text-muted-foreground lg:p-[18px]">
          {/* Los dos vacíos no son el mismo vacío (hallazgo M8 del
              barrido final): con `total > 0` la página quedó fuera de
              rango (`?p` se clampea a [1, 1.000.000], no a `paginas`), y
              el <nav> de paginación vive DENTRO de la rama
              `filas.length > 0` de más abajo — sin este link, ese
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
          ) : puedeCrear ? (
            'Todavía no cargaste ningún artículo. Empezá por «Artículo nuevo».'
          ) : (
            'Todavía no hay artículos cargados.'
          )}
        </p>
      ) : (
        <>
          <div role="table" className="grid grid-cols-1 lg:grid-cols-[100px_1fr_110px_140px_110px_120px]">
            <div role="row" className="hidden lg:contents">
              <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Código
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Nombre
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Tipo
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Precio
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Stock
              </div>
              {/* Sin rótulo, a propósito (design/arandano.pen, nodo
                  `BIcFE`): es el encabezado del chip de estado, y la
                  mayoría de las filas no lleva ninguno. */}
              <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold text-muted-foreground" />
            </div>

            {filas.map((f) => {
              const claseStockCelda =
                f.tipo === 'SERVICIO' ? 'font-normal text-muted-foreground' : claseStock(f.estado)
              // La línea de meta del teléfono (nodo `w6wW2e`): código +
              // categoría fundidos en un solo texto — la categoría sólo
              // si existe, mismo dato que la segunda línea de Nombre en
              // escritorio.
              const detalleMovil = f.categoria ? `${f.sku} · ${f.categoria}` : f.sku
              return (
                <div
                  key={f.id}
                  role="row"
                  className="group flex flex-wrap items-center gap-x-[10px] gap-y-[5px] border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
                >
                  {/* Código: se funde en la línea de meta del teléfono
                      (más abajo); su propia celda queda oculta ahí y
                      vuelve en escritorio. */}
                  <div
                    role="cell"
                    className={cn(
                      estilos.archivo,
                      'hidden whitespace-nowrap text-sm lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors',
                      claseCodigoOPrecio(f.desactivado),
                    )}
                  >
                    <div className="lg:flex lg:h-full lg:items-center">{f.sku}</div>
                  </div>

                  {/* Nombre: la celda más alta de la fila cuando hay
                      categoría (dos líneas) — por eso no lleva el
                      envoltorio de centrado que sí llevan las demás, ver
                      el docblock de esta función. */}
                  <div
                    role="cell"
                    className="min-w-0 flex-1 text-sm lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                  >
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/inventario/${f.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {f.nombre}
                      </Link>
                      {/* Segunda línea, bajo el nombre (nodo `HU2a7`):
                          un string de dos niveles ya tipeado a mano por
                          quien carga el artículo ("Accesorios ·
                          Protección"), no una jerarquía que el código
                          interprete. Ausente en la mayoría de los
                          artículos hoy: nullable, y sin ella la fila no
                          pierde ninguna línea. Sólo en escritorio: en el
                          teléfono el mismo dato ya sale en la línea de
                          meta, junto al código. */}
                      {f.categoria && (
                        <span className="hidden text-[11px] text-muted-foreground lg:block">
                          {f.categoria}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Tipo: no tiene equivalente visible en el teléfono
                      (el "Producto"/"Servicio" ya se lee de si Stock
                      muestra unidades o un guion) — sólo escritorio. */}
                  <div
                    role="cell"
                    className="hidden whitespace-nowrap text-sm text-foreground lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                  >
                    <div className="lg:flex lg:h-full lg:items-center">
                      {f.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}
                    </div>
                  </div>

                  {/* Precio: junto a Nombre en la misma línea del
                      teléfono (`shrink-0`, nunca se lo pisa el nombre
                      largo gracias al `min-w-0` de arriba). */}
                  <div
                    role="cell"
                    className={cn(
                      estilos.archivo,
                      'shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors',
                      claseCodigoOPrecio(f.desactivado),
                    )}
                  >
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                      {f.precioFormateado}
                    </div>
                  </div>

                  {/* Stock, y en el teléfono la LÍNEA DE META ENTERA (nodo
                      `w6wW2e`): código+categoría, el chip de estado y el
                      stock.

                      Las dos cosas en la MISMA celda, y no en un `<div>`
                      suelto al lado, que es como estaba hasta la ola final
                      del ciclo. El motivo es de accesibilidad, no de
                      prolijidad: los hijos de un `role="row"` tienen que ser
                      celdas, y aquel `<div>` sin rol dejaba la fila del
                      teléfono con un hijo que no lo era. Fundirla acá también
                      borra la única duplicación real que quedaba —el stock
                      aparecía dos veces, en la meta y en su celda— porque
                      ahora las dos versiones son dos presentaciones del mismo
                      dato adentro de su celda.

                      Es la técnica que `/servicio-tecnico` ya usa en su celda
                      "Ingresó" (app/(app)/servicio-tecnico/page.tsx): un
                      bloque `lg:hidden` y otro `hidden lg:flex` como
                      hermanos, y la lección es que **el dato no tiene por qué
                      vivir cerca de la celda que uno imagina** — la meta del
                      teléfono habla del código, del estado y del stock, y
                      cuelga de la celda de Stock porque es la que ocupa su
                      lugar en la grilla de escritorio.

                      `basis-full` fuerza el salto de línea del `flex-wrap`
                      de la fila en el teléfono (Código y Tipo, ocultos más
                      arriba, no dejan hueco); en escritorio el `flex-basis`
                      no tiene efecto: ahí la fila es `lg:contents` y esto es
                      un ítem de grid. */}
                  <div
                    role="cell"
                    className="basis-full lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                  >
                    <div className="flex items-center gap-2 lg:hidden">
                      <span title={detalleMovil} className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {detalleMovil}
                      </span>
                      <ChipEstado estado={f.estado} />
                      <span className={cn(estilos.archivo, 'shrink-0 text-[12px] tabular-nums', claseStockCelda)}>
                        {f.stockTexto}
                      </span>
                    </div>
                    {/* Escritorio: el stock solo, alineado a la derecha, con
                        el mismo envoltorio de centrado (`lg:h-full`) que
                        llevan las otras celdas cortas de esta fila. */}
                    <div
                      className={cn(
                        estilos.archivo,
                        'hidden whitespace-nowrap text-right text-sm tabular-nums lg:flex lg:h-full lg:items-center lg:justify-end',
                        claseStockCelda,
                      )}
                    >
                      {f.stockTexto}
                    </div>
                  </div>

                  {/* Estado: propia celda de escritorio; en el teléfono
                      el mismo chip ya salió en la línea de meta. */}
                  <div
                    role="cell"
                    className="hidden text-right lg:block lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                  >
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                      <ChipEstado estado={f.estado} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {paginas > 1 && (
            <nav
              aria-label="Paginación"
              className="mt-auto flex items-center justify-between border-t px-[14px] py-3 lg:px-[18px]"
            >
              <span className="text-[12px] text-muted-foreground">
                {formatearCantidad(String((pagina - 1) * porPagina + 1))}–
                {formatearCantidad(String(Math.min(pagina * porPagina, total)))} de{' '}
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
  )
}

export default async function Inventario({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; p?: string; inactivos?: string; tipo?: string; cat?: string
  }>
}) {
  const sesion = await exigirSesion()
  // Dos preguntas y no `esDuenio`: el botón de alta y el ABM del árbol son
  // permisos distintos, así que un empleado puede tener uno sin el otro.
  const puedeCrear = await puedeConSesion(sesion, 'ARTICULOS_CREAR')
  const puedeCategorias = await puedeConSesion(sesion, 'CATEGORIAS')
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
  // El nombre de la rama activa, para el chip del teléfono — `cat` ya está
  // garantizado a corresponder a una rama real del árbol (si no, cayó en
  // `null` arriba), así que esto sólo puede dar `null` cuando `cat` también
  // lo es.
  const nombreRama = nombreDeRama(arbol, cat)

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
          puedeCrear ? (
            <Button asChild size="sm">
              <Link href="/inventario/nuevo">Artículo nuevo</Link>
            </Button>
          ) : undefined
        }
        // Task 6 del ciclo móvil: el link a /inventario/nuevo del teléfono
        // (design/arandano.pen, `b1jiWO` > `GZz1a`), tono 'accion' porque el
        // botón CREA algo — mismo criterio que /usuarios.
        //
        // La guarda es `puedeCrear` —el permiso `ARTICULOS_CREAR`—, la MISMA
        // que la copia de escritorio (`acciones`, arriba): son las dos formas
        // del mismo botón, no dos acciones. Gatear sólo `acciones` dejaba el
        // atajo del teléfono a mano para un empleado sin el permiso, que
        // caería en el 403 de `exigirPermiso` en /inventario/nuevo.
        accionMovil={
          puedeCrear
            ? { icono: Plus, etiqueta: 'Artículo nuevo', href: '/inventario/nuevo', tono: 'accion' }
            : undefined
        }
      />
      {/* padding [12,14] y gap 10: una de las dos excepciones al padding/gap
          de siempre, geometría que fija el propio plan de este ciclo — no el
          `.pen`, que no dibuja un frame "Cuerpo" separado para esta
          pantalla. lg: vuelve al p-6/gap-4 de escritorio, sin tocar. */}
      <div className="flex flex-col gap-[10px] px-[14px] py-3 lg:gap-4 lg:p-6">
        <FiltrosDeInventario
          busqueda={busqueda}
          verInactivos={verInactivos}
          tipo={tipo}
          cat={cat}
          panelCategorias={
            // El botón de 36px (nodo `TK1ZV`) que abre el árbol en un
            // `Sheet` — sólo en el teléfono. `PanelDeCategorias` es el
            // MISMO componente que la columna de escritorio, sin copiarlo:
            // el ABM entero (renombrar, mover, borrar, los toasts) viaja
            // adentro sin cambios.
            <Sheet>
              <SheetTrigger
                aria-label="Categorías"
                className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-card text-foreground lg:hidden"
              >
                <ListTree aria-hidden="true" className="size-[17px]" />
              </SheetTrigger>
              {/* `side="left"`: derivada del spec (§7.1) — ningún frame de
                  `design/arandano.pen` dibuja el árbol abierto en el
                  teléfono, así que no hay maqueta que decida el lado. Se
                  eligió el mismo lado que ocupa la columna en escritorio: es
                  lo que menos desorienta a quien pasa de un ancho al otro
                  (la columna vive a la izquierda del listado; el árbol
                  "sale" del mismo lugar). Alto completo y `overflow-y-auto`
                  en vez de `side="bottom"` (que sí usa `ControlDeCaja` en
                  `/vender`) porque acá el contenido puede ser largo — un
                  árbol de veinte ramas, según CLAUDE.md — y una hoja inferior
                  queda acotada a `h-auto`, sin espacio garantizado para
                  scrollear. */}
              <SheetContent side="left" className="w-[280px] gap-0 overflow-y-auto p-3">
                {/* sr-only: el panel ya muestra su propio título visible
                    ("CATEGORÍAS"); esto es sólo lo que Radix pide para
                    `aria-labelledby`/`aria-describedby` del diálogo. */}
                <SheetHeader className="sr-only">
                  <SheetTitle>Categorías</SheetTitle>
                  <SheetDescription>
                    El árbol de categorías del catálogo: navegar, filtrar y administrar.
                  </SheetDescription>
                </SheetHeader>
                {/* `puedeAdministrar` es el permiso `CATEGORIAS`, el MISMO
                    que recibe la copia de escritorio (más abajo): el panel
                    del Sheet y el de la columna son el mismo componente
                    renderizado dos veces, y el ABM (crear, renombrar, mover,
                    borrar) tiene que aparecer o desaparecer en los dos a la
                    vez. */}
                <PanelDeCategorias
                  arbol={arbol}
                  total={totalDelCatalogo}
                  sinCategoria={sinCategoria}
                  activa={cat}
                  puedeAdministrar={puedeCategorias}
                  filtros={{ busqueda, verInactivos, tipo }}
                />
              </SheetContent>
            </Sheet>
          }
        />

        {/* El chip de la rama activa, sólo en el teléfono (design/
            arandano.pen, nodo `jgesH`): en escritorio la rama activa ya se
            ve resaltada en el panel de la columna, así que este chip sería
            redundante ahí. El ✕ limpia el filtro sin tocar búsqueda ni tipo
            — mismo mecanismo que "Buscar en todo el inventario", más abajo. */}
        {cat && nombreRama && (
          <div className="flex items-center gap-2 lg:hidden">
            <Link
              href={hrefListado({ busqueda, verInactivos, tipo, cat: null })}
              aria-label={`Quitar el filtro ${nombreRama}`}
              className="flex items-center gap-[7px] rounded-full bg-accent px-[10px] py-[5px]"
            >
              <span className="text-[12px] font-semibold text-marca">{nombreRama}</span>
              <X aria-hidden="true" className="size-3 text-marca" />
            </Link>
            <span className="text-[11px] text-muted-foreground">
              {total === 1 ? '1 artículo en la rama' : `${total} artículos en la rama`}
            </span>
          </div>
        )}

        {/* El frame `Contenido` de la maqueta (design/arandano.pen): el panel
            de 248 a la izquierda y el listado ocupando lo que queda. Los
            filtros quedan ARRIBA, cruzando las dos columnas, porque el
            buscador manda sobre las dos.
            Task 6: en el teléfono se apila (flex-col) y el panel de la
            columna desaparece (hidden lg:block) — ahí el árbol vive adentro
            del Sheet que arma `panelCategorias`, más arriba. */}
        <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
          <div className="hidden lg:block">
            <PanelDeCategorias
              arbol={arbol}
              total={totalDelCatalogo}
              sinCategoria={sinCategoria}
              activa={cat}
              puedeAdministrar={puedeCategorias}
              filtros={{ busqueda, verInactivos, tipo }}
            />
          </div>

        {/* El listado, dentro de su propia card (design/arandano.pen, nodo
            `BT29h`) — antes era una <table> suelta en la pantalla. Extraído
            como componente puro `Listado` (ronda de arreglos 1 de la Task
            6): ver su docblock, más arriba. */}
        <Listado
          filas={articulos.map((a) => {
            const desactivado = a.desactivadoEn !== null
            return {
              id: a.id,
              sku: a.sku,
              nombre: a.nombre,
              categoria: a.categoria,
              tipo: a.tipo,
              precioFormateado: formatearPrecio(a.precio.toString()),
              // Un guion y NO un 0: el motor no le descuenta stock a un
              // servicio (lib/ventas/crear.ts filtra por esProducto), así
              // que un 0 se leería como faltante y alguien saldría a
              // comprar lo que no existe.
              stockTexto: a.tipo === 'SERVICIO' ? '—' : formatearCantidad(a.stock.toString()),
              estado: estadoDeFila({ tipo: a.tipo, stock: a.stock, desactivado }),
              desactivado,
            }
          })}
          total={total}
          pagina={pagina}
          paginas={paginas}
          porPagina={POR_PAGINA}
          busqueda={busqueda}
          verInactivos={verInactivos}
          tipo={tipo}
          cat={cat}
          puedeCrear={puedeCrear}
        />
        </div>
      </div>
    </>
  )
}
