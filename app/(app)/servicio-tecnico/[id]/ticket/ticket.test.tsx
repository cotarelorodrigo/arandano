import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CuerpoDelTicket, type OrdenDelTicket } from './cuerpo'

// renderToStaticMarkup y no @testing-library/react: este repo no tiene jsdom
// ni testing-library (ver app/sitio/formulario.test.tsx), así que las
// aserciones son sobre el HTML como texto y no sobre un DOM montado.

const orden: OrdenDelTicket = {
  numero: 42,
  equipoMarca: 'Samsung',
  equipoModelo: 'A54',
  equipoSerie: '358240051111110',
  claveDesbloqueo: '1234',
  fallaDeclarada: 'no carga',
  accesorios: 'cargador',
  danosVisibles: 'pantalla rayada',
  creadoEn: new Date('2026-08-15T13:00:00Z'),
  cliente: { nombre: 'Juan Pérez', telefono: '1155667788' },
  recibidaPor: { nombre: 'Ana' },
}

const html = (o: OrdenDelTicket) =>
  renderToStaticMarkup(<CuerpoDelTicket orden={o} local="Celulares Flor" />)

describe('el ticket', () => {
  it('imprime las dos copias, rotuladas', () => {
    const markup = html(orden)
    expect(markup).toContain('COPIA CLIENTE')
    expect(markup).toContain('COPIA LOCAL')
  })

  it('la línea de corte va una sola vez, y entre las dos copias', () => {
    // El defecto que esto cierra: la línea vivía adentro de cada copia, entre
    // su encabezado y su cuerpo, así que cortar por la que decía "COPIA LOCAL"
    // le arrancaba el encabezado —el #42 grande— a la copia que queda pegada al
    // equipo en el estante.
    const markup = html(orden)
    expect(markup.match(/cortar acá/g) ?? []).toHaveLength(1)
    expect(markup.indexOf('COPIA CLIENTE')).toBeLessThan(markup.indexOf('cortar acá'))
    expect(markup.indexOf('cortar acá')).toBeLessThan(markup.indexOf('COPIA LOCAL'))
  })

  it('el renglón de firma sale sólo en la copia del local', () => {
    // Depende de un booleano y no de que el rótulo contenga la palabra LOCAL:
    // atado al texto, retocar la redacción del papel le sacaba la firma al
    // local sin que nadie se enterara.
    const markup = html(orden)
    expect(markup.match(/Firma del cliente/g) ?? []).toHaveLength(1)
    expect(markup.indexOf('COPIA LOCAL')).toBeLessThan(markup.indexOf('Firma del cliente'))
  })

  it('el número aparece una vez por copia', () => {
    const apariciones = html(orden).match(/#42/g) ?? []
    expect(apariciones).toHaveLength(2)
  })

  it('NO imprime la clave de desbloqueo, en ninguna de las dos copias', () => {
    // El test que hace que esa decisión no se pueda deshacer sin romper el
    // build. La copia del local queda pegada al equipo en el estante: ahí la
    // clave sería peor que en el bolsillo del cliente.
    expect(html(orden)).not.toContain('1234')
  })

  it('imprime lo que cubre al local en un reclamo', () => {
    const markup = html(orden)
    expect(markup).toContain('pantalla rayada')
    expect(markup).toContain('cargador')
    expect(markup).toContain('358240051111110')
  })

  it('aguanta el equipo que entró sin datos opcionales', () => {
    const pelado = {
      ...orden,
      equipoSerie: null,
      claveDesbloqueo: null,
      accesorios: null,
      danosVisibles: null,
      cliente: { nombre: 'Sin teléfono', telefono: null },
    }
    expect(html(pelado)).toContain('Sin teléfono')
  })
})
