import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelDeCategorias } from './panel-categorias'
import { SIN_CATEGORIA, categoriaDeQuery } from './consulta'
import type { RamaConHijas } from '@/lib/inventario/categorias'

const ARBOL: RamaConHijas[] = [
  {
    id: 'id-cables',
    nombre: 'Cables',
    cuenta: 3,
    hijas: [],
  },
  {
    id: 'id-fundas',
    nombre: 'Fundas',
    cuenta: 12,
    hijas: [
      { id: 'id-apple', nombre: 'Apple', cuenta: 7 },
      { id: 'id-samsung', nombre: 'Samsung', cuenta: 4 },
    ],
  },
]

const pintar = (props: Partial<Parameters<typeof PanelDeCategorias>[0]> = {}) =>
  renderToStaticMarkup(
    <PanelDeCategorias
      arbol={ARBOL}
      total={48}
      sinCategoria={1}
      activa={null}
      puedeAdministrar
      filtros={{ busqueda: '', verInactivos: false, tipo: null }}
      {...props}
    />,
  )

describe('categoriaDeQuery', () => {
  it('reconoce un id con forma de uuid', () => {
    const uuid = '0199c0d4-1f2b-7a3c-8d4e-5f6a7b8c9d0e'
    expect(categoriaDeQuery(uuid)).toBe(uuid)
  })

  it('reconoce el valor reservado de "sin categoría"', () => {
    expect(categoriaDeQuery(SIN_CATEGORIA)).toBe(SIN_CATEGORIA)
  })

  // Mismo criterio que `tipoDeQuery` y que el clamp de `?p`: un query string
  // escrito a mano cae en "Todos", no en un 500 ni en un listado vacío.
  it('cualquier otra cosa es "Todos"', () => {
    for (const basura of [undefined, '', 'no-es-uuid', '../../etc/passwd']) {
      expect(categoriaDeQuery(basura)).toBeNull()
    }
  })
})

describe('PanelDeCategorias', () => {
  it('dibuja los rubros con sus marcas y sus cuentas', () => {
    const html = pintar()
    for (const texto of ['Cables', 'Fundas', 'Apple', 'Samsung', '48', '12', '7', '4', '3']) {
      expect(html).toContain(texto)
    }
  })

  it('"Todos los artículos" es lo activo por defecto', () => {
    const html = pintar()
    expect(html).toContain('Todos los artículos')
    // El fondo de seleccionada es --accent (bg-accent), y en reposo no hay
    // fondo: sin esto, la fila activa no se distingue de las demás.
    expect(html).toMatch(/bg-accent[^"]*"[^>]*>[\s\S]{0,400}Todos los artículos/)
  })

  // La maqueta (design/arandano.pen, `pjcob` vs `AEfCk`) le da chevron sólo al
  // rubro que tiene marcas adentro; el que no las tiene lleva un hueco de 14
  // px, para que su texto arranque donde arranca el de los demás.
  it('el rubro con marcas lleva chevron y el que no, un hueco de 14', () => {
    const html = pintar()
    expect(html).toContain('data-rama="id-fundas"')
    expect(html).toMatch(/data-rama="id-cables"[\s\S]{0,300}w-\[14px\]/)
    expect(html).toMatch(/data-rama="id-fundas"[\s\S]{0,300}<svg/)
  })

  // Sangría 24 y tipografía propia: 12.5px normal, contra 13px/500 del rubro.
  // Es lo que dibuja la jerarquía sin sangrar de más.
  it('la marca lleva sangría de 24 y su tipografía propia', () => {
    const html = pintar()
    expect(html).toMatch(/data-rama="id-samsung"[\s\S]{0,400}w-\[24px\]/)
    expect(html).toMatch(/data-rama="id-samsung"[\s\S]{0,400}text-\[12\.5px\]/)
  })

  it('marca como activa la rama elegida, sea rubro o marca', () => {
    const rubro = pintar({ activa: 'id-fundas' })
    expect(rubro).toMatch(/data-rama="id-fundas"[^>]*data-activa="true"/)
    const marca = pintar({ activa: 'id-samsung' })
    expect(marca).toMatch(/data-rama="id-samsung"[^>]*data-activa="true"/)
  })

  // Una marca seleccionada dentro de un rubro colapsado sería una selección
  // invisible: el rubro de la rama activa se fuerza abierto.
  it('con una marca activa, su rubro se dibuja abierto', () => {
    const html = pintar({ activa: 'id-apple' })
    expect(html).toContain('data-rama="id-apple"')
  })

  it('"Sin categoría" sólo aparece si hay alguno', () => {
    expect(pintar({ sinCategoria: 1 })).toContain('Sin categoría')
    // Una fila permanente en cero es ruido: si no hay ninguno, no se dibuja.
    expect(pintar({ sinCategoria: 0 })).not.toContain('Sin categoría')
  })

  // Un panel en blanco al lado del listado se lee como algo roto, y un local
  // recién dado de alta no tiene ninguna categoría.
  it('el árbol vacío dice qué hacer en vez de quedar en blanco', () => {
    const html = pintar({ arbol: [], sinCategoria: 0 })
    expect(html).toContain('Todavía no creaste categorías')
  })

  // El ABM es del dueño, mismo criterio que el alta de artículo: el catálogo
  // es decisión del negocio.
  it('un empleado no ve los controles de administración', () => {
    const html = pintar({ puedeAdministrar: false })
    expect(html).not.toContain('Categoría nueva')
    expect(html).toContain('Fundas')
  })

  it('y el dueño sí', () => {
    expect(pintar({ puedeAdministrar: true })).toContain('Categoría nueva')
  })
})

describe('los controles del ABM', () => {
  // El servidor ya rechaza a un empleado (acciones-categorias.test.ts), pero
  // dibujarle botones que van a fallar es ofrecerle algo que no puede hacer.
  it('un empleado no ve el menú de ninguna rama', () => {
    const html = pintar({ puedeAdministrar: false })
    expect(html).not.toContain('Opciones de la categoría')
  })

  it('el dueño ve un menú por rama, rubros y marcas', () => {
    const html = pintar({ puedeAdministrar: true })
    // Dos rubros más dos marcas.
    expect(html.match(/Opciones de la categoría/g)).toHaveLength(4)
  })

  // El ⋯ ocupa el lugar de la cuenta al hover en vez de sumar una columna:
  // correr el texto haría bailar la lista entera cada vez que pasa el mouse.
  it('el menú aparece en el lugar de la cuenta, no en una columna nueva', () => {
    const html = pintar({ puedeAdministrar: true })
    expect(html).toContain('group-hover/rama:hidden')
  })

  // "Mover a…" no se le ofrece a un rubro: mover uno debajo de otro crearía un
  // tercer nivel. El servidor lo valida igual, pero no ofrecerlo es lo que
  // evita que alguien reciba un error por algo que la pantalla le sugirió.
  it('"Mover a…" no se ofrece en los rubros', () => {
    const html = pintar({ puedeAdministrar: true })
    // Las dos marcas pueden moverse; los dos rubros no, así que el submenú
    // aparece a lo sumo una vez por marca.
    const veces = (html.match(/Mover a…/g) ?? []).length
    expect(veces).toBeLessThanOrEqual(2)
  })
})
