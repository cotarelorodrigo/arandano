import {
  Inbox,
  Search,
  FileText,
  ThumbsUp,
  Wrench,
  Check,
  CircleSlash,
  ThumbsDown,
  PackageCheck,
  type LucideIcon,
} from 'lucide-react'
import type { EstadoOrden } from '@/generated/prisma/client'

/**
 * Los nueve estados, en el orden en que la fila de chips del tablero los
 * muestra (design/arandano.pen, nodo `G5b3dG`, consultado en vivo con el MCP
 * de Pencil): Recibido → En diagnóstico → Presupuestado → Aprobado → En
 * reparación → Listo → Sin reparación → Rechazado → Entregado, con
 * ENTREGADO AL FINAL y no en su posición "natural" del flujo de trabajo
 * (después de Listo). El relevamiento de este ciclo lo marcaba como
 * divergencia contra el código viejo ("orden distinto: la maqueta pone
 * Entregado al final"), y la Task 2 la cierra acá, en la fuente que
 * `app/(app)/servicio-tecnico/page.tsx` recorre para pintar los chips — no
 * con un array paralelo sólo para esa pantalla, que hubiera dejado ESTE
 * array (usado también en `TRANSICIONES`, en el guard `esEstado` y en el
 * grafo de alcanzabilidad de estados.test.ts, ninguno de los dos sensible al
 * orden) sin decir la verdad sobre qué ve el tablero.
 */
export const ESTADOS: readonly EstadoOrden[] = [
  'RECIBIDO',
  'EN_DIAGNOSTICO',
  'PRESUPUESTADO',
  'APROBADO',
  'EN_REPARACION',
  'LISTO',
  'SIN_REPARACION',
  'RECHAZADO',
  'ENTREGADO',
]

/**
 * Qué transiciones son legales. Es la fuente de verdad: la pantalla dibuja los
 * botones a partir de esta tabla, pero el server action la vuelve a consultar
 * antes de escribir. Una UI que esconde un botón no es una validación.
 *
 * `SIN_REPARACION` y `RECHAZADO` NO son terminales, y ésa es la decisión que
 * más define el modelo: el equipo sigue en el estante hasta que el cliente lo
 * viene a buscar. El único estado final es ENTREGADO — se entrega arreglado,
 * sin arreglar, o porque el cliente no aceptó el presupuesto. Que se haya
 * entregado sin arreglar sale de la bitácora, que es para lo que existe.
 */
export const TRANSICIONES: Record<EstadoOrden, readonly EstadoOrden[]> = {
  RECIBIDO: ['EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'SIN_REPARACION'],
  EN_DIAGNOSTICO: ['PRESUPUESTADO', 'EN_REPARACION', 'SIN_REPARACION'],
  // A APROBADO: el cliente aceptó el presupuesto. PRESUPUESTADO →
  // EN_REPARACION directo SE MANTIENE a propósito (no se saca): hay locales
  // donde el cliente aprueba en el mostrador y no hace falta el paso extra —
  // ver design/arandano.pen y la nota de "decisiones ya tomadas" del plan de
  // este ciclo. APROBADO es un registro que se PUEDE usar, no uno obligatorio.
  PRESUPUESTADO: ['EN_REPARACION', 'RECHAZADO', 'SIN_REPARACION', 'APROBADO'],
  // El cliente ya dijo que sí: sigue derecho a reparar, o se abre el equipo y
  // aparece que no tiene arreglo.
  APROBADO: ['EN_REPARACION', 'SIN_REPARACION'],
  // A PRESUPUESTADO: se abrió el equipo y apareció algo más.
  EN_REPARACION: ['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'],
  // A EN_REPARACION: no quedó bien, y vuelve al banco antes de que lo retiren.
  LISTO: ['ENTREGADO', 'EN_REPARACION'],
  // A EN_REPARACION: la garantía. Hoy eso es una orden nueva en el cuaderno,
  // que pierde la historia de la anterior.
  ENTREGADO: ['EN_REPARACION'],
  SIN_REPARACION: ['ENTREGADO'],
  RECHAZADO: ['ENTREGADO'],
}

export function puedeTransicionar(desde: EstadoOrden, hasta: EstadoOrden): boolean {
  return TRANSICIONES[desde].includes(hasta)
}

/**
 * Lo que sigue en el local. Es el filtro por defecto del tablero: el equipo
 * entregado ya no es problema de nadie.
 */
export const ABIERTOS: readonly EstadoOrden[] = ESTADOS.filter((e) => e !== 'ENTREGADO')

/** Cómo se lee cada estado en pantalla. Nadie tiene que ver EN_DIAGNOSTICO. */
export const NOMBRE_ESTADO: Record<EstadoOrden, string> = {
  RECIBIDO: 'Recibido',
  EN_DIAGNOSTICO: 'En diagnóstico',
  PRESUPUESTADO: 'Presupuestado',
  APROBADO: 'Aprobado',
  EN_REPARACION: 'En reparación',
  LISTO: 'Listo',
  ENTREGADO: 'Entregado',
  SIN_REPARACION: 'Sin reparación',
  RECHAZADO: 'Rechazado',
}

/**
 * El mapeo estado→ícono→color, en un solo lugar para que el chip del
 * tablero, el chip de la fila y la bitácora de la ficha (ciclo posterior) lean
 * todos de acá y no dupliquen la paleta en tres archivos.
 *
 * Los primeros seis salen tal cual de `design/arandano.pen` (consultado en
 * vivo con el MCP de Pencil, no sólo del relevamiento): `gJNcu` (Recibido),
 * `nzBrY` (En diagnóstico), `CYnvx` (Presupuestado), `Z6e5KX` (Aprobado),
 * `FCfVM` (En reparación) y `XHX97` (Listo), todos en el frame `App / Servicio
 * Técnico`. Ninguno de los tres últimos tiene un chip de fila en la maqueta
 * (relevamiento, §9.2: "no relevado" para Sin reparación, Rechazado y
 * Entregado — ninguna fila de ejemplo cae en esos tres estados), así que acá
 * SÍ es una decisión de este ciclo y no un dato leído:
 * - SIN_REPARACION y RECHAZADO usan `destructive`: los dos cierran la orden
 *   sin una reparación exitosa (el equipo no tiene arreglo, o el cliente no
 *   aceptó el presupuesto), mismo criterio que ya usa el chip "Anulada" de
 *   /ventas para "esto no va a facturarse".
 * - ENTREGADO usa el tratamiento neutro (`muted`/`foreground-soft`) de "ya
 *   resuelto, no exige más atención" — el mismo par que "Desactivado" en
 *   /inventario (chip-estado.tsx). Su ícono (`PackageCheck`) tampoco está en
 *   la maqueta: no hay ninguna fila de ejemplo en ese estado.
 */
export const ESTADO_VISUAL: Record<EstadoOrden, { Icono: LucideIcon; clase: string }> = {
  RECIBIDO: { Icono: Inbox, clase: 'bg-muted text-foreground-soft' },
  EN_DIAGNOSTICO: { Icono: Search, clase: 'bg-muted text-foreground-soft' },
  PRESUPUESTADO: { Icono: FileText, clase: 'bg-accent text-accent-foreground' },
  APROBADO: { Icono: ThumbsUp, clase: 'bg-accent text-accent-foreground' },
  EN_REPARACION: { Icono: Wrench, clase: 'bg-warn-soft text-warn' },
  LISTO: { Icono: Check, clase: 'bg-ok-soft text-ok' },
  SIN_REPARACION: { Icono: CircleSlash, clase: 'bg-destructive-soft text-destructive' },
  RECHAZADO: { Icono: ThumbsDown, clase: 'bg-destructive-soft text-destructive' },
  ENTREGADO: { Icono: PackageCheck, clase: 'bg-muted text-foreground-soft' },
}
