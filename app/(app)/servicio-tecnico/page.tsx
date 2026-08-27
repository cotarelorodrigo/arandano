import Link from 'next/link'
import { Search, Plus } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatearCantidad } from '@/lib/formato/mostrar'
import { ESTADOS, ABIERTOS, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { filtroDelTablero } from '@/lib/ordenes-de-trabajo/buscar'
import { fechaCorta, diasEnElLocal } from '@/lib/ordenes-de-trabajo/antiguedad'
import { ChipEstadoFila } from './chip-estado'
import type { EstadoOrden } from '@/generated/prisma/client'
import estilos from './tipografia.module.css'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50
const PAGINA_MAXIMA = 1_000_000

export function esEstado(v: string | undefined): v is EstadoOrden {
  return v !== undefined && (ESTADOS as readonly string[]).includes(v)
}

/**
 * El href de una navegación del tablero que preserva la búsqueda vigente.
 * `estado: null` es "sin filtro" (todas las abiertas). El chip "Abiertas" NO
 * pasa por acá — ver el comentario de `FilaDeChips`, donde se arma a mano.
 */
export function hrefTablero({
  busqueda,
  estado,
  pagina,
}: {
  busqueda: string
  estado: EstadoOrden | null
  pagina?: number
}): string {
  const u = new URLSearchParams()
  if (busqueda) u.set('q', busqueda)
  if (estado) u.set('estado', estado)
  if (pagina && pagina > 1) u.set('p', String(pagina))
  const s = u.toString()
  return s ? `/servicio-tecnico?${s}` : '/servicio-tecnico'
}

/**
 * Cuántas órdenes cuenta el chip "Abiertas": la suma de TODOS los estados
 * abiertos, nunca la de lo que el filtro actual muestra en pantalla —si
 * contara lo filtrado, elegir "Listo" pondría el resto en cero y no se
 * podría volver—. Es la decisión ya tomada del módulo que el brief de esta
 * task pide no tocar. Pura y exportada para poder probarla sin base: lo que
 * importa es que ENTREGADO no sume, no cómo llegó el Map.
 */
export function contarAbiertas(cuenta: ReadonlyMap<EstadoOrden, number>): number {
  return ABIERTOS.reduce((a, e) => a + (cuenta.get(e) ?? 0), 0)
}

/**
 * "hoy" / "hace 1 día" / "hace N días" — la secundaria de la columna
 * INGRESÓ (design/arandano.pen, nodo `X4oBSe`: "hace 23 días"). Sin el
 * sufijo "en el local" que sí lleva el subtítulo de /servicio-tecnico/[id]:
 * acá la fila ya está adentro del tablero del local, repetirlo en cada fila
 * sería ruido.
 */
export function rotuloAntiguedad(dias: number): string {
  if (dias === 0) return 'hoy'
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}

/**
 * El subtítulo del Topbar (design/arandano.pen, nodo `Flr5I`): "N equipos en
 * el local · el más viejo hace N días". El dato es de ESTA pantalla —el
 * Topbar sólo pinta lo que se le pasa (components/shell/encabezado.tsx)—,
 * así que la cuenta vive acá. El propio comentario que dejó el ciclo
 * anterior en este archivo pedía completarlo "en el ciclo del tablero", que
 * es este.
 *
 * `undefined` con el local vacío o sin ninguna abierta: "0 equipos en el
 * local · el más viejo hace NaN días" es peor que no decir nada, mismo
 * criterio que ya usa /inventario con su propio subtítulo.
 */
export function subtituloDelTablero(abiertas: number, diasDelMasViejo: number | null): string | undefined {
  if (abiertas === 0 || diasDelMasViejo === null) return undefined
  const equipos = abiertas === 1 ? '1 equipo' : `${abiertas} equipos`
  const antiguedad =
    diasDelMasViejo === 0
      ? 'el más viejo, hoy'
      : diasDelMasViejo === 1
        ? 'el más viejo hace 1 día'
        : `el más viejo hace ${diasDelMasViejo} días`
  return `${equipos} en el local · ${antiguedad}`
}

/**
 * Qué palabra usa el resumen de rango del pie del listado, según si se está
 * mirando el default (abiertas), un chip puntual, o una búsqueda sin chip
 * (que alcanza a todas, entregadas y anuladas incluidas).
 */
export function etiquetaDelConjunto(
  filtro: EstadoOrden | null,
  buscandoEnTodas: boolean,
  total: number,
): string {
  if (buscandoEnTodas) return total === 1 ? 'orden' : 'órdenes'
  if (filtro) return total === 1 ? `orden «${NOMBRE_ESTADO[filtro]}»` : `órdenes «${NOMBRE_ESTADO[filtro]}»`
  return total === 1 ? 'orden abierta' : 'órdenes abiertas'
}

/** "1–18 de 18 órdenes abiertas" (design/arandano.pen, nodo `CpIri`). */
export function rotuloDeRango(
  desde: number,
  hasta: number,
  total: number,
  filtro: EstadoOrden | null,
  buscandoEnTodas: boolean,
): string {
  return `${formatearCantidad(String(desde))}–${formatearCantidad(String(hasta))} de ${formatearCantidad(
    String(total),
  )} ${etiquetaDelConjunto(filtro, buscandoEnTodas, total)}`
}

/**
 * "Las entregadas no se listan por defecto" (design/arandano.pen, nodo
 * `acCj8`) — sólo tiene sentido en el default exacto que la maqueta dibuja:
 * sin chip y sin búsqueda. Con un chip puntual o buscando en todas, la
 * frase deja de ser cierta (ya se está viendo, o se puede ver, alguna
 * entregada), y no hay ningún texto que la reemplace: la maqueta no
 * promete una nota para cada estado posible del pie.
 */
export function notaDelConjunto(filtro: EstadoOrden | null, buscandoEnTodas: boolean): string | null {
  return filtro === null && !buscandoEnTodas ? 'Las entregadas no se listan por defecto' : null
}

/**
 * Hasta 5 números de página centrados en `actual`, recortados a `[1, total]`.
 *
 * Copiado de `app/(app)/ventas/page.tsx` / `app/(app)/inventario/page.tsx`
 * (mismo nombre, mismo cuerpo): es chico y autocontenido, y esta task no es
 * el ciclo que extrae el duplicado a un lib compartido — mismo criterio que
 * ya dejó anotado /inventario.
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

/**
 * La celda ESTADO de una fila del listado (hallazgo I5 de la review final):
 * anulada primero, en neutro —la orden conserva el estado que tenía, anular
 * es una columna y no un estado, así que pintar el chip de color de ese
 * estado (por ejemplo, "Listo" en verde) mentiría sobre una orden que ya no
 * está viva—; viva, el chip de color e ícono de `ChipEstadoFila`. Extraída a
 * su propio componente EXPORTADO y no dejada como el ternario inline que
 * había antes: ese ternario tenía un test cuyo nombre prometía "no usa el
 * chip de color" pero cuyo cuerpo sólo comprobaba `toContain('o.anuladaEn ?')`
 * —una mutación que igualaba las dos ramas seguía en verde—, y una función
 * que se puede renderizar de verdad con `renderToStaticMarkup` es lo que
 * permite probar QUÉ se pinta, no que el código tenga forma de ternario.
 */
export function CeldaDeEstado({ estado, anulada }: { estado: EstadoOrden; anulada: boolean }) {
  if (anulada) {
    return (
      <Badge className="h-auto gap-[5px] border-transparent bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-muted-foreground">
        Anulada ({NOMBRE_ESTADO[estado]})
      </Badge>
    )
  }
  return <ChipEstadoFila estado={estado} />
}

/**
 * Un chip de la fila de filtro (design/arandano.pen, nodo `G5b3dG`): "Abiertas"
 * y los nueve estados. Dos variables visuales, no una por estado —a
 * diferencia de `ChipEstadoFila`, que sí varía por estado—: si está
 * SELECCIONADO (fill sólido `--primary`, texto blanco) y si su conteo es
 * CERO (todo en `--muted-foreground`). Seleccionado gana siempre sobre cero:
 * la maqueta no dibuja un chip seleccionado en cero, pero elegir "mostrame
 * lo que estoy mirando" importa más que "está vacío".
 *
 * El texto blanco sobre `--primary` sale de `Badge` (su variante `default`,
 * components/ui/badge.tsx) por `asChild`, y no de escribir la clase de
 * Tailwind para "el texto que va sobre --primary" acá: ese token —el que
 * shadcn usa para pintar el botón de acción— sólo puede nombrarse dentro de
 * components/ui/ (test/sistema-de-diseno.test.ts, "nadie toma [ese token]
 * por 'el color claro'"). Badge ya lo trae adentro; este archivo no
 * necesita repetirlo.
 */
function ChipDeFiltro({
  href,
  rotulo,
  cuenta,
  seleccionado,
}: {
  href: string
  rotulo: string
  cuenta: number
  seleccionado: boolean
}) {
  if (seleccionado) {
    return (
      <Badge
        asChild
        className="h-auto gap-[7px] rounded-full border-transparent px-3 py-[7px] text-xs font-semibold"
      >
        {/* "page" y no "true" (hallazgo M9 de la review final): más
            específico, y es el mismo valor que ya usa el número de página
            actual de la paginación más abajo — un chip seleccionado es,
            igual que esa página, "dónde estoy parado dentro de un conjunto
            de vistas del mismo listado". */}
        <Link href={href} aria-current="page">
          {rotulo}
          <span className={cn(estilos.archivo, 'text-xs font-bold')} style={{ color: 'var(--marca-soft)' }}>
            {formatearCantidad(String(cuenta))}
          </span>
        </Link>
      </Badge>
    )
  }

  const cero = cuenta === 0
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-[7px] rounded-full border border-input bg-card px-3 py-[7px] text-xs font-medium',
        cero ? 'text-muted-foreground' : 'text-foreground-soft',
      )}
    >
      {rotulo}
      <span
        className={cn(estilos.archivo, 'text-xs font-bold', cero ? 'text-muted-foreground' : 'text-foreground')}
      >
        {formatearCantidad(String(cuenta))}
      </span>
    </Link>
  )
}

/**
 * La versión para el teléfono de un chip de filtro (design/arandano.pen,
 * frame `Móvil / Servicio Técnico`, nodo `v1PnE3`): una card vertical —el
 * conteo grande arriba, el rótulo chico abajo— en vez de la pastilla
 * horizontal de escritorio. Demasiado distinta como para compartir un solo
 * árbol con `lg:` (a diferencia del patrón `display:contents` del listado,
 * acá cambia CUÁL dato va primero, no sólo cómo se agrupan las mismas
 * celdas), así que es un componente aparte que convive con `ChipDeFiltro`:
 * uno se ve sólo en el teléfono (`lg:hidden` en el contenedor de
 * `FilaDeChips`), el otro sólo en escritorio (`hidden lg:flex`) — mismo
 * criterio que `acciones`/`accionMovil` de `<Encabezado>`.
 *
 * Reusa `Badge` (variante `default`) para el estado SELECCIONADO, en vez de
 * escribir acá el fondo de marca y el texto claro que va sobre él: es el
 * mismo motivo que ya vale para `ChipDeFiltro` (ese par de tokens sólo se
 * puede nombrar dentro de `components/ui/`, test/sistema-de-diseno.test.ts).
 *
 * La maqueta NO distingue "conteo en cero" en el teléfono —a diferencia del
 * chip de escritorio, que apaga rótulo y conteo a `--muted-foreground`
 * cuando `cuenta === 0`—: leyendo los nueve nodos del frame, "Sin
 * reparación" en 0 usa el mismo tratamiento que "Recibido" en 4 (conteo en
 * `--foreground`, rótulo siempre en `--muted-foreground`). Por eso acá no
 * hay ningún ternario por `cero`.
 */
export function ChipDeFiltroMovil({
  href,
  rotulo,
  cuenta,
  seleccionado,
}: {
  href: string
  rotulo: string
  cuenta: number
  seleccionado: boolean
}) {
  const conteo = formatearCantidad(String(cuenta))

  if (seleccionado) {
    return (
      <Badge
        asChild
        className="h-auto w-full flex-col items-start gap-0.5 rounded-[11px] border-transparent px-2.5 py-2"
      >
        <Link href={href} aria-current="page">
          <span className={cn(estilos.archivo, 'text-[17px] font-semibold')}>{conteo}</span>
          {/* El rótulo secundario sobre `--primary` reusa `--marca-soft`, el
              mismo token que ya pinta el conteo de la pastilla de escritorio:
              la maqueta escribe acá un hex propio (#D6C9F5), apenas distinto
              de #B6A6E8, pero sin variable dedicada — mismo caso que
              test/maqueta.test.ts ya documenta para `--marca-soft` ("el
              color que más se repite sin variable"), así que se trata como
              el mismo token y no como un tercer literal suelto. */}
          <span className="text-[10px] leading-[1.2] font-medium text-[var(--marca-soft)]">{rotulo}</span>
        </Link>
      </Badge>
    )
  }

  return (
    <Link href={href} className="flex w-full flex-col gap-0.5 rounded-[11px] bg-card px-2.5 py-2">
      <span className={cn(estilos.archivo, 'text-[17px] font-semibold text-foreground')}>{conteo}</span>
      <span className="text-[10px] leading-[1.2] font-medium text-muted-foreground">{rotulo}</span>
    </Link>
  )
}

/**
 * La fila de chips de filtro completa: "Abiertas" más un chip por estado, en
 * el orden que design/arandano.pen dibuja —`ESTADOS`, que desde este ciclo
 * termina en ENTREGADO (ver su comentario en lib/ordenes-de-trabajo/
 * estados.ts)—.
 *
 * Task 8 del ciclo móvil: renderiza DOS veces la misma lista de diez chips
 * ("Abiertas" + `ESTADOS`) — una vez con `ChipDeFiltro` (la pastilla, sólo
 * visible en escritorio) y otra con `ChipDeFiltroMovil` (la card, sólo
 * visible en el teléfono) —, en vez de forzar un solo árbol con `order-*`.
 * `hidden`/`lg:hidden` saca por completo a la variante inactiva de CUALQUIER
 * layout (grid, flex): un elemento en `display:none` no ocupa lugar ni
 * aparece en el árbol de accesibilidad, así que no hay contenido duplicado
 * para quien usa un lector de pantalla. El bloque de escritorio va PRIMERO
 * en el DOM (igual que `acciones` antes que `accionMovil` en
 * `components/shell/encabezado.tsx`): así el HTML servido no cambia de
 * orden entre ciclos, y los tests que ubican un chip por `indexOf` siguen
 * encontrando la pastilla de escritorio primero.
 *
 * La maqueta dibuja la grilla del teléfono con sólo NUEVE cards, no diez: le
 * falta "Rechazado" (ver `Get("v1PnE3")` del frame `F9BzV` — las tres filas
 * son Abiertas/Recibido/En diagnóstico, Presupuestado/Aprobado/En
 * reparación, Listo/Sin reparación/Entregado). Sacar ese estado del
 * teléfono sería una regresión real (nadie podría ver ni filtrar las
 * órdenes rechazadas desde ahí) por una omisión que no tiene ninguna razón
 * de espacio o de producto escrita en ningún lado — así que acá se
 * mantienen los diez, y la grilla de 3 columnas simplemente cae en una
 * cuarta fila con un solo chip ("Entregado" queda solo). Documentado en
 * docs/correcciones-pendientes-del-pen.md, entrada 9.
 */
export function FilaDeChips({
  abiertas,
  cuenta,
  filtro,
  buscandoEnTodas,
  busqueda,
}: {
  abiertas: number
  cuenta: Partial<Record<EstadoOrden, number>>
  filtro: EstadoOrden | null
  buscandoEnTodas: boolean
  busqueda: string
}) {
  const seleccionadaAbiertas = filtro === null && !buscandoEnTodas

  return (
    <>
      {/* Escritorio: la pastilla horizontal de siempre, sin cambios. */}
      <div className="hidden flex-wrap items-center gap-2 lg:flex">
        {/* "Abiertas" no pasa por hrefTablero: promete volver al tablero por
            defecto, y ese default no lleva búsqueda — arrastrar `q` dejaría el
            href idéntico a la URL actual durante una búsqueda, un chip que no
            hace nada. Decisión ya tomada del módulo, de antes de este rediseño. */}
        <ChipDeFiltro href="/servicio-tecnico" rotulo="Abiertas" cuenta={abiertas} seleccionado={seleccionadaAbiertas} />
        {ESTADOS.map((e) => (
          <ChipDeFiltro
            key={e}
            href={hrefTablero({ busqueda, estado: e })}
            rotulo={NOMBRE_ESTADO[e]}
            cuenta={cuenta[e] ?? 0}
            seleccionado={filtro === e}
          />
        ))}
      </div>

      {/* Teléfono: grilla de 3 columnas (design/arandano.pen, nodo `v1PnE3`) —
          ver el docblock de ChipDeFiltroMovil, arriba, para el porqué de los
          diez chips en vez de nueve. */}
      <div className="grid grid-cols-3 gap-2 lg:hidden">
        <ChipDeFiltroMovil
          href="/servicio-tecnico"
          rotulo="Abiertas"
          cuenta={abiertas}
          seleccionado={seleccionadaAbiertas}
        />
        {ESTADOS.map((e) => (
          <ChipDeFiltroMovil
            key={e}
            href={hrefTablero({ busqueda, estado: e })}
            rotulo={NOMBRE_ESTADO[e]}
            cuenta={cuenta[e] ?? 0}
            seleccionado={filtro === e}
          />
        ))}
      </div>
    </>
  )
}

/** Una fila ya resuelta a texto, lista para `Listado`: sin `Date` ni ningún
 *  otro tipo que no cruce limpio a un fixture de test — mismo criterio que
 *  `FilaDeVenta` (app/(app)/ventas/page.tsx) y `FilaDeArticulo`
 *  (app/(app)/inventario/page.tsx). */
export type FilaDeOrden = {
  id: string
  numero: number
  estado: EstadoOrden
  anulada: boolean
  equipoLabel: string
  imeiLabel: string
  clienteNombre: string
  clienteTelefono: string
  fechaFormateada: string
  antiguedadLabel: string
}

/**
 * El listado: el patrón de la Task 4 del ciclo móvil (ver su docblock en
 * `app/(app)/ventas/page.tsx`, `Listado`) — grid en escritorio, tarjetas
 * apiladas en el teléfono, resuelto con `display:contents` sobre el MISMO
 * árbol. Las anchuras del grid de escritorio son las que declaraban los
 * `<TableHead>` de antes: 78px (Orden), auto/`1fr` (Equipo), 190px
 * (Cliente), 150px (Ingresó) y 170px (Estado).
 *
 * Ronda de arreglos 1 (Importante): la primera versión de esta función
 * dejaba las CINCO celdas reales `hidden lg:block` en el teléfono y ponía
 * las tres líneas nuevas como hermanas suyas sin rol — la fila quedaba sin
 * ningún `role="cell"` alcanzable en el teléfono, o sea sin *owned
 * elements* válidos para `role="row"`. La fila ahora es
 * `flex flex-wrap ... lg:contents` (el mismo mecanismo que
 * `app/(app)/inventario/page.tsx` ya usa para su propia fila), y CUATRO de
 * las cinco celdas —Orden, Equipo, Cliente e Ingresó— son las MISMAS en los
 * dos anchos: siempre presentes, siempre con su `role="cell"`, sólo que en
 * el teléfono son ítems de un `flex-wrap` y en escritorio se disuelven en
 * columnas de grid. `basis-full` en Cliente e Ingresó fuerza su propio
 * renglón en el teléfono —en escritorio no hace nada, porque una vez
 * disuelta la fila la celda es un ítem de GRID, que ignora `flex-basis` por
 * completo—.
 *
 * Ronda de arreglos 2 (Menor): la Meta (IMEI + fecha de ingreso +
 * antigüedad) SÍ se pudo fundir, a diferencia de lo que decía la primera
 * versión de este comentario. El error de esa primera versión fue tratar
 * "IMEI + fecha + antigüedad" como si tuviera que vivir cerca de la celda
 * Equipo (donde vive el IMEI en escritorio) — pero el IMEI es un DATO
 * (`f.imeiLabel`), no un nodo del DOM: nada impide leerlo dentro de
 * CUALQUIER celda. Y la celda que el teléfono necesita justo después de
 * Cliente para la Meta es, literal, la 4ª columna del grid de
 * escritorio — Ingresó — que YA vive ahí en el DOM. No hizo falta mover
 * nada: sacarle el `hidden` a Ingresó, sumarle `basis-full`, y usar adentro
 * la misma técnica de "compacto en el teléfono (`lg:hidden`), apilado en
 * escritorio (`hidden lg:flex`)" que ya usa Cliente.
 *
 * **Lo único que sigue sin poder fusionarse: el chip de estado.** Vive en
 * la columna 5, y la línea 1 del teléfono lo necesita en la posición ~3 del
 * flujo (justo después de Equipo) — con Cliente (3) e Ingresó (4) de por
 * medio en el orden de columnas. El auto-placement de CSS Grid llena las
 * columnas en el orden del DOM, así que adelantar la celda Estado hasta ahí
 * correría a Cliente e Ingresó de columna al disolver `lg:contents`. La
 * única forma de lograrlo sería `order-*` explícito en varias celdas a la
 * vez (reordenar visualmente sin tocar el DOM), una técnica que no usa
 * ningún otro listado de este ciclo y que además desalinea el orden de
 * lectura de un lector de pantalla del orden visual — más riesgo que
 * beneficio para una sola pieza. Así que el chip queda DUPLICADO: una copia
 * real en su celda de escritorio (Estado, `hidden lg:block`), y una copia
 * sin rol propio, visible sólo en el teléfono (`lg:hidden`) — el mismo
 * mecanismo, con el mismo trade-off, que ya usa
 * `app/(app)/inventario/page.tsx` para su propio `ChipEstado` (ver el
 * comentario "el mismo chip ya salió en la línea de meta" en ese archivo).
 * La fila ya no se queda sin celdas: tiene CUATRO reales (Orden, Equipo,
 * Cliente, Ingresó) más esta única copia puntual, contra ninguna celda real
 * antes de la Ronda 1.
 *
 * Línea 1 (teléfono): Orden + Equipo (modelo, sin el IMEI) + el chip
 * duplicado, en ese orden de flujo — ninguno fuerza salto de línea. Línea 2:
 * Cliente, con el teléfono fusionado inline (mismo mecanismo que la "· " de
 * Hora en `app/(app)/ventas/page.tsx`) y `basis-full` para su propio
 * renglón. Línea 3: Ingresó, con la Meta fusionada inline (mismo mecanismo
 * que Cliente) y `basis-full` para su propio renglón.
 *
 * **Sin `fallaDeclarada`, a propósito.** Uno de los cinco ejemplos de la
 * maqueta ("Sin IMEI · no enciende · ingresó…") mete el motivo declarado
 * cuando no hay IMEI, pero ese campo no está en el `select` de
 * `ServicioTecnico` — sumarlo sería tocar la consulta, y el brief de esta
 * task lo prohíbe explícitamente ("Cero cambios de datos… ni consultas").
 * Se trata como dato de ejemplo de la maqueta, no como requisito de
 * contenido — mismo criterio que ya usa este documento para el formato de
 * SKU de ejemplo (`docs/correcciones-pendientes-del-pen.md`, entrada 3).
 */
export function Listado({
  filas,
  total,
  pagina,
  paginas,
  porPagina,
  filtro,
  buscandoEnTodas,
  busqueda,
}: {
  filas: FilaDeOrden[]
  total: number
  pagina: number
  paginas: number
  porPagina: number
  filtro: EstadoOrden | null
  buscandoEnTodas: boolean
  busqueda: string
}) {
  const notaDelPie = notaDelConjunto(filtro, buscandoEnTodas)
  const conPagina = (n: number) => hrefTablero({ busqueda, estado: filtro, pagina: n })
  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={cn(estilos.tituloDeCard, 'text-foreground')}>Equipos en el local</h2>
        <span className="text-xs font-semibold text-primary">
          Ordenadas por antigüedad · la más vieja primero
        </span>
      </div>

      {filas.length === 0 ? (
        <p className="p-[14px] text-sm text-muted-foreground lg:p-[18px]">
          {/* Los dos vacíos no son el mismo vacío (hallazgo M8 del barrido
              final): con `total > 0` la página quedó fuera de rango (`?p` se
              clampea a [1, 1.000.000], no a `paginas`). */}
          {total > 0 ? (
            <>
              Esta página no tiene equipos.{' '}
              <Link href={conPagina(1)} className="underline">
                Volver a la primera
              </Link>
              .
            </>
          ) : buscandoEnTodas ? (
            `No apareció ninguna orden con «${busqueda}».`
          ) : (
            'No hay equipos que mostrar con estos filtros.'
          )}
        </p>
      ) : (
        <>
          <div role="table" className="grid grid-cols-1 lg:grid-cols-[78px_1fr_190px_150px_170px]">
            <div role="row" className="hidden lg:contents">
              <div role="columnheader" className="bg-muted px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Orden
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Equipo
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Cliente
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Ingresó
              </div>
              <div role="columnheader" className="bg-muted px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                Estado
              </div>
            </div>

            {filas.map((f) => (
              <div
                key={f.id}
                role="row"
                className="group flex flex-wrap items-center gap-x-[10px] gap-y-[5px] border-b p-[11px] px-[14px] last:border-b-0 lg:contents"
              >
                {/* Orden: siempre presente, en los dos anchos —igual que
                    "Nombre"/"Precio" en app/(app)/inventario/page.tsx—.
                    `estilos.archivo` (CSS module, no Tailwind) no se puede
                    condicionar con `lg:`, así que paga Archivo en los dos
                    anchos —el nodo `imTpQ` de la maqueta pide `$ar-font`
                    para esta línea puntual del teléfono, una diferencia
                    menor que no vale la pena perseguir a costa de fusionar
                    la celda (mismo criterio que ya usa
                    app/(app)/ventas/page.tsx para su propio "Número")—. */}
                <div
                  role="cell"
                  className={cn(
                    estilos.archivo,
                    'shrink-0 text-[14px] font-semibold text-primary lg:border-b lg:p-[11px] lg:px-[7px] lg:pl-[18px] lg:text-sm lg:font-bold lg:whitespace-nowrap lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors',
                  )}
                >
                  <div className="lg:flex lg:h-full lg:items-center">
                    <Link href={`/servicio-tecnico/${f.id}`}>#{f.numero}</Link>
                  </div>
                </div>

                {/* Equipo: siempre presente. El IMEI sigue oculto en el
                    teléfono —ya sale combinado en la Meta, más abajo—. */}
                <div
                  role="cell"
                  className="min-w-0 flex-1 lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="truncate text-[14px] font-medium text-foreground lg:overflow-visible lg:text-clip lg:whitespace-normal lg:text-sm">
                      {f.equipoLabel}
                    </span>
                    <span className="hidden text-[11px] text-muted-foreground lg:block">{f.imeiLabel}</span>
                  </div>
                </div>

                {/* El chip de estado, en la MISMA línea que Orden+Equipo en
                    el teléfono (nodo `MvJp3`): DUPLICADO a propósito, no
                    fusionado — ver el docblock de Listado, arriba, para el
                    porqué. La copia real de escritorio es la celda Estado,
                    más abajo. */}
                <div className="shrink-0 lg:hidden">
                  <CeldaDeEstado estado={f.estado} anulada={f.anulada} />
                </div>

                {/* Cliente: la MISMA celda en los dos anchos, con el
                    teléfono fusionado inline (mismo mecanismo que la "· " de
                    Hora en app/(app)/ventas/page.tsx). `basis-full` fuerza su
                    propio renglón en el teléfono; en escritorio `flex-basis`
                    no hace nada porque la celda pasa a ser un ítem de grid. */}
                <div
                  role="cell"
                  className="basis-full whitespace-normal lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  <div className="flex flex-wrap items-baseline gap-x-1 lg:flex-col lg:flex-nowrap lg:gap-0.5">
                    <span className="text-[12px] font-normal text-foreground-soft lg:text-sm lg:font-medium lg:text-foreground">
                      {f.clienteNombre}
                    </span>
                    <span className="text-[12px] font-normal text-foreground-soft lg:text-[11px] lg:text-muted-foreground">
                      <span aria-hidden="true" className="lg:hidden">
                        ·{' '}
                      </span>
                      {f.clienteTelefono}
                    </span>
                  </div>
                </div>

                {/* Ingresó: la MISMA celda en los dos anchos —Ronda de
                    arreglos 2: ya vive en la 4ª posición del DOM, justo
                    después de Cliente, que es exactamente donde el teléfono
                    necesita la Meta. El IMEI es un dato (`f.imeiLabel`), no
                    un nodo del DOM: leerlo acá no exige que esta celda esté
                    cerca de Equipo. `basis-full` fuerza su propio renglón en
                    el teléfono; en escritorio no hace nada (la celda es un
                    ítem de grid). Mismo mecanismo de "compacto en el
                    teléfono, apilado en escritorio" que ya usa Cliente, más
                    arriba. */}
                <div
                  role="cell"
                  className="basis-full lg:whitespace-nowrap lg:border-b lg:p-[11px] lg:px-[7px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  <p className="text-[11px] leading-[1.2] text-muted-foreground lg:hidden">
                    {f.imeiLabel} · ingresó {f.fechaFormateada} · {f.antiguedadLabel}
                  </p>
                  <div className="hidden flex-col gap-0.5 lg:flex">
                    <span className="text-sm font-medium text-foreground">{f.fechaFormateada}</span>
                    <span className="text-[11px] text-muted-foreground">{f.antiguedadLabel}</span>
                  </div>
                </div>

                {/* Estado: oculta en el teléfono —ya salió en la línea 1,
                    arriba—, sin cambios respecto de antes de este ciclo. */}
                <div
                  role="cell"
                  className="hidden text-right lg:block lg:whitespace-nowrap lg:border-b lg:p-[11px] lg:px-[7px] lg:pr-[18px] lg:group-hover:bg-muted/50 lg:group-last:border-b-0 lg:transition-colors"
                >
                  <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                    <CeldaDeEstado estado={f.estado} anulada={f.anulada} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Paginación (nodo `kF1ZK`): rango + nota cuando entra en una sola
              página —el estado que la maqueta dibuja—, y números de página en
              vez de la nota cuando no entra. */}
          <nav
            aria-label="Paginación"
            className="mt-auto flex items-center justify-between border-t px-[14px] py-3 lg:px-[18px]"
          >
            <span className="text-xs text-muted-foreground">
              {rotuloDeRango(desde, hasta, total, filtro, buscandoEnTodas)}
            </span>
            {paginas > 1 ? (
              <div className="flex items-center gap-[6px]">
                {ventanaDePaginas(pagina, paginas).map((n) =>
                  n === pagina ? (
                    <Button
                      key={n}
                      type="button"
                      aria-current="page"
                      size="icon-sm"
                      className={cn(estilos.archivo, 'size-[30px] rounded-lg text-[13px] font-semibold')}
                    >
                      {n}
                    </Button>
                  ) : (
                    <Button
                      key={n}
                      asChild
                      variant="outline"
                      size="icon-sm"
                      className={cn(
                        estilos.archivo,
                        'size-[30px] rounded-lg text-[13px] font-semibold text-foreground-soft',
                      )}
                    >
                      <Link href={conPagina(n)}>{n}</Link>
                    </Button>
                  ),
                )}
              </div>
            ) : (
              notaDelPie && <span className="text-[11px] text-muted-foreground">{notaDelPie}</span>
            )}
          </nav>
        </>
      )}
    </div>
  )
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
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const filtro = esEstado(estado) ? estado : null

  const prisma = prismaParaTenant(sesion.tenant.id)
  // Por defecto las abiertas; buscando, todas —incluidas las entregadas y las
  // anuladas—. El porqué, largo, vive en lib/ordenes-de-trabajo/buscar.ts, que
  // es también donde el buscador recorta el número para que un IMEI no tire
  // abajo la consulta.
  const donde = filtroDelTablero(busqueda, filtro)

  const [ordenes, total, porEstado, masViejo] = await Promise.all([
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
        // La columna EQUIPO lleva el IMEI como secundaria (design/arandano.pen,
        // nodo `OMn73`): sin este campo la fila no lo podía mostrar.
        equipoSerie: true,
        creadoEn: true,
        // Para rotular la fila: con la búsqueda alcanzando a las anuladas, una
        // fila sin marca no se distingue de una viva.
        anuladaEn: true,
        // La columna CLIENTE lleva el teléfono como secundaria (nodo
        // `n5eXN0`): antes sólo se pedía el nombre.
        cliente: { select: { nombre: true, telefono: true } },
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
    // El subtítulo del Topbar ("N equipos en el local · el más viejo hace N
    // días"): el equipo abierto más viejo. Mismo conjunto —abiertas, no
    // anuladas— que "abiertas" cuenta más abajo, para que las dos cifras del
    // subtítulo hablen del mismo grupo de órdenes.
    prisma.ordenDeTrabajo.aggregate({
      where: { anuladaEn: null, estado: { in: [...ABIERTOS] } },
      _min: { creadoEn: true },
    }),
  ])

  const cuenta = new Map(porEstado.map((f) => [f.estado, f._count._all]))
  // El chip sin filtro cuenta las ABIERTAS y no la suma de todos los estados:
  // es el que devuelve al listado por defecto, así que su número tiene que ser
  // el de ese listado. Por eso se suma sobre ABIERTOS y no sobre `cuenta`.
  const abiertas = contarAbiertas(cuenta)
  const cuentaPorEstado = Object.fromEntries(cuenta) as Partial<Record<EstadoOrden, number>>
  const diasDelMasViejo = masViejo._min.creadoEn ? diasEnElLocal(masViejo._min.creadoEn) : null
  // Cuando se busca sin chip, el listado se sale de los chips: no hay ninguno
  // que esté "actual", y decirlo evita que el resultado parezca filtrado.
  const buscandoEnTodas = busqueda !== '' && filtro === null
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))

  // La fila ya resuelta a texto, sin `Date`: Listado es un componente puro
  // (ver su docblock) y no puede recibir un `Date` de Prisma.
  const filas: FilaDeOrden[] = ordenes.map((o) => ({
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    anulada: o.anuladaEn !== null,
    equipoLabel: `${o.equipoMarca} ${o.equipoModelo}`,
    imeiLabel: o.equipoSerie ? `IMEI ${o.equipoSerie}` : 'Sin IMEI',
    clienteNombre: o.cliente.nombre,
    clienteTelefono: o.cliente.telefono ?? '—',
    fechaFormateada: fechaCorta(o.creadoEn),
    antiguedadLabel: rotuloAntiguedad(diasEnElLocal(o.creadoEn)),
  }))

  return (
    <>
      <Encabezado
        titulo="Servicio Técnico"
        subtitulo={subtituloDelTablero(abiertas, diasDelMasViejo)}
        acciones={
          <Button asChild>
            <Link href="/servicio-tecnico/nuevo">Recibir un equipo</Link>
          </Button>
        }
        accionMovil={{ icono: Plus, etiqueta: 'Recibir un equipo', href: '/servicio-tecnico/nuevo', tono: 'accion' }}
      />
      {/* Cuerpo (design/arandano.pen, frame `F9BzV` > `B3rzp`): padding
          [12,14], gap 12 en el teléfono; sin cambios en escritorio. */}
      <div className="flex flex-col gap-3 px-[14px] py-3 lg:gap-4 lg:p-6">
        <FilaDeChips
          abiertas={abiertas}
          cuenta={cuentaPorEstado}
          filtro={filtro}
          buscandoEnTodas={buscandoEnTodas}
          busqueda={busqueda}
        />

        {/* Buscador (design/arandano.pen, nodo `xzSwb` en escritorio, `V8hP7`
            en el teléfono): SIN botón "Buscar" a propósito. Es un solo campo
            de texto: Enter alcanza para submitearlo, sin JavaScript, porque
            un <form> con un único input de texto lo hace nativo — al revés
            que el checkbox "Ver desactivados" de /inventario, que sí
            necesita un botón explícito porque tildarlo solo no dispara nada.
            La Ayuda de al lado (nodo `GR38Q`/`oJ98B`) es PERMANENTE y
            distinta del aviso condicional de más abajo: ésta explica siempre
            qué alcanza el buscador; el de abajo avisa una vez que ya se está
            buscando en todas las órdenes, con un link para volver — algo que
            la maqueta no dibuja pero que sigue haciendo falta (su silencio
            no es instrucción de sacarlo).

            En el teléfono el campo ocupa todo el ancho y la nota pasa a su
            propia línea debajo (`flex-col`); en escritorio vuelven a
            compartir una sola fila, sin cambios. `h-10` (40px) y no los 46px
            que dibuja `CAM4k`: la misma decisión ya tomada en
            `FiltrosDeInventario` (app/(app)/inventario/page.tsx) — 40px es
            la altura de CUALQUIER input de esta app, y sumar una excepción
            acá no gana nada. */}
        <form action="/servicio-tecnico" className="flex flex-col gap-[6px] lg:flex-row lg:items-center lg:gap-[10px]">
          {filtro ? <input type="hidden" name="estado" value={filtro} /> : null}
          <div className="relative lg:flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-[13px] size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={busqueda}
              aria-label="Buscar por número, cliente, modelo o IMEI"
              placeholder="Número, cliente, modelo o IMEI"
              className="h-10 w-full rounded-[9px] border-input bg-card pl-9 text-sm"
            />
          </div>
          <span className="text-[11px] text-muted-foreground lg:shrink-0">
            Buscar alcanza también a las entregadas y anuladas
          </span>
        </form>

        {buscandoEnTodas ? (
          <p className="text-sm text-muted-foreground">
            Buscando «{busqueda}» en todas las órdenes, incluidas las entregadas y las anuladas.{' '}
            <Link href="/servicio-tecnico" className="underline">
              Volver a las abiertas
            </Link>
          </p>
        ) : null}

        <Listado
          filas={filas}
          total={total}
          pagina={pagina}
          paginas={paginas}
          porPagina={POR_PAGINA}
          filtro={filtro}
          buscandoEnTodas={buscandoEnTodas}
          busqueda={busqueda}
        />
      </div>
    </>
  )
}
