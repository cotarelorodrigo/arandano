import { describe, it, expect } from 'vitest'
import {
  ESTADOS,
  TRANSICIONES,
  puedeTransicionar,
  ABIERTOS,
  NOMBRE_ESTADO,
} from './estados'

describe('el grafo de estados de una orden', () => {
  it('los nueve estados tienen fila en la tabla de transiciones', () => {
    expect(ESTADOS).toHaveLength(9)
    for (const e of ESTADOS) {
      expect(TRANSICIONES[e], `${e} no tiene fila`).toBeDefined()
    }
  })

  it('ningún estado transiciona a sí mismo', () => {
    // No es cosmético: la anulación se distingue de una transición porque
    // ninguna transición legal deja desde === hasta.
    for (const e of ESTADOS) {
      expect(TRANSICIONES[e], `${e} transiciona a sí mismo`).not.toContain(e)
    }
  })

  it('desde todo estado se llega a ENTREGADO', () => {
    // El test que atrapa el callejón sin salida: si alguien agrega un estado
    // nuevo del que no se puede salir, el equipo queda atrapado en el tablero
    // para siempre y nadie lo nota hasta que pasa con un equipo de verdad.
    for (const inicio of ESTADOS) {
      const vistos = new Set([inicio])
      const cola = [inicio]
      let llega = inicio === 'ENTREGADO'
      while (cola.length > 0 && !llega) {
        for (const siguiente of TRANSICIONES[cola.shift()!]) {
          if (siguiente === 'ENTREGADO') llega = true
          if (!vistos.has(siguiente)) {
            vistos.add(siguiente)
            cola.push(siguiente)
          }
        }
      }
      expect(llega, `desde ${inicio} no se llega a ENTREGADO`).toBe(true)
    }
  })

  it('acepta las transiciones del mostrador', () => {
    expect(puedeTransicionar('RECIBIDO', 'EN_DIAGNOSTICO')).toBe(true)
    // El equipo que se sabe qué tiene no necesita diagnosticarse.
    expect(puedeTransicionar('RECIBIDO', 'EN_REPARACION')).toBe(true)
    // Se abrió y apareció algo más: hay que volver a hablar con el cliente.
    expect(puedeTransicionar('EN_REPARACION', 'PRESUPUESTADO')).toBe(true)
    // No quedó bien y vuelve al banco antes de que el cliente lo retire.
    expect(puedeTransicionar('LISTO', 'EN_REPARACION')).toBe(true)
    // La garantía: el equipo entregado que vuelve.
    expect(puedeTransicionar('ENTREGADO', 'EN_REPARACION')).toBe(true)
    // No se arregló, pero el equipo sigue acá hasta que lo vengan a buscar.
    expect(puedeTransicionar('SIN_REPARACION', 'ENTREGADO')).toBe(true)
    expect(puedeTransicionar('RECHAZADO', 'ENTREGADO')).toBe(true)
  })

  it('rechaza los saltos que no existen', () => {
    expect(puedeTransicionar('RECIBIDO', 'LISTO')).toBe(false)
    expect(puedeTransicionar('RECIBIDO', 'ENTREGADO')).toBe(false)
    expect(puedeTransicionar('ENTREGADO', 'LISTO')).toBe(false)
    expect(puedeTransicionar('SIN_REPARACION', 'EN_REPARACION')).toBe(false)
  })

  // El estado nuevo del ciclo 6 (design/arandano.pen, nodo `p6wbf` del
  // tablero): llena el hueco de que la aprobación del cliente no quedaba
  // registrada en ningún lado — ver CLAUDE.md, decisiones del modelo de datos.
  it('desde PRESUPUESTADO se puede ir a APROBADO', () => {
    expect(puedeTransicionar('PRESUPUESTADO', 'APROBADO')).toBe(true)
  })

  it('desde APROBADO se puede seguir a EN_REPARACION o a SIN_REPARACION', () => {
    expect(puedeTransicionar('APROBADO', 'EN_REPARACION')).toBe(true)
    // Se abrió el equipo con el presupuesto ya aceptado y resultó no tener
    // arreglo — el mismo caso que ya vale para EN_REPARACION → PRESUPUESTADO.
    expect(puedeTransicionar('APROBADO', 'SIN_REPARACION')).toBe(true)
  })

  it('no se puede aprobar sin presupuestar primero', () => {
    // El salto que la maqueta NO muestra: RECIBIDO no tiene botón "Aprobado"
    // en el paño de transiciones, porque no hay nada que el cliente haya
    // aceptado todavía.
    expect(puedeTransicionar('RECIBIDO', 'APROBADO')).toBe(false)
  })

  it('ABIERTOS es todo menos ENTREGADO', () => {
    expect(ABIERTOS).toHaveLength(8)
    expect(ABIERTOS).not.toContain('ENTREGADO')
  })

  it('todo estado tiene nombre para mostrar', () => {
    for (const e of ESTADOS) {
      expect(NOMBRE_ESTADO[e], `${e} no tiene nombre`).toBeTruthy()
      // En castellano y para una persona: el tablero no muestra EN_DIAGNOSTICO.
      expect(NOMBRE_ESTADO[e]).not.toContain('_')
    }
  })

  it('APROBADO se lee "Aprobado" en castellano', () => {
    expect(NOMBRE_ESTADO.APROBADO).toBe('Aprobado')
  })

  // Task 2 del ciclo 6: el tablero pinta sus chips recorriendo ESTADOS
  // directamente, así que el orden de este array pasó a ser el orden visual
  // de la fila de chips. La maqueta (design/arandano.pen, nodo `G5b3dG`)
  // termina esa fila en Entregado, no en su posición "natural" del flujo de
  // trabajo — el relevamiento lo marcaba como divergencia contra el código
  // viejo, y este caso es lo que impide que vuelva sin que nadie lo note.
  it('ENTREGADO es el último del array: así lo dibuja la maqueta del tablero', () => {
    expect(ESTADOS.indexOf('ENTREGADO')).toBe(ESTADOS.length - 1)
  })
})
