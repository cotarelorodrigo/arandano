import { describe, it, expect } from 'vitest'
import { destinoDeSubdominio } from './entrar'

/**
 * La navegación en sí es del navegador y no se prueba acá; lo que se prueba es
 * la función que decide A DÓNDE ir, que es donde puede haber un bug real: un
 * subdominio con espacios, en mayúsculas, o directamente una URL pegada por
 * alguien que no entendió la pregunta.
 */
const PROD = { protocolo: 'https', dominio: 'arandano.app', puerto: '' }

describe('destinoDeSubdominio', () => {
  it('arma la dirección del negocio', () => {
    expect(destinoDeSubdominio('flor', PROD)).toBe('https://flor.arandano.app')
  })

  it('normaliza mayúsculas y espacios', () => {
    expect(destinoDeSubdominio('  Flor  ', PROD)).toBe('https://flor.arandano.app')
  })

  it('rechaza lo que no es un subdominio válido', () => {
    expect(destinoDeSubdominio('flor.arandano.app', PROD)).toBeNull()
    expect(destinoDeSubdominio('', PROD)).toBeNull()
    expect(destinoDeSubdominio('con espacio', PROD)).toBeNull()
  })

  // Los reservados los rechaza validarSubdominio, y acá no se duplica esa
  // lista: se comprueba que el rechazo llega.
  it('rechaza un subdominio reservado', () => {
    expect(destinoDeSubdominio('admin', PROD)).toBeNull()
  })

  /**
   * El protocolo y el puerto no se cablean.
   *
   * Antes esto devolvía siempre `https://<sub>.<dominio>`, sin puerto. En
   * producción está bien —Caddy sirve 443 y el puerto es implícito—, pero en
   * dev la app se sirve por HTTP en el 3000 y ese link mandaba a una dirección
   * que no existe: el único entorno donde alguien prueba esto a mano era el
   * único donde no funcionaba.
   *
   * Las piezas salen de las mismas que arma `origenDelRequest`
   * (lib/auth/origen.ts): protocolo por lista blanca, dominio de DOMINIO_BASE y
   * puerto de PUERTO_PUBLICO. Dos ideas distintas de cómo se direcciona un
   * tenant serían dos cosas que se desincronizan.
   */
  it('respeta el protocolo y el puerto del entorno', () => {
    expect(
      destinoDeSubdominio('flor', { protocolo: 'http', dominio: 'dev.arandano.app', puerto: ':3000' }),
    ).toBe('http://flor.dev.arandano.app:3000')
  })
})
