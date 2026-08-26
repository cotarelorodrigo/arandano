import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Puro sobre el FUENTE, igual que el resto de los tests de acciones de esta
 * pantalla: un server action no se puede invocar fuera de un request, y lo que
 * hay que fijar acá es el CONTRATO —quién puede, y que cada acción revalide—,
 * no el efecto, que ya cubre test/categorias.test.ts contra la base.
 */
const FUENTE = readFileSync(new URL('./acciones.ts', import.meta.url), 'utf8')

describe('las acciones del árbol de categorías', () => {
  const ACCIONES = [
    'crearCategoriaAccion',
    'renombrarCategoriaAccion',
    'moverCategoriaAccion',
    'borrarCategoriaAccion',
  ]

  it('las cuatro existen y son server actions', () => {
    for (const accion of ACCIONES) {
      expect(FUENTE).toContain(`export async function ${accion}`)
    }
  })

  /**
   * El ABM del árbol pasa a ser delegable: un dueño puede dárselo a un
   * empleado. Que el panel no le dibuje los controles no alcanza — un server
   * action es un endpoint y se puede llamar sin pasar por la pantalla.
   */
  it('las cuatro exigen el permiso CATEGORIAS, no sólo sesión', () => {
    for (const accion of ACCIONES) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no pide CATEGORIAS`).toContain("comoPuede('CATEGORIAS'")
      expect(hastaLaSiguiente, `${accion} usa conSesion pelado`).not.toContain('conSesion(')
    }
  })

  // Sin revalidar, el panel sigue mostrando el árbol viejo después de crear o
  // borrar una rama: la pantalla es un Server Component cacheado.
  it('las cuatro revalidan /inventario', () => {
    for (const accion of ACCIONES) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no revalida`).toContain("revalidatePath('/inventario')")
    }
  })

  // Los cinco códigos del ABM son de dominio y la persona puede actuar sobre
  // ellos —cambiar el nombre, mover los artículos—, así que tienen que llegar
  // como cartel y no como 500. `traducir` sólo deja pasar ErrorDeInventario.
  it('los errores del ABM salen por el traductor que ya existe', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function crearCategoriaAccion'))
    expect(cuerpo).toContain('traducir(e)')
  })
})
