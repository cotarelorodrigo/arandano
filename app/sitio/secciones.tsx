import {
  Box, CalendarClock, Car, Check, Coffee, Dog, Hammer, HeartPulse, Leaf,
  Scissors, Shirt, Smartphone, Sparkles, Stethoscope, Store, Utensils, Wrench, Zap,
} from 'lucide-react'
import { EntradaDeSubdominio, type BaseDeTenant } from './entrar'
import { Formulario } from './formulario'
import { Retrato } from './retrato'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
 * El ritmo vertical y el ancho del contenido (`ANCHO`) se mantienen del
 * código anterior a este ciclo: la maqueta es 1440px con 56px de padding
 * lateral; este sitio ya normalizaba eso a un contenedor centrado de
 * max-w-5xl (1024px) con su propio padding, decisión de un ciclo anterior que
 * este no reabre.
 */

const ANCHO = 'mx-auto w-full max-w-5xl px-6'

/**
 * El H2 que comparten Módulos, Rubros y Planes: 38px/700 Archivo, tracking
 * -1px, line-height 1.12 (design/arandano.pen: nodos `zJXxh`, `htFds`,
 * `Z4a34E` — los tres, medidos en vivo, son el mismo estilo letra por letra).
 * Un solo lugar para las tres en vez de repetir la clase tres veces: si la
 * maqueta cambia este tamaño, cambia acá y no en tres sitios que se pueden
 * desincronizar.
 */
function TituloDeSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className={`${tipografia.archivo} text-[38px] leading-[1.12] font-bold tracking-[-1px] text-foreground`}
    >
      {children}
    </h2>
  )
}

export function Nav({ base }: { base: BaseDeTenant }) {
  return (
    <header className="border-b">
      <div className={`${ANCHO} flex h-[76px] items-center justify-between`}>
        <div className="flex items-center gap-[9px]">
          <span aria-hidden="true" className="size-[26px] rounded-full bg-primary" />
          <span className={`${tipografia.archivo} text-[17px] font-bold text-foreground`}>
            Arándano
          </span>
        </div>
        <nav className="hidden items-center gap-[26px] md:flex">
          <a href="#que-hace" className="text-[13px] font-medium text-foreground-soft">
            Qué hace
          </a>
          <a href="#rubros" className="text-[13px] font-medium text-foreground-soft">
            Rubros
          </a>
          <a href="#precios" className="text-[13px] font-medium text-foreground-soft">
            Precios
          </a>
        </nav>
        <div className="flex items-center gap-2.5">
          {/* El toggle de "Entrar a mi local" es su propio componente cliente
              (./entrar): la maqueta sólo dibuja el texto en reposo —un click
              revela el campo de subdominio—, mismo patrón que ya usan
              "Cambiar clave" en /usuarios y los mini-forms de caja.tsx. */}
          <EntradaDeSubdominio base={base} />
          <Button asChild size="sm">
            <a href="#contacto">Probar 5 días</a>
          </Button>
        </div>
      </div>
    </header>
  )
}

export function Hero({ whatsapp }: { whatsapp: string }) {
  return (
    <section className={`${ANCHO} grid gap-12 py-12 md:grid-cols-2 md:items-center`}>
      <div className="flex flex-col gap-[22px]">
        <span className="flex w-fit items-center gap-[7px] rounded-full bg-accent px-3 py-1.5">
          <Sparkles aria-hidden="true" className="size-[13px] text-primary" />
          <span className="text-xs font-semibold text-primary">Hecho para el mercado argentino</span>
        </span>

        <h1
          className={`${tipografia.archivo} text-[62px] leading-[1.03] font-bold tracking-[-2px] text-foreground`}
        >
          Todo el local en un solo lugar
        </h1>

        <p className="text-[17px] leading-[1.6] text-foreground-soft">
          Ventas, stock, caja en pesos y dólares, facturación ARCA, catálogo público y un bot de
          WhatsApp conectado a los datos reales del negocio. Sobre eso, cada rubro suma lo suyo.
        </p>

        {/* "Quiero probarlo": el .pen le pone un texto de botón distinto al
            del Cierre ("Empezar", el default) — mismo campo, mismo action,
            invitación distinta según dónde aparece. */}
        <Formulario whatsapp={whatsapp} textoBoton="Quiero probarlo" />

        <p className="text-xs text-muted-foreground">
          5 días gratis · sin tarjeta · el alta es instantánea
        </p>
      </div>

      {/* La "Muestra": barra de navegador + el carrito real + el pie que
          aclara que no es una captura (design/arandano.pen, nodo `g5k1vK`). */}
      <div className="w-full rounded-[18px] border bg-background p-5">
        <div className="mb-3.5 flex items-center gap-2">
          {/* Los tres puntos del navegador: rojo/ámbar/verde. El .pen los
              declara en hex crudo sin ningún token asociado (son chrome
              decorativo de ventana, no marca), así que en vez de inventar un
              color se reusan los tres tokens semánticos que YA significan
              exactamente eso en el resto de la app: destructive/warn/ok. */}
          <span aria-hidden="true" className="size-[9px] rounded-full bg-destructive" />
          <span aria-hidden="true" className="size-[9px] rounded-full bg-warn" />
          <span aria-hidden="true" className="size-[9px] rounded-full bg-ok" />
          <span className="font-mono text-[11px] text-muted-foreground">flor.arandano.app/vender</span>
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
    <section id="que-hace" className="bg-background py-16">
      <div className={`${ANCHO} flex flex-col gap-7`}>
        <div className="flex max-w-[640px] flex-col gap-3">
          <TituloDeSeccion>Un núcleo, tres módulos, rubros ilimitados</TituloDeSeccion>
          <p className="text-[15px] leading-[1.6] text-foreground-soft">
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
            ya la reescribió la excepción del avatar del sidebar. */}
        <div className="rounded-[18px] p-[26px]" style={{ backgroundColor: 'var(--marca)' }}>
          <div className="flex items-center gap-2.5">
            <Box aria-hidden="true" className="size-[19px]" style={{ color: 'var(--marca-soft)' }} />
            <span
              className={`${tipografia.archivo} text-xl font-semibold`}
              style={{ color: 'var(--marca-foreground)' }}
            >
              Núcleo
            </span>
            <span className="text-[13px]" style={{ color: 'var(--marca-dim)' }}>
              lo que todo negocio necesita
            </span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {NUCLEO.map((pieza) => (
              <span
                key={pieza}
                className="rounded-full px-[13px] py-2 text-xs font-medium"
                style={{
                  color: 'var(--marca-foreground)',
                  backgroundColor: 'color-mix(in srgb, var(--marca-foreground) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--marca-foreground) 15%, transparent)',
                }}
              >
                {pieza}
              </span>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
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
    <section id="rubros" className="py-16">
      <div className={`${ANCHO} flex flex-col gap-6`}>
        <div className="flex flex-wrap items-end justify-between gap-10">
          <div className="flex max-w-[600px] flex-col gap-3">
            <TituloDeSeccion>Tu rubro ya está adentro</TituloDeSeccion>
            <p className="text-[15px] leading-[1.6] text-foreground-soft">
              Un rubro no es código: es qué módulos vienen activados, qué datos demo se cargan y
              cómo se llaman las cosas en la pantalla.
            </p>
          </div>
          <p className="text-xs font-semibold text-primary">¿No está el tuyo? Se agrega sin desarrollo.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {RUBROS.map((rubro) => (
            <div
              key={rubro.titulo}
              className="flex items-center gap-3 rounded-[13px] border bg-card p-4"
            >
              <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-background">
                <rubro.icono aria-hidden="true" className="size-[17px] text-primary" />
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] leading-[1.3] font-semibold text-foreground">{rubro.titulo}</span>
                <span className="text-[11px] leading-[1.35] text-muted-foreground">{rubro.modulos}</span>
              </div>
            </div>
          ))}
        </div>
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
    <section id="precios" className="bg-background py-16">
      <div className={`${ANCHO} flex flex-col gap-7`}>
        <div className="flex max-w-[640px] flex-col gap-3">
          <TituloDeSeccion>Precios claros, en pesos</TituloDeSeccion>
          <p className="text-[15px] leading-[1.6] text-foreground-soft">
            Los módulos no se cobran aparte ni dependen del plan: activás los que necesites. El
            plan limita capacidad, no rubro.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {PLANES.map((plan) => (
            <div
              key={plan.nombre}
              // El destacado (Profesional) es la TERCERA superficie de --marca
              // del sitio, y la misma nota de arriba (card Núcleo) aplica acá:
              // design/arandano.pen la dibuja así (nodo `riAck`), verificado
              // en vivo — no es un invento de este código.
              className={`flex flex-col gap-4 rounded-[18px] p-6 ${
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
                  className="flex h-[42px] items-center justify-center rounded-[10px] text-[13px] font-semibold"
                  style={{ backgroundColor: 'var(--marca-foreground)', color: 'var(--marca)' }}
                >
                  {plan.accion}
                </a>
              ) : (
                <Button asChild variant="outline" className="h-[42px]">
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
    <section id="contacto" className={`${estilos.franja} py-[72px]`}>
      <div className={`${ANCHO} flex flex-col items-center gap-[22px] text-center`}>
        <h2
          className={`${estilos.titulo} ${tipografia.archivo} max-w-[720px] text-[44px] leading-[1.1] font-bold tracking-[-1.4px]`}
        >
          El alta es instantánea
        </h2>
        <p className={`${estilos.bajada} max-w-[620px] text-base leading-[1.6]`}>
          Dejás tu WhatsApp, elegís el rubro y en dos minutos tenés tu local cargado con datos de
          ejemplo para probarlo de verdad.
        </p>

        {/* Mismo <Formulario> que en Hero, sin tocar (ver el comentario de
            ahí): esta task arma las secciones, la Task 5 lo achica a un solo
            campo. */}
        <div className="w-full max-w-[520px]">{children}</div>

        <p className="text-xs" style={{ color: 'var(--marca-dim)' }}>
          Sin tarjeta · exportás tus datos cuando quieras · soporte por WhatsApp
        </p>
      </div>
    </section>
  )
}

export function Pie() {
  return (
    <footer className="border-t">
      <div className={`${ANCHO} flex items-center justify-between gap-6 py-6`}>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="size-[18px] rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Arándano · Buenos Aires, Argentina</span>
        </div>
        <span className="text-xs text-muted-foreground">Términos · Privacidad · Estado del servicio</span>
      </div>
    </footer>
  )
}
