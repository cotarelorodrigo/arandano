// Puro: importa sólo las funciones exportadas de page.tsx, nunca el
// componente en sí — es un Server Component async que abre sesión y consulta
// Prisma (mismo criterio que app/(app)/ventas/page.test.tsx, que documenta
// el porqué con más detalle). La única excepción es el bloque final, que lee
// el FUENTE como texto (mismo criterio que app/(app)/vender/caja.test.tsx)
// para cablear una regresión concreta que ningún test puro puede atrapar.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  seOfreceAnular, cotizacionVisible, subtituloDeItem, filasDeResumen, notaDeAnulacion,
} from './page'
import { CONSUMIDOR_FINAL } from '@/lib/ventas/medios'

describe('seOfreceAnular', () => {
  it('con el permiso, se ofrece anular una venta cobrada', () => {
    expect(seOfreceAnular(true, null)).toBe(true)
  })

  it('sin el permiso no se ofrece el botón, sin importar el estado de la venta', () => {
    expect(seOfreceAnular(false, null)).toBe(false)
  })

  it('nadie anula una venta ya anulada, ni con el permiso', () => {
    expect(seOfreceAnular(true, new Date())).toBe(false)
  })
})

describe('cotizacionVisible', () => {
  it('un pago en pesos no tiene cotización que mostrar', () => {
    expect(cotizacionVisible({ moneda: 'ARS', cotizacion: '1' })).toBe('—')
  })

  it('un pago en dólares muestra la cotización con la que se tomó', () => {
    const salida = cotizacionVisible({ moneda: 'USD', cotizacion: '1485' })
    expect(salida).toContain('1.485,00')
  })
})

describe('subtituloDeItem', () => {
  it('un producto muestra su SKU', () => {
    expect(subtituloDeItem({ sku: '000412', tipo: 'PRODUCTO' })).toBe('SKU 000412')
  })

  it('un servicio no tiene SKU de stock: dice "Servicio"', () => {
    expect(subtituloDeItem({ sku: '999999', tipo: 'SERVICIO' })).toBe('Servicio')
  })
})

describe('filasDeResumen', () => {
  it('arma fecha, vendió, cliente y comprobante (estado va aparte, en ChipEstado)', () => {
    // 20:28 UTC son las 17:28 en Buenos Aires (UTC-3) — no coinciden con el
    // ejemplo del relevamiento a propósito, para no depender de que alguien
    // reafirme el mismo número dos veces sin mirar el huso.
    const filas = filasDeResumen({
      creadoEn: new Date('2026-08-21T20:28:00Z'),
      usuario: { nombre: 'Florencia Díaz' },
      cliente: null,
    })
    expect(filas.vendio).toBe('Florencia Díaz')
    expect(filas.cliente).toBe(CONSUMIDOR_FINAL)
    expect(filas.comprobante).toBe('Sin factura ARCA')
    expect(filas.fecha).toBe('21/08/2026 · 17:28')
  })

  it('con cliente identificado, muestra su nombre y no "Consumidor final"', () => {
    const filas = filasDeResumen({
      creadoEn: new Date(),
      usuario: { nombre: 'Alguien' },
      cliente: { nombre: 'Martín Sosa' },
    })
    expect(filas.cliente).toBe('Martín Sosa')
  })
})

describe('notaDeAnulacion', () => {
  it('dice quién y cuándo', () => {
    const texto = notaDeAnulacion({
      anuladaEn: new Date('2026-08-20T15:00:00Z'),
      anuladaPor: { nombre: 'Rodrigo Cotarelo' },
    })
    expect(texto).toMatch(/^Anulada el/)
    expect(texto).toContain('Rodrigo Cotarelo')
    expect(texto.endsWith('.')).toBe(true)
  })

  it('sin anuladaPor no inventa un nombre: sólo dice la fecha', () => {
    const texto = notaDeAnulacion({
      anuladaEn: new Date('2026-08-20T15:00:00Z'),
      anuladaPor: null,
    })
    expect(texto).toMatch(/^Anulada el/)
    expect(texto).not.toContain(' por ')
  })
})

// Regresión concreta que motivó este bloque (hallazgo Critical de la review
// final del rediseño): un diff anterior sacó `anuladaPor` del `select` y
// borró el bloque que lo mostraba, y NADA lo notó — sólo quedó un chip que
// dice QUE la venta está anulada, no quién ni cuándo. `notaDeAnulacion` de
// arriba prueba el TEXTO; esto prueba que la pantalla todavía lo PIDE y lo
// MUESTRA. Leer el fuente como texto es el mismo criterio que ya usa
// app/(app)/vender/caja.test.tsx para cablear algo que ni jsdom ni una
// sesión real de este repo pueden ejercitar.
describe('el dato de quién anuló no se vuelve a perder', () => {
  const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')

  it('el select sigue pidiendo anuladaPor', () => {
    expect(fuente).toContain('anuladaPor: { select: { nombre: true } }')
  })

  it('la pantalla llama a notaDeAnulacion con el dato real de la venta', () => {
    expect(fuente).toContain(
      'notaDeAnulacion({ anuladaEn: venta.anuladaEn, anuladaPor: venta.anuladaPor })',
    )
  })

  it('esa nota vive dentro de un <Alert>, que es lo que emite role="alert"', () => {
    // Un <Badge> —como el chip de Estado— no emite ningún role: por eso la
    // nota tiene que estar en un <Alert> y no en un <span> suelto. Sin
    // parsear JSX: alcanza con que el `<Alert` más cercano aparezca ANTES
    // que la llamada, dentro de la misma rama condicional. `lastIndexOf` y
    // no `indexOf` para ubicar la LLAMADA: la primera aparición de
    // "notaDeAnulacion(" en el archivo es la propia declaración de la
    // función (`export function notaDeAnulacion(`), no el sitio donde se usa.
    const posLlamada = fuente.lastIndexOf('notaDeAnulacion(')
    const posDeclaracion = fuente.indexOf('notaDeAnulacion(')
    expect(posLlamada).toBeGreaterThan(posDeclaracion)
    const posAlert = fuente.lastIndexOf('<Alert', posLlamada)
    expect(posAlert).toBeGreaterThan(-1)
  })
})
