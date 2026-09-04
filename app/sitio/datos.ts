import {
  CalendarClock, Car, Coffee, Dog, Hammer, HeartPulse, Leaf, Scissors,
  Shirt, Smartphone, Stethoscope, Store, Utensils, Wrench, Zap,
} from 'lucide-react'

/**
 * El contenido de la landing: qué hace el producto, para qué rubros y a qué
 * precio.
 *
 * VIVE APARTE DE LAS SECCIONES a propósito. `secciones.tsx` llegó a 764 líneas
 * con ocho secciones y tres arrays adentro, que es justo lo que CLAUDE.md
 * describe como señal de que un archivo hace demasiado. Separar el DATO del
 * MARCADO además deja que un test afirme sobre el contenido —cuántos rubros
 * hay, qué módulos esperan— sin renderizar nada.
 */

/**
 * Las ocho piezas del núcleo, en el orden del `.pen` (nodo `J29KtQ`).
 */
export const NUCLEO = [
  'Clientes', 'Catálogo', 'Inventario', 'Ventas', 'Caja ARS/USD',
  'Facturación ARCA', 'Catálogo público', 'Bot',
]

export type ClaveDeModulo = 'ordenes' | 'turnos' | 'gastronomia'
type EstadoModulo = 'Disponible' | 'En camino'

/**
 * Los tres módulos activables, con su ESTADO como dato y no como texto fijo
 * repetido: hoy Órdenes de trabajo está construido y Turnos y Gastronomía no
 * (CLAUDE.md, "Roadmap de producto"). El día que Turnos se entregue, cambia
 * acá y en ningún otro lado.
 */
export const MODULOS: {
  clave: ClaveDeModulo
  icono: typeof Wrench
  titulo: string
  detalle: string
  rubros: string
  estado: EstadoModulo
}[] = [
  {
    clave: 'ordenes',
    icono: Wrench,
    titulo: 'Órdenes de trabajo',
    detalle: 'Ingreso, diagnóstico, presupuesto, aprobación del cliente, repuestos y cierre.',
    rubros: 'Servicio técnico · Electricista · Plomería · Refrigeración',
    estado: 'Disponible',
  },
  {
    clave: 'turnos',
    icono: CalendarClock,
    titulo: 'Turnos',
    detalle: 'Agenda, disponibilidad, profesionales y recordatorio automático por bot.',
    rubros: 'Peluquería · Estética · Consultorio · Taller · Veterinaria',
    estado: 'En camino',
  },
  {
    clave: 'gastronomia',
    icono: Utensils,
    titulo: 'Gastronomía',
    detalle: 'Mesas, comandas, pantalla de cocina y recetas que descuentan insumos.',
    rubros: 'Bar · Cafetería · Restó · Delivery',
    estado: 'En camino',
  },
]

/**
 * Los doce rubros, en el orden del `.pen` (nodo `tr8lP`).
 *
 * QUÉ CAMBIÓ Y POR QUÉ. Cada rubro declara ahora QUÉ MÓDULOS activa, como
 * lista de claves, en vez de traer escrita la frase "Núcleo + Turnos". El
 * texto y la disponibilidad se derivan de `MODULOS`, que es el único lugar
 * donde vive el estado de cada módulo.
 *
 * No es prolijidad: hasta el rediseño, cuatro rubros anunciaban "Núcleo +
 * Turnos" bajo un título que dice "Tu rubro ya está adentro", mientras la
 * sección de arriba decía que Turnos está En camino. Un dueño de peluquería
 * leía que su rubro ya estaba y no estaba. Con el texto derivado, esa
 * contradicción no se puede volver a escribir.
 */
export const RUBROS: { icono: typeof Smartphone; titulo: string; modulos: ClaveDeModulo[] }[] = [
  { icono: Smartphone, titulo: 'Celulares y servicio técnico', modulos: ['ordenes'] },
  { icono: Store, titulo: 'Kiosco y autoservicio', modulos: [] },
  { icono: Shirt, titulo: 'Ropa e indumentaria', modulos: [] },
  { icono: Hammer, titulo: 'Ferretería', modulos: [] },
  { icono: Dog, titulo: 'Pet shop', modulos: [] },
  { icono: Leaf, titulo: 'Dietética', modulos: [] },
  { icono: Scissors, titulo: 'Peluquería y estética', modulos: ['turnos'] },
  { icono: Stethoscope, titulo: 'Veterinaria', modulos: ['turnos'] },
  { icono: Car, titulo: 'Taller mecánico', modulos: ['turnos', 'ordenes'] },
  { icono: Zap, titulo: 'Electricista y plomería', modulos: ['ordenes'] },
  { icono: HeartPulse, titulo: 'Consultorio', modulos: ['turnos'] },
  { icono: Coffee, titulo: 'Bar y cafetería', modulos: ['gastronomia'] },
]

export function moduloPorClave(clave: ClaveDeModulo) {
  const modulo = MODULOS.find((candidato) => candidato.clave === clave)
  if (!modulo) throw new Error(`No existe el módulo "${clave}".`)
  return modulo
}

/** Qué activa un rubro, escrito: "Núcleo" solo, o "Núcleo + X + Y". */
export function queActiva(modulos: ClaveDeModulo[]): string {
  if (modulos.length === 0) return 'Núcleo'
  return `Núcleo + ${modulos.map((clave) => moduloPorClave(clave).titulo).join(' + ')}`
}

/** Los módulos de un rubro que todavía no están construidos. Vacío quiere
 *  decir que ese rubro funciona hoy, entero. */
export function loQueFalta(modulos: ClaveDeModulo[]) {
  return modulos.map(moduloPorClave).filter((modulo) => modulo.estado === 'En camino')
}

export type Plan = {
  nombre: string
  /** El importe sin signo, ya agrupado: el `$` se dibuja aparte, con su propio
   *  rol tipográfico, igual que en la banda del total del punto de venta.
   *
   *  SIN DECIMALES, y no es una inconsistencia con `formatearPrecio`: una
   *  venta se cobra al centavo y una lista de precios se cotiza en pesos
   *  enteros. Lo que este rediseño sí unificó es la TIPOGRAFÍA de la plata —
   *  acá y en el carrito el número se escribe con la misma cara angosta y
   *  cifras tabulares de `components/importe.module.css`. */
  precio: string | null
  /** null en Premium: no hay número que escribir, y un "$" suelto delante de
   *  "A medida" se lee como un precio roto. */
  textoSinPrecio?: string
  periodo: string
  detalle: string
  incluye: string[]
  accion: string
  destacado?: boolean
}

/**
 * Los cuatro planes, con el precio de la maqueta (design/arandano.pen, nodo
 * `ZEntb`).
 *
 * LA ESCALERA ES ACUMULATIVA, y por eso cada plan sólo lista lo que AGREGA:
 * "Todo lo del Básico" y "Todo lo del Negocio" hacen el resto. Repetir en
 * Profesional algo que Negocio ya da no es sólo ruido — es el lugar donde las
 * dos listas se desincronizan cuando alguien mueve una feature de escalón.
 *
 * QUÉ SE MOVIÓ (pedido del dueño del producto): el bot de WhatsApp bajó de
 * Profesional a Negocio, y la facturación ARCA subió de Negocio a Profesional.
 * Vale tener presente la consecuencia comercial, porque no es chica en este
 * mercado: emitir factura es obligatorio para buena parte de los comercios
 * argentinos, así que ARCA en Profesional significa que un local que necesita
 * facturar arranca en el plan de arriba.
 *
 * Y SE FUE INSTAGRAM. Decía "Bot de WhatsApp e Instagram" y el bot de Instagram
 * no existe: el ciclo del bot (2026-08-29) construyó WhatsApp y dejó Instagram
 * explícitamente para más adelante. Es la misma regla que este rediseño aplicó
 * en el Hero y en el Cierre — la página no promete lo que el producto todavía
 * no hace.
 */
export const PLANES: Plan[] = [
  {
    nombre: 'Básico',
    precio: '24.900',
    periodo: 'por mes, IVA incluido',
    detalle: 'El local chico.',
    incluye: ['3 usuarios', '1 sucursal', 'Ventas, stock y caja', 'Catálogo público'],
    accion: 'Probar 5 días',
  },
  {
    nombre: 'Negocio',
    precio: '44.900',
    periodo: 'por mes, IVA incluido',
    detalle: 'El local con equipo.',
    incluye: ['5 usuarios', '1 sucursal', 'Todo lo del Básico', 'Bot de WhatsApp', 'Reportes'],
    accion: 'Probar 5 días',
  },
  {
    nombre: 'Profesional',
    precio: '79.900',
    periodo: 'por mes, IVA incluido',
    detalle: 'El más elegido.',
    incluye: [
      '15 usuarios',
      '3 sucursales',
      'Todo lo del Negocio',
      'Facturación ARCA',
      'Seguimiento de ventas frías',
      'Pedido de reseñas',
    ],
    accion: 'Probar 5 días',
    destacado: true,
  },
  {
    nombre: 'Premium',
    precio: null,
    textoSinPrecio: 'A medida',
    periodo: 'hablemos',
    detalle: 'Infraestructura dedicada.',
    incluye: ['Usuarios ilimitados', 'Sucursales ilimitadas', 'VPC propia', 'Soporte prioritario'],
    accion: 'Hablemos',
  },
]

