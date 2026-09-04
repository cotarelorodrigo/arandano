import { describe, it, expect } from 'vitest'
import { inicialDe } from './inicial'

describe('la inicial del local', () => {
  it('es la primera letra, en mayúscula', () => {
    expect(inicialDe('Flor Celulares')).toBe('F')
  })

  it('ignora los espacios de los costados', () => {
    expect(inicialDe('  flor  ')).toBe('F')
  })

  // Un emoji acá haría que ImageResponse (emoji: 'twemoji' por default) salga
  // a buscar el glifo a un CDN externo en cada request de un endpoint público.
  // No es "no soportamos emoji": es que no queremos una request saliente por
  // ícono.
  it('rechaza emoji y cae a la marca', () => {
    expect(inicialDe('🍎 Manzana')).toBe('A')
  })

  it('con un nombre vacío cae a la marca', () => {
    expect(inicialDe('   ')).toBe('A')
  })

  it('acepta dígitos', () => {
    expect(inicialDe('24 Horas Celulares')).toBe('2')
  })

  it('rechaza símbolos y cae a la marca', () => {
    expect(inicialDe('·Punto')).toBe('A')
  })

  // Antes del techo de code point (0xFF) este caso era el único que
  // distinguía spread de charAt(0): con charAt(0) el surrogate partido al
  // medio no es \p{L} y cae al fallback igual, así que el resultado no
  // cambia — cualquier letra que necesite un par subrogado vive muy por
  // encima de 0xFF y el techo la ataja antes de llegar a esa comparación. El
  // spread se conserva de todos modos, por prolijidad de la unidad de
  // código: no depender de que el techo sea siempre la primera defensa.
  it('una letra fuera del plano básico cae al fallback (supera 0xFF)', () => {
    expect(inicialDe('𝐀curdia')).toBe('A')
  })

  // \p{L} solo, sin el techo, dejaba pasar cirílico, griego, hebreo, árabe y
  // CJK — y un autoservicio o un locutorio de dueño chino no es un caso
  // hipotético en Argentina. Cualquiera de esos alfabetos vive por encima de
  // 0xFF y cae al fallback antes de pedirle a Satori un glifo que la fuente
  // empaquetada no tiene.
  it('rechaza un nombre en CJK y cae a la marca', () => {
    expect(inicialDe('中文名字')).toBe('A')
  })

  // El caso que impide "simplificar" el rango a ASCII puro: noto-sans-latin
  // cubre Latin-1 completo (hasta U+00FF), así que una ñ tiene que seguir
  // dando su propia inicial y no la de "Nandú" ni el fallback.
  it('acepta ñ, dentro de Latin-1', () => {
    expect(inicialDe('Ñandú Celulares')).toBe('Ñ')
  })
})
