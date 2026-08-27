import {
  Box, CalendarClock, Car, Check, Coffee, Dog, Hammer, HeartPulse, Leaf, Menu,
  Scissors, Shirt, Smartphone, Sparkles, Stethoscope, Store, Utensils, Wrench, Zap,
} from 'lucide-react'
import { EntradaDeSubdominio, type BaseDeTenant } from './entrar'
import { Formulario } from './formulario'
import { Retrato, RetratoMovil } from './retrato'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet'
import estilos from './cierre.module.css'
import tipografia from './tipografia.module.css'

/**
 * Las secciones de la landing, en el orden en que se leen.
 *
 * Reescrito entero en la Task 4 del cierre del rediseño contra
 * design/arandano.pen, frame `Sitio / Landing` (nodo `vDLU8`, consultado en
 * vivo). La maqueta dibuja SIETE secciones —Nav, Hero, Módulos, Rubros,
 * Planes, Cierre, Pie— y ninguna comparte el copy con lo que había antes: el
 * código viejo tenía nueve piezas (header, Cartel, Prueba, Direccion,
 * LoQueHace, Rubros, Planes, Cierre, footer) porque Cartel+Prueba eran dos
 * secciones donde la maqueta pone una sola (Hero), y `Direccion`/`LoQueHace`
 * no tienen equivalente en las siete de la maqueta —el `.pen` no las dibuja
 * ESTADO DE REPOSO ni las MUDA a otro lado del frame (se buscaron, no están):
 * `Direccion` la elimina la decisión 3 del plan del cierre; `LoQueHace` (seis
 * filas numeradas de "qué hace" la app) queda reemplazada por lo que ahora
 * cuenta la misma historia distinto — Módulos (arquitectura: núcleo + tres
 * módulos) y Rubros (la grilla de doce rubros con qué módulos activa cada
 * uno).
 *
 * El copy es LITERAL del `.pen`, no reescrito ni "mejorado": es el texto que
 * el dueño del producto escribió en la maqueta.
 *
 * Todas son server components sin estado, salvo el trigger de "Entrar a mi
 * local" del Nav (`./entrar`, un componente cliente aparte) y el formulario de
 * captura (`./formulario`) — las únicas dos partes interactivas del sitio.
 *
 * `ANCHO` es la geometría de la maqueta, no una normalización nuestra: el
 * frame `Sitio / Landing` (nodo `vDLU8`) es de 1440px y todas sus secciones
 * miden 1328 de ancho, o sea 56px de padding lateral. Antes acá había un
 * `max-w-5xl` (1024px) heredado de un ciclo anterior al `.pen`, sostenido con
 * el argumento de que era "una decisión que este ciclo no reabre" — y no era
 * una decisión sobre nada, era código escrito antes de que existiera la
 * maqueta. Lo que costó: el Hero le da a la Muestra la mitad del ancho, y a
 * 1024px esa mitad son 464px contra los 720 del `.pen`. El carrito de
 * `retrato.tsx` copia los anchos de columna de /vender en píxeles, así que la
 * columna del nombre quedaba con ~25px útiles y cada artículo se leía una
 * palabra por renglón. Un contenedor demasiado angosto no se ve angosto: se
 * ve como una tabla rota.
 */

// Task 11 del ciclo móvil: el padding lateral pasa de 56px (px-14) a 20px
// (px-5) abajo de 1024 — design/arandano.pen, frame `Móvil / Sitio ·
// Landing`, consultado nodo por nodo (Nav, Hero, Muestra, Módulos, Rubros,
// Planes, Cierre y Pie miden 20px de margen lateral, los ocho). Como las ocho
// secciones ya comparten esta constante, migrar acá alcanza para las ocho a
// la vez — el mx-auto/max-w siguen sin tocarse, no atan nada abajo de 1440.
const ANCHO = 'mx-auto w-full max-w-[1440px] px-5 lg:px-14'

/**
 * El H2 que comparten Módulos, Rubros y Planes: 38px/700 Archivo, tracking
 * -1px, line-height 1.12 (design/arandano.pen: nodos `zJXxh`, `htFds`,
 * `Z4a34E` — los tres, medidos en vivo, son el mismo estilo letra por letra).
 * Un solo lugar para las tres en vez de repetir la clase tres veces: si la
 * maqueta cambia este tamaño, cambia acá y no en tres sitios que se pueden
 * desincronizar.
 *
 * Task 11 del ciclo móvil: mobile-first, con el valor del teléfono (26px/600,
 * sin tracking, line-height 1.15 — nodos `jY4rO`/`Mr56Z`/`d2y7WB`, frame
 * `Móvil / Sitio · Landing`) sin prefijo, y el de escritorio (el de siempre)
 * detrás de `lg:`.
 */
function TituloDeSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className={`${tipografia.archivo} text-[26px] leading-[1.15] font-semibold text-foreground lg:text-[38px] lg:leading-[1.12] lg:font-bold lg:tracking-[-1px]`}
    >
      {children}
    </h2>
  )
}

/**
 * Los tres links de sección — extraídos para no repetir el mismo `<a>` × 3
 * entre la barra de escritorio y el `Sheet` del teléfono (Task 11 del ciclo
 * móvil).
 */
const LINKS_DE_SECCION: { href: string; texto: string }[] = [
  { href: '#que-hace', texto: 'Qué hace' },
  { href: '#rubros', texto: 'Rubros' },
  { href: '#precios', texto: 'Precios' },
]

export function Nav({ base }: { base: BaseDeTenant }) {
  // Sin border-b (Minor 7 de la review final): el .pen (nodo g3oxH) no
  // dibuja stroke acá. El Pie sí lo lleva (border-t, más abajo) y ahí
  // corresponde: son nodos distintos con decisiones distintas.
  //
  // Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Sitio ·
  // Landing`, nodo `fI6bl`): el Nav baja de 76 a 60px, el logo de 26 a 22, y
  // "Arándano" de 17/700 a 16/600 — mobile-first. Los tres links de sección y
  // "Entrar a mi local" (nodo `BEen9`) siguen sin verse en la fila —la
  // maqueta sólo dibuja el ícono de menú (`K60WPs`)— pero no pueden
  // desaparecer sin más: reaparecen dentro del `Sheet` que ese ícono abre.
  return (
    <header>
      <div className={`${ANCHO} flex h-[60px] items-center justify-between lg:h-[76px]`}>
        <div className="flex items-center gap-[9px]">
          <span aria-hidden="true" className="size-[22px] rounded-full bg-primary lg:size-[26px]" />
          <span
            className={`${tipografia.archivo} text-[16px] font-semibold text-foreground lg:text-[17px] lg:font-bold`}
          >
            Arándano
          </span>
        </div>
        <nav className="hidden items-center gap-[26px] lg:flex">
          {LINKS_DE_SECCION.map((link) => (
            <a key={link.href} href={link.href} className="text-[13px] font-medium text-foreground-soft">
              {link.texto}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          {/* El toggle de "Entrar a mi local" es su propio componente cliente
              (./entrar): la maqueta sólo dibuja el texto en reposo —un click
              revela el campo de subdominio—, mismo patrón que ya usan
              "Cambiar clave" en /usuarios y los mini-forms de caja.tsx. Sólo
              de escritorio: en el teléfono vive dentro del Sheet, más abajo. */}
          <div className="hidden lg:block">
            <EntradaDeSubdominio base={base} />
          </div>
          {/* h-[38px]/rounded-[9px]/gap-[7px]/px-[15px]: la geometría real de
              o0Cl42 (Minor 8 de la review final, consultado en vivo) —
              `size="sm"` da 28px de alto, r=12, gap=4, pad-x=10. Se mantiene
              igual en el teléfono: la maqueta mueve el resto de la barra
              (links, entrada) a un Sheet, no a este botón. */}
          <Button asChild className="h-[38px] gap-[7px] rounded-[9px] px-[15px]">
            <a href="#contacto">Probar 5 días</a>
          </Button>
          {/* El ícono de menú (nodo `K60WPs`, `bT6Ao`): sólo existe abajo de
              1024px, y abre un Sheet con lo que la fila angosta no tiene
              lugar para mostrar — los tres links de sección y "Entrar a mi
              local". Mismo patrón que el botón de fechas de `/ventas`
              (app/(app)/ventas/page.tsx). */}
          <Sheet>
            <SheetTrigger
              aria-label="Abrir menú"
              className="flex size-9 shrink-0 items-center justify-center rounded-[9px] lg:hidden"
            >
              <Menu aria-hidden="true" className="size-5 lg:hidden" />
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Menú</SheetTitle>
                <SheetDescription>Navegación del sitio y acceso a tu local.</SheetDescription>
              </SheetHeader>
              <nav className="flex flex-col gap-4 px-4">
                {LINKS_DE_SECCION.map((link) => (
                  <a key={link.href} href={link.href} className="text-sm font-medium text-foreground-soft">
                    {link.texto}
                  </a>
                ))}
              </nav>
              <div className="px-4">
                <EntradaDeSubdominio base={base} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

export function Hero({ whatsapp }: { whatsapp: string }) {
  return (
    // Las dos columnas del Hero NO son iguales: el `.pen` le da 560px al texto
    // (`eUCUn`) y 720 a la Muestra (`g5k1vK`), con 48 de gap — 560:720 es 7:9.
    // En `fr` en vez de píxeles para que la proporción se sostenga sola cuando
    // el contenedor no llega a 1328.
    //
    // Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Sitio ·
    // Landing`, nodo `Sv9VR`): abajo de 1024 esto es una sola columna
    // (`grid` sin `grid-cols` propio hasta `lg:`), con su propio gap/padding
    // (20/32/28 contra 48/48/48 de escritorio) — y la Muestra NO vive acá: se
    // oculta (`hidden lg:block`, más abajo) porque el `.pen` la promueve a su
    // propia sección entre Hero y Módulos (`Muestra`, definida después de
    // `Cierre`/`Pie` en este archivo). Nunca desaparece sin más: sigue
    // existiendo acá para escritorio y reaparece ahí para el teléfono.
    <section
      className={`${ANCHO} grid gap-5 pt-8 pb-7 lg:grid-cols-[7fr_9fr] lg:items-center lg:gap-12 lg:py-12`}
    >
      <div className="flex flex-col gap-5 lg:gap-[22px]">
        <span className="flex w-fit items-center gap-[7px] rounded-full bg-accent px-[11px] py-1.5 lg:px-3">
          <Sparkles aria-hidden="true" className="size-[13px] text-primary" />
          <span className="text-[11px] font-semibold text-primary lg:text-xs">
            Hecho para el mercado argentino
          </span>
        </span>

        {/* H1 + bajada comparten un gap propio de 12px en el teléfono (nodo
            `rLKaR`); `lg:contents` los disuelve como hermanos directos del
            gap-[22px] de arriba, que es exactamente cómo ya vivían en
            escritorio antes de este ciclo — mismo mecanismo que ya usa
            `Listado` (app/(app)/ventas/page.tsx) para no mover el aspecto de
            escritorio ni un píxel. */}
        <div className="flex flex-col gap-3 lg:contents">
          <h1
            className={`${tipografia.archivo} text-[36px] leading-[1.1] font-semibold text-foreground lg:text-[62px] lg:leading-[1.03] lg:font-bold lg:tracking-[-2px]`}
          >
            Todo el local en un solo lugar
          </h1>

          <p className="text-sm leading-[1.5] text-foreground-soft lg:text-[17px] lg:leading-[1.6]">
            Ventas, stock, caja en pesos y dólares, facturación ARCA, catálogo público y un bot de
            WhatsApp conectado a los datos reales del negocio. Sobre eso, cada rubro suma lo suyo.
          </p>
        </div>

        {/* "Quiero probarlo": el .pen le pone un texto de botón distinto al
            del Cierre ("Empezar", el default) — mismo campo, mismo action,
            invitación distinta según dónde aparece. */}
        <Formulario whatsapp={whatsapp} textoBoton="Quiero probarlo" />

        <p className="text-[11px] text-muted-foreground lg:text-xs">
          5 días gratis · sin tarjeta · el alta es instantánea
        </p>
      </div>

      {/* La "Muestra": barra de navegador + el carrito real + el pie que
          aclara que no es una captura (design/arandano.pen, nodo `g5k1vK`).
          `hidden lg:block`: en el teléfono esta versión no se dibuja — la de
          abajo de 1024 es la sección `Muestra` propia, con su propio carrito
          en cards (RetratoMovil) contra el nodo `TVNp5`. */}
      <div className="hidden w-full rounded-[18px] border bg-background p-5 lg:block">
        <div className="mb-3.5 flex items-center gap-2">
          {/* Los tres puntos del navegador: rojo/ámbar/verde. El .pen los
              declara en hex crudo sin ningún token asociado (son chrome
              decorativo de ventana, no marca), así que en vez de inventar un
              color se reusan los tres tokens semánticos que YA significan
              exactamente eso en el resto de la app: destructive/warn/ok.
              Reusar el SIGNIFICADO es la decisión más defendible de las tres
              de este bloque como criterio — y la peor en resultado (Minor 5
              de la review final): los tres tokens están pensados para texto
              sobre claro, y son bastante más oscuros y pesados que los
              pasteles del .pen. Se acepta la diferencia de VALOR (no sólo de
              nombre) para no sumar tres tokens nuevos por tres puntos
              decorativos de 9px. */}
          <span aria-hidden="true" className="size-[9px] rounded-full bg-destructive" />
          <span aria-hidden="true" className="size-[9px] rounded-full bg-warn" />
          <span aria-hidden="true" className="size-[9px] rounded-full bg-ok" />
          {/* $ar-font, 11px — no font-mono (Minor 6 de la review final): el
              precedente que justificaba el monoespaciado era la sección
              Direccion (la caja con la URL de ejemplo), que la decisión 3 del
              plan del cierre borró; sin ella no queda ningún motivo para que
              esta URL sea la única pieza monoespaciada del sitio. */}
          <span className="text-[11px] text-muted-foreground">flor.arandano.app/vender</span>
        </div>

        <Retrato />

        <p className="mt-3.5 text-[11px] leading-[1.45] text-muted-foreground">
          No es una captura: es el mismo componente y el mismo formateo de plata que corre en el
          punto de venta.
        </p>
      </div>
    </section>
  )
}

/**
 * La "Muestra": la promoción a sección propia del bloque barra+carrito+nota
 * del Hero, sólo para el teléfono (design/arandano.pen, frame `Móvil / Sitio
 * · Landing`, nodo `tsOj4`, entre Hero y Módulos). `lg:hidden`: desde
 * escritorio esta sección no existe — ahí la Muestra sigue viviendo dentro
 * del Hero (ver arriba), que es donde el `.pen` de escritorio la dibuja.
 *
 * El carrito en sí es `RetratoMovil` (app/sitio/retrato.tsx) y no `Retrato`:
 * la maqueta del teléfono no colapsa la tabla, la REDIBUJA como una lista de
 * cards (nodo `TVNp5`) — mismo dato (`ITEMS`/`TOTAL`/…), marcado distinto.
 */
export function Muestra() {
  return (
    <section className={`${ANCHO} flex flex-col gap-3 pb-8 lg:hidden`}>
      <div className="flex h-[34px] items-center gap-[7px] rounded-t-[12px] bg-muted px-3">
        <span aria-hidden="true" className="size-[7px] rounded-full bg-muted-foreground/40" />
        <span aria-hidden="true" className="size-[7px] rounded-full bg-muted-foreground/40" />
        <span aria-hidden="true" className="size-[7px] rounded-full bg-muted-foreground/40" />
        <span className="flex-1 text-center text-[10px] font-medium text-muted-foreground">
          flor.arandano.app/vender
        </span>
      </div>

      <RetratoMovil />

      <p className="text-[11px] leading-[1.4] text-muted-foreground">
        No es una captura: es el mismo componente y el mismo formateo de plata que corre en el punto
        de venta.
      </p>
    </section>
  )
}

/**
 * Las ocho piezas del núcleo, en el orden del `.pen` (nodo `J29KtQ`).
 */
const NUCLEO = ['Clientes', 'Catálogo', 'Inventario', 'Ventas', 'Caja ARS/USD', 'Facturación ARCA', 'Catálogo público', 'Bot']

type EstadoModulo = 'Disponible' | 'En camino'

/**
 * Los tres módulos activables, con su ESTADO como dato y no como texto fijo
 * repetido tres veces: hoy Órdenes de trabajo está construido y Turnos y
 * Gastronomía no (CLAUDE.md, sección "Roadmap de producto"). El día que
 * Turnos se entregue, este archivo cambia en UN lugar (este array), no en
 * tres bloques de JSX copiados a mano donde alguno podría quedarse diciendo
 * "En camino" de un módulo que ya se puede usar.
 */
export const MODULOS: { icono: typeof Wrench; titulo: string; detalle: string; rubros: string; estado: EstadoModulo }[] = [
  {
    icono: Wrench,
    titulo: 'Órdenes de trabajo',
    detalle: 'Ingreso, diagnóstico, presupuesto, aprobación, repuestos y cierre.',
    rubros: 'Servicio técnico · Electricista · Plomería · Refrigeración',
    estado: 'Disponible',
  },
  {
    icono: CalendarClock,
    titulo: 'Turnos',
    detalle: 'Agenda, disponibilidad, profesionales y recordatorio automático por bot.',
    rubros: 'Peluquería · Estética · Consultorio · Taller · Veterinaria',
    estado: 'En camino',
  },
  {
    icono: Utensils,
    titulo: 'Gastronomía',
    detalle: 'Mesas, comandas, pantalla de cocina y recetas que descuentan insumos.',
    rubros: 'Bar · Cafetería · Restó · Delivery',
    estado: 'En camino',
  },
]

function ChipDeEstado({ estado }: { estado: EstadoModulo }) {
  if (estado === 'Disponible') {
    return (
      <span className="rounded-full bg-ok-soft px-[9px] py-[3px] text-[11px] font-semibold text-ok">
        Disponible
      </span>
    )
  }
  return (
    <span className="rounded-full bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-foreground-soft">
      En camino
    </span>
  )
}

export function Modulos() {
  return (
    // Task 11 del ciclo móvil (nodo `Csb0k`): py-16(64px) es sólo de
    // escritorio; en el teléfono es py-8(32px).
    <section id="que-hace" className="bg-background py-8 lg:py-16">
      <div className={`${ANCHO} flex flex-col gap-[18px] lg:gap-7`}>
        <div className="flex max-w-[640px] flex-col gap-[10px] lg:gap-3">
          <TituloDeSeccion>Un núcleo, tres módulos, rubros ilimitados</TituloDeSeccion>
          <p className="text-[13px] leading-[1.5] text-foreground-soft lg:text-[15px] lg:leading-[1.6]">
            El núcleo solo ya cubre un comercio completo. Los módulos agregan comportamiento, y un
            rubro nuevo es un archivo de configuración, no desarrollo.
          </p>
        </div>

        {/* La card "Núcleo": la única superficie de --marca de esta sección,
            y la segunda del sitio (la primera y hasta ahora única era la
            franja de Cierre). design/arandano.pen la dibuja así (nodo
            `QeDxe`) y no como una card gris más — ver la nota que agrega esta
            task a docs/sistema-de-diseno.md, sección "El arándano como
            superficie": una landing no es una pantalla de aplicación con UN
            dato operativo, así que la regla de "una por pantalla" se aplica
            por SECCIÓN visible a la vez, no por documento entero, igual que
            ya la reescribió la excepción del avatar del sidebar.

            Task 11: p-[26px] es de escritorio (nodo QeDxe); el teléfono
            (nodo `pfHPO`) usa p-4(16px). */}
        <div className="rounded-[18px] p-4 lg:p-[26px]" style={{ backgroundColor: 'var(--marca)' }}>
          <div className="flex items-center gap-2.5">
            <Box aria-hidden="true" className="size-[17px] lg:size-[19px]" style={{ color: 'var(--marca-soft)' }} />
            <span
              className={`${tipografia.archivo} text-[17px] font-semibold lg:text-xl`}
              style={{ color: 'var(--marca-foreground)' }}
            >
              Núcleo
            </span>
            <span className="text-[11px] lg:text-[13px]" style={{ color: 'var(--marca-dim)' }}>
              lo que todo negocio necesita
            </span>
          </div>
          {/* Las ocho piezas: en el teléfono son 4 filas de 2 chips llenos
              (34px, nodos UQrG7/jlqSU/…), no la fila de chips-píldora que
              queda desde escritorio (nodo `r3jDf` vs. lo que ya había). */}
          <div className="mt-3 grid grid-cols-2 gap-2 lg:mt-4 lg:flex lg:flex-wrap lg:gap-2.5">
            {NUCLEO.map((pieza) => (
              <span
                key={pieza}
                className="flex h-[34px] items-center justify-center rounded-[9px] bg-[#FFFFFF1A] px-2 text-xs font-medium text-[var(--marca-foreground)] lg:h-auto lg:justify-start lg:rounded-full lg:border lg:border-[color-mix(in_srgb,var(--marca-foreground)_15%,transparent)] lg:bg-[color-mix(in_srgb,var(--marca-foreground)_8%,transparent)] lg:px-[13px] lg:py-2"
              >
                {pieza}
              </span>
            ))}
          </div>
        </div>

        {/* Task 11: las tres tarjetas son una columna en el teléfono (nodo
            `Csb0k`: Órdenes/Turnos/Gastronomía son hermanos apilados) y
            recién desde lg: pasan a 3. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {MODULOS.map((modulo) => (
            <Card key={modulo.titulo} className="rounded-[16px] py-[22px]">
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="flex size-[38px] items-center justify-center rounded-[11px] bg-accent">
                    <modulo.icono aria-hidden="true" className="size-[18px] text-primary" />
                  </span>
                  <ChipDeEstado estado={modulo.estado} />
                </div>
                <span
                  className={`${tipografia.archivo} text-[19px] leading-[1.2] font-semibold text-foreground`}
                >
                  {modulo.titulo}
                </span>
                <p className="text-[13px] leading-[1.5] text-foreground-soft">{modulo.detalle}</p>
                <p className="text-[11px] leading-[1.5] font-semibold text-primary">{modulo.rubros}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * Los doce rubros de la grilla, en el orden del `.pen` (nodo `tr8lP`, tres
 * filas de cuatro). "Módulos" describe qué activa cada uno tal cual lo
 * escribió el `.pen`: "Sólo núcleo" para el que no prende ningún módulo,
 * "Núcleo + X" para el resto — CLAUDE.md documenta la misma idea en la
 * sección "Arquitectura de producto: núcleo, módulos y presets de rubro".
 */
export const RUBROS: { icono: typeof Smartphone; titulo: string; modulos: string }[] = [
  { icono: Smartphone, titulo: 'Celulares y servicio técnico', modulos: 'Núcleo + Órdenes de trabajo' },
  { icono: Store, titulo: 'Kiosco y autoservicio', modulos: 'Sólo núcleo' },
  { icono: Shirt, titulo: 'Ropa e indumentaria', modulos: 'Sólo núcleo' },
  { icono: Hammer, titulo: 'Ferretería', modulos: 'Sólo núcleo' },
  { icono: Dog, titulo: 'Pet shop', modulos: 'Sólo núcleo' },
  { icono: Leaf, titulo: 'Dietética', modulos: 'Sólo núcleo' },
  { icono: Scissors, titulo: 'Peluquería y estética', modulos: 'Núcleo + Turnos' },
  { icono: Stethoscope, titulo: 'Veterinaria', modulos: 'Núcleo + Turnos' },
  { icono: Car, titulo: 'Taller mecánico', modulos: 'Núcleo + Turnos + Órdenes' },
  { icono: Zap, titulo: 'Electricista y plomería', modulos: 'Núcleo + Órdenes de trabajo' },
  { icono: HeartPulse, titulo: 'Consultorio', modulos: 'Núcleo + Turnos' },
  { icono: Coffee, titulo: 'Bar y cafetería', modulos: 'Núcleo + Gastronomía' },
]

export function Rubros() {
  return (
    // Task 11 del ciclo móvil (nodo `EKea9`): py-16 es sólo de escritorio;
    // el teléfono es py-8.
    <section id="rubros" className="py-8 lg:py-16">
      <div className={`${ANCHO} flex flex-col gap-[18px] lg:gap-6`}>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between lg:gap-10">
          <div className="flex max-w-[600px] flex-col gap-[10px] lg:gap-3">
            <TituloDeSeccion>Tu rubro ya está adentro</TituloDeSeccion>
            <p className="text-[13px] leading-[1.5] text-foreground-soft lg:text-[15px] lg:leading-[1.6]">
              Un rubro no es código: es qué módulos vienen activados, qué datos demo se cargan y
              cómo se llaman las cosas en la pantalla.
            </p>
          </div>
          {/* Fix de la Ronda de arreglos 1 sobre la Task 11: en escritorio la
              nota vive ACÁ, al lado del encabezado (nodo `bHS71`, la maqueta
              de escritorio la reparte con justify-between) — pero en el
              .pen del teléfono (`EKea9`) es un hermano APARTE, DESPUÉS de la
              grilla, no del encabezado. `hidden lg:block` la saca de acá
              abajo de 1024; la copia de después de la grilla es la que se ve
              en el teléfono. */}
          <p className="hidden text-xs font-semibold text-primary lg:block">
            ¿No está el tuyo? Se agrega sin desarrollo.
          </p>
        </div>

        {/* Task 11: a diferencia de Módulos y Planes (una columna), el .pen
            (nodo `dDugH`) arma esta grilla en PARES — 2 columnas en el
            teléfono, no 1 — y recién desde lg: pasa a las 4 de siempre. Cada
            card, además, cambia de fila (ícono+texto, escritorio) a columna
            (ícono arriba, texto abajo, teléfono — nodo `E39sL`): sin el
            círculo de fondo del ícono, que la maqueta del teléfono no
            dibuja. */}
        <div className="grid grid-cols-2 gap-[10px] lg:grid-cols-4 lg:gap-3">
          {RUBROS.map((rubro) => (
            <div
              key={rubro.titulo}
              className="flex flex-col items-start gap-2 rounded-[13px] bg-card p-[13px] lg:flex-row lg:items-center lg:gap-3 lg:border lg:p-4"
            >
              <span className="lg:flex lg:size-[34px] lg:shrink-0 lg:items-center lg:justify-center lg:rounded-[10px] lg:bg-background">
                <rubro.icono aria-hidden="true" className="size-[19px] text-primary lg:size-[17px]" />
              </span>
              <div className="flex flex-col gap-[3px] lg:gap-0.5">
                <span className="text-[13px] leading-[1.3] font-semibold text-foreground">{rubro.titulo}</span>
                <span className="text-[11px] leading-[1.35] text-muted-foreground">{rubro.modulos}</span>
              </div>
            </div>
          ))}
        </div>

        {/* La copia del teléfono (nodo `FR90j`, hermano de la Grilla, no del
            Encabezado): `lg:hidden` la saca desde escritorio, donde la nota
            de arriba (`hidden lg:block`) ya la muestra. */}
        <p className="text-xs font-semibold text-primary lg:hidden">
          ¿No está el tuyo? Se agrega sin desarrollo.
        </p>
      </div>
    </section>
  )
}

type Plan = {
  nombre: string
  precio: string
  periodo: string
  detalle: string
  incluye: string[]
  accion: string
  destacado?: boolean
}

/**
 * Los cuatro planes, con el precio real de la maqueta (design/arandano.pen,
 * nodo `ZEntb`) — antes esta sección no mostraba ningún precio.
 */
export const PLANES: Plan[] = [
  {
    nombre: 'Básico',
    precio: '$ 24.900',
    periodo: 'por mes · IVA incluido',
    detalle: 'Un local, una persona.',
    incluye: ['1 usuario', '1 sucursal', 'Ventas, stock y caja', 'Catálogo público'],
    accion: 'Probar 5 días',
  },
  {
    nombre: 'Negocio',
    precio: '$ 44.900',
    periodo: 'por mes · IVA incluido',
    detalle: 'El local con equipo.',
    incluye: ['5 usuarios', '1 sucursal', 'Todo lo del Básico', 'Facturación ARCA', 'Reportes'],
    accion: 'Probar 5 días',
  },
  {
    nombre: 'Profesional',
    precio: '$ 79.900',
    periodo: 'por mes · IVA incluido',
    detalle: 'El más elegido.',
    incluye: [
      '15 usuarios',
      '3 sucursales',
      'Todo lo del Negocio',
      'Bot de WhatsApp e Instagram',
      'Seguimiento de ventas frías',
      'Pedido de reseñas',
    ],
    accion: 'Probar 5 días',
    destacado: true,
  },
  {
    nombre: 'Premium',
    precio: 'A medida',
    periodo: 'hablemos',
    detalle: 'Infraestructura dedicada.',
    incluye: ['Usuarios ilimitados', 'Sucursales ilimitadas', 'VPC propia', 'Soporte prioritario'],
    accion: 'Hablemos',
  },
]

export function Planes() {
  return (
    // Task 11 del ciclo móvil (nodo `IvCnb`): py-16 es sólo de escritorio;
    // el teléfono es py-8.
    <section id="precios" className="bg-background py-8 lg:py-16">
      <div className={`${ANCHO} flex flex-col gap-[18px] lg:gap-7`}>
        <div className="flex max-w-[640px] flex-col gap-[10px] lg:gap-3">
          <TituloDeSeccion>Precios claros, en pesos</TituloDeSeccion>
          <p className="text-[13px] leading-[1.5] text-foreground-soft lg:text-[15px] lg:leading-[1.6]">
            Los módulos no se cobran aparte ni dependen del plan: activás los que necesites. El
            plan limita capacidad, no rubro.
          </p>
        </div>

        {/* Task 11: los cuatro planes son una columna en el teléfono (nodo
            `IvCnb`: Básico/Negocio/Profesional/Premium son hermanos
            apilados) y recién desde lg: pasan a 4. */}
        <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-4 lg:gap-4">
          {PLANES.map((plan) => (
            <div
              key={plan.nombre}
              // El destacado (Profesional) es la TERCERA superficie de --marca
              // del sitio, y la misma nota de arriba (card Núcleo) aplica acá:
              // design/arandano.pen la dibuja así (nodo `riAck`), verificado
              // en vivo — no es un invento de este código. Padding/gap: 16/12
              // en el teléfono (nodos atnSX/gQWor/lfOtz/PvUHb), 24/16 desde
              // escritorio (el valor de siempre).
              className={`flex flex-col gap-3 rounded-[18px] p-4 lg:gap-4 lg:p-6 ${
                plan.destacado ? '' : 'border bg-card'
              }`}
              style={plan.destacado ? { backgroundColor: 'var(--marca)' } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-sm font-bold"
                  style={{ color: plan.destacado ? 'var(--marca-foreground)' : undefined }}
                >
                  {plan.nombre}
                </span>
                {plan.destacado && (
                  <span
                    className="rounded-full px-[9px] py-1 text-[10px] font-bold"
                    style={{
                      color: 'var(--marca-soft)',
                      backgroundColor: 'color-mix(in srgb, var(--marca-foreground) 12%, transparent)',
                    }}
                  >
                    Más elegido
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                <span
                  className={`${tipografia.archivo} text-[32px] leading-none font-bold tracking-[-1px]`}
                  style={{ color: plan.destacado ? 'var(--marca-foreground)' : undefined }}
                >
                  {plan.precio}
                </span>
                <span
                  className="text-[11px]"
                  style={{ color: plan.destacado ? 'var(--marca-dim)' : undefined }}
                >
                  {plan.periodo}
                </span>
              </div>

              <p
                className="text-xs"
                style={{ color: plan.destacado ? 'var(--marca-soft)' : undefined }}
              >
                {plan.detalle}
              </p>

              <ul className="flex flex-1 flex-col gap-2">
                {plan.incluye.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check
                      aria-hidden="true"
                      className="size-[13px] shrink-0"
                      style={{ color: plan.destacado ? 'var(--marca-soft)' : 'var(--primary)' }}
                    />
                    <span
                      className="text-xs leading-[1.4]"
                      style={{ color: plan.destacado ? 'var(--marca-foreground)' : undefined }}
                    >
                      {item}
                    </span>
                  </li>
                ))}
              </ul>

              {plan.destacado ? (
                // Botón blanco sólido con texto --marca: no es el par
                // "on-primary" que llevan los botones de acción (ese token
                // sólo se puede nombrar adentro de components/ui/) — es el
                // mismo par marca/marca-deep que ya usa el avatar del
                // sidebar para "texto oscuro sobre superficie clara".
                <a
                  href="#contacto"
                  className="flex h-11 items-center justify-center rounded-[10px] text-[13px] font-semibold lg:h-[42px]"
                  style={{ backgroundColor: 'var(--marca-foreground)', color: 'var(--marca)' }}
                >
                  {plan.accion}
                </a>
              ) : (
                // bg-card border-input: la superficie real de uYEg4 (Minor 9
                // de la review final, consultado en vivo) — variant="outline"
                // solo pinta bg-background + border-border, un blanco/gris
                // distinto del $ar-surface + $ar-line-strong que pide el .pen.
                // 44px en el teléfono (nodos j68gaY/GCzWp/Q4u0t), 42px desde
                // escritorio (el valor de siempre).
                <Button asChild variant="outline" className="h-11 border-input bg-card lg:h-[42px]">
                  <a href="#contacto">{plan.accion}</a>
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Cierre({ children }: { children: React.ReactNode }) {
  return (
    // Task 11 del ciclo móvil (nodo `OVMBq`): py-[72px]/gap-[22px] son de
    // escritorio; el teléfono es py-9(36px)/gap-4(16px).
    <section id="contacto" className={`${estilos.franja} py-9 lg:py-[72px]`}>
      <div className={`${ANCHO} flex flex-col items-center gap-4 text-center lg:gap-[22px]`}>
        <h2
          className={`${estilos.titulo} ${tipografia.archivo} max-w-[720px] text-[28px] leading-[1.15] font-semibold lg:text-[44px] lg:leading-[1.1] lg:font-bold lg:tracking-[-1.4px]`}
        >
          El alta es instantánea
        </h2>
        <p className={`${estilos.bajada} max-w-[620px] text-[13px] leading-[1.5] lg:text-base lg:leading-[1.6]`}>
          Dejás tu WhatsApp, elegís el rubro y en dos minutos tenés tu local cargado con datos de
          ejemplo para probarlo de verdad.
        </p>

        {/* Mismo <Formulario> que en Hero, sin tocar (ver el comentario de
            ahí): esta task arma las secciones, la Task 5 lo achica a un solo
            campo. */}
        <div className="w-full max-w-[520px]">{children}</div>

        <p className="text-[11px] lg:text-xs" style={{ color: 'var(--marca-dim)' }}>
          Sin tarjeta · exportás tus datos cuando quieras · soporte por WhatsApp
        </p>
      </div>
    </section>
  )
}

export function Pie() {
  return (
    <footer className="border-t">
      {/* Task 11 del ciclo móvil (nodo `itZnH`): apila en el teléfono
          (flex-col, gap 10) y vuelve a la fila con justify-between de
          siempre desde escritorio.

          Menor de la Ronda de arreglos 1: el padding vertical del teléfono
          NO es simétrico — el nodo pide [24,20,28,20] (24 arriba, 28 abajo),
          no los 24/24 (py-6) que había quedado acá. Desde escritorio sigue
          siendo py-6 simétrico, sin tocar. */}
      <div className={`${ANCHO} flex flex-col gap-[10px] pt-6 pb-7 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-6`}>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-[18px] rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Arándano · Buenos Aires, Argentina</span>
        </div>
        <span className="text-xs text-muted-foreground">Términos · Privacidad · Estado del servicio</span>
      </div>
    </footer>
  )
}
