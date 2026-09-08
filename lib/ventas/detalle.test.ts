import { describe, it, expect } from 'vitest'
import { TOPE_DETALLE, normalizarDetalle } from './detalle'

describe('normalizarDetalle', () => {
  it('devuelve el texto tal cual cuando ya viene limpio', () => {
    expect(normalizarDetalle('Lo retira el hermano el jueves')).toBe(
      'Lo retira el hermano el jueves',
    )
  })

  it('recorta los espacios de los bordes', () => {
    expect(normalizarDetalle('  avisar al 11 5555-1234  ')).toBe('avisar al 11 5555-1234')
  })

  // Las tres formas de "no se anotó nada" tienen que dar el MISMO resultado:
  // `null`, o sea la ausencia del dato. Un `''` guardado sería una tercera
  // respuesta que ninguna pantalla sabe distinguir de las otras dos.
  it('trata vacío, sólo espacios y ausente como la ausencia del dato', () => {
    expect(normalizarDetalle('')).toBeNull()
    expect(normalizarDetalle('   \n  ')).toBeNull()
    expect(normalizarDetalle(undefined)).toBeNull()
    expect(normalizarDetalle(null)).toBeNull()
  })

  it('corta en el tope en vez de rechazar', () => {
    const largo = 'a'.repeat(TOPE_DETALLE + 50)
    expect(normalizarDetalle(largo)).toHaveLength(TOPE_DETALLE)
  })

  // El corte puede caer justo sobre un espacio, y un detalle que termina en
  // espacio es exactamente lo que el trim de arriba existe para evitar.
  it('el corte no deja un espacio colgando al final', () => {
    const texto = `${'a'.repeat(TOPE_DETALLE - 1)} bcdef`
    const salida = normalizarDetalle(texto)
    expect(salida).toBe('a'.repeat(TOPE_DETALLE - 1))
    expect(salida).not.toMatch(/\s$/)
  })

  // El multilínea se conserva: el control de las dos pantallas es un
  // <textarea>, así que los saltos son parte de lo que la persona escribió.
  it('conserva los saltos de línea internos', () => {
    expect(normalizarDetalle('Retira Ana\nMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
  })

  // Los dos escritores no llegan con el mismo salto de línea: `/vender`
  // postea vía FormData, cuya construcción normaliza a CRLF, y la ficha manda
  // un string de JS por el argumento del server action, que queda en LF. Sin
  // esta normalización la MISMA nota tipeada se guarda distinto según qué
  // pantalla la escribió — y un CRLF cerca del tope corta un carácter de más
  // contra lo que el `maxLength` del cliente prometía, porque ahí un salto
  // ocupa dos.
  it('normaliza CRLF y CR sueltos a LF, para que los dos escritores coincidan', () => {
    expect(normalizarDetalle('Retira Ana\r\nMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
    expect(normalizarDetalle('Retira Ana\rMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
  })

  it('el tope es 500', () => {
    expect(TOPE_DETALLE).toBe(500)
  })
})

describe('el módulo', () => {
  // La condición que deja importar TOPE_DETALLE desde un archivo 'use client'
  // sin arrastrar `pg` al bundle del navegador. Lo vigila también
  // test/limite-cliente-servidor.test.ts, pero acá falla al lado de la causa.
  it('no importa nada, para poder viajar al bundle del cliente', async () => {
    const { readFileSync } = await import('node:fs')
    const fuente = readFileSync(new URL('./detalle.ts', import.meta.url), 'utf8')
    expect(fuente).not.toMatch(/^\s*import\s/m)
  })
})
