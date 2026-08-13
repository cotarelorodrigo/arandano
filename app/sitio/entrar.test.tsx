import { describe, it, expect } from 'vitest'
import { destinoDeSubdominio } from './entrar'

/**
 * La navegación en sí es del navegador y no se prueba acá; lo que se prueba es
 * la función que decide A DÓNDE ir, que es donde puede haber un bug real: un
 * subdominio con espacios, en mayúsculas, o directamente una URL pegada por
 * alguien que no entendió la pregunta.
 */
describe('destinoDeSubdominio', () => {
  it('arma la dirección del negocio', () => {
    expect(destinoDeSubdominio('flor', 'arandano.app')).toBe('https://flor.arandano.app')
  })

  it('normaliza mayúsculas y espacios', () => {
    expect(destinoDeSubdominio('  Flor  ', 'arandano.app')).toBe('https://flor.arandano.app')
  })

  it('rechaza lo que no es un subdominio válido', () => {
    expect(destinoDeSubdominio('flor.arandano.app', 'arandano.app')).toBeNull()
    expect(destinoDeSubdominio('', 'arandano.app')).toBeNull()
    expect(destinoDeSubdominio('con espacio', 'arandano.app')).toBeNull()
  })

  // Los reservados los rechaza validarSubdominio, y acá no se duplica esa
  // lista: se comprueba que el rechazo llega.
  it('rechaza un subdominio reservado', () => {
    expect(destinoDeSubdominio('admin', 'arandano.app')).toBeNull()
  })
})
