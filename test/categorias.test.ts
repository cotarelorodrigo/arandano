import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'
import { ErrorDeInventario } from '@/lib/inventario/errores'

// Import dinámico de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool al importarse, leyendo DATABASE_URL, que no está seteada globalmente.
let arbolDeCategorias: typeof import('@/lib/inventario/categorias').arbolDeCategorias
let cuentaSinCategoria: typeof import('@/lib/inventario/categorias').cuentaSinCategoria
let crearCategoria: typeof import('@/lib/inventario/categorias').crearCategoria
let renombrarCategoria: typeof import('@/lib/inventario/categorias').renombrarCategoria
let moverCategoria: typeof import('@/lib/inventario/categorias').moverCategoria
let borrarCategoria: typeof import('@/lib/inventario/categorias').borrarCategoria
let crearArticulo: typeof import('@/lib/inventario/articulos').crearArticulo
let desactivarArticulo: typeof import('@/lib/inventario/articulos').desactivarArticulo

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
let otroTenantId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({
    arbolDeCategorias, cuentaSinCategoria, crearCategoria,
    renombrarCategoria, moverCategoria, borrarCategoria,
  } = await import('@/lib/inventario/categorias'))
  ;({ crearArticulo, desactivarArticulo } = await import('@/lib/inventario/articulos'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'arbol-uno')
  usuarioId = await crearUsuario(owner, tenantId, 'duenio@arbol.test')
  otroTenantId = await crearTenant(owner, 'arbol-dos')
})

afterAll(async () => {
  await owner.end()
})

const alta = (nombre: string, categoria: string | null) =>
  crearArticulo({ tenantId, usuarioId, nombre, tipo: 'PRODUCTO', precio: d('1000'), categoria })

describe('arbolDeCategorias', () => {
  beforeAll(async () => {
    await alta('Funda A52', 'Fundas · Samsung')
    await alta('Funda A54', 'Fundas · Samsung')
    await alta('Funda iPhone', 'Fundas · Apple')
    // Colgado del RUBRO, sin marca: tiene que sumar al total de Fundas igual.
    await alta('Funda genérica', 'Fundas')
    await alta('Cable USB-C', 'Cables')
    await alta('Sin clasificar', null)
    // Del otro tenant, con el mismo nombre de rubro.
    await crearArticulo({
      tenantId: otroTenantId,
      usuarioId: await crearUsuario(owner, otroTenantId, 'duenio@arbol-dos.test'),
      nombre: 'Funda del vecino', tipo: 'PRODUCTO', precio: d('1000'),
      categoria: 'Fundas · Samsung',
    })
  })

  it('devuelve los rubros en orden alfabético con sus marcas', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(arbol.map((r) => r.nombre)).toEqual(['Cables', 'Fundas'])
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    expect(fundas.hijas.map((h) => h.nombre)).toEqual(['Apple', 'Samsung'])
  })

  /**
   * La regla que más fácil se implementa mal: si el número del rubro no incluye
   * a sus marcas, no cierra con la suma de abajo y el árbol miente.
   */
  it('el conteo de un rubro suma sus marcas MÁS lo colgado del rubro', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    // 2 Samsung + 1 Apple + 1 colgada del rubro = 4
    expect(fundas.cuenta).toBe(4)
    expect(fundas.hijas.find((h) => h.nombre === 'Samsung')!.cuenta).toBe(2)
    expect(fundas.hijas.find((h) => h.nombre === 'Apple')!.cuenta).toBe(1)
  })

  it('un rubro sin marcas trae la lista vacía, no undefined', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(arbol.find((r) => r.nombre === 'Cables')!.hijas).toEqual([])
  })

  it('no incluye el árbol de otro tenant', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    // El vecino tiene su propia "Fundas · Samsung" con un artículo: si se
    // colara, Samsung contaría 3 en vez de 2.
    expect(fundas.hijas.find((h) => h.nombre === 'Samsung')!.cuenta).toBe(2)
  })

  it('cuenta los artículos sin categoría aparte', async () => {
    expect(await cuentaSinCategoria(tenantId, { verInactivos: false })).toBe(1)
  })

  // Un artículo desactivado no se cuenta salvo que se pidan los inactivos:
  // mismo criterio que el listado, así el número del árbol cierra con lo que
  // la tabla de al lado muestra.
  it('respeta activos/desactivados, igual que el listado', async () => {
    const a = await alta('Cable que se desactiva', 'Cables')
    const antes = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(antes.find((r) => r.nombre === 'Cables')!.cuenta).toBe(2)

    await desactivarArticulo({ tenantId, articuloId: a.id })

    const activos = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(activos.find((r) => r.nombre === 'Cables')!.cuenta).toBe(1)
    const todos = await arbolDeCategorias(tenantId, { verInactivos: true })
    expect(todos.find((r) => r.nombre === 'Cables')!.cuenta).toBe(2)
  })

  // Una categoría recién creada y todavía vacía tiene que aparecer: si no, el
  // dueño la crea desde el panel y no la ve hasta cargarle un artículo.
  it('una categoría sin artículos aparece con cuenta 0', async () => {
    await crearCategoria({ tenantId, nombre: 'Cargadores', padreId: null })
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(arbol.find((r) => r.nombre === 'Cargadores')!.cuenta).toBe(0)
  })
})

describe('el ABM del árbol', () => {
  it('crea un rubro y una marca adentro', async () => {
    const rubro = await crearCategoria({ tenantId, nombre: 'Auriculares', padreId: null })
    const marca = await crearCategoria({ tenantId, nombre: 'Xiaomi', padreId: rubro.id })
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const auriculares = arbol.find((r) => r.nombre === 'Auriculares')!
    expect(auriculares.hijas.map((h) => h.nombre)).toEqual(['Xiaomi'])
    expect(marca.id).toBeTruthy()
  })

  it('rechaza el nombre vacío', async () => {
    await expect(
      crearCategoria({ tenantId, nombre: '   ', padreId: null }),
    ).rejects.toMatchObject({ codigo: 'NOMBRE_VACIO' })
  })

  it('rechaza un rubro repetido', async () => {
    await expect(
      crearCategoria({ tenantId, nombre: 'Cables', padreId: null }),
    ).rejects.toMatchObject({ codigo: 'CATEGORIA_REPETIDA' })
  })

  it('rechaza una marca repetida bajo el mismo rubro', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    await expect(
      crearCategoria({ tenantId, nombre: 'Samsung', padreId: fundas.id }),
    ).rejects.toMatchObject({ codigo: 'CATEGORIA_REPETIDA' })
  })

  // ...pero la misma marca bajo otro rubro sí entra: son categorías distintas.
  it('deja la misma marca bajo dos rubros', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const cables = arbol.find((r) => r.nombre === 'Cables')!
    const creada = await crearCategoria({ tenantId, nombre: 'Samsung', padreId: cables.id })
    expect(creada.id).toBeTruthy()
  })

  it('renombra', async () => {
    const c = await crearCategoria({ tenantId, nombre: 'Con typo', padreId: null })
    await renombrarCategoria({ tenantId, categoriaId: c.id, nombre: 'Sin typo' })
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(arbol.some((r) => r.nombre === 'Sin typo')).toBe(true)
    expect(arbol.some((r) => r.nombre === 'Con typo')).toBe(false)
  })

  it('mueve una marca de rubro', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    const cables = arbol.find((r) => r.nombre === 'Cables')!
    const apple = fundas.hijas.find((h) => h.nombre === 'Apple')!

    await moverCategoria({ tenantId, categoriaId: apple.id, padreId: cables.id })

    const despues = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(despues.find((r) => r.nombre === 'Fundas')!.hijas.map((h) => h.nombre)).not.toContain('Apple')
    expect(despues.find((r) => r.nombre === 'Cables')!.hijas.map((h) => h.nombre)).toContain('Apple')
  })

  /**
   * Mover un RUBRO debajo de otro crearía un tercer nivel, y el modelo tiene
   * dos. Es la validación explícita que el ciclo del modelo dejó pendiente a
   * propósito: recién acá existe un escritor capaz de violarla.
   */
  it('rechaza mover un rubro debajo de otro: sería un tercer nivel', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    const cables = arbol.find((r) => r.nombre === 'Cables')!
    await expect(
      moverCategoria({ tenantId, categoriaId: fundas.id, padreId: cables.id }),
    ).rejects.toMatchObject({ codigo: 'CATEGORIA_ANIDADA' })
  })

  it('borra una categoría vacía', async () => {
    const c = await crearCategoria({ tenantId, nombre: 'Efímera', padreId: null })
    await borrarCategoria({ tenantId, categoriaId: c.id })
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    expect(arbol.some((r) => r.nombre === 'Efímera')).toBe(false)
  })

  it('no borra un rubro con marcas, y lo dice', async () => {
    const arbol = await arbolDeCategorias(tenantId, { verInactivos: false })
    const fundas = arbol.find((r) => r.nombre === 'Fundas')!
    const error = await borrarCategoria({ tenantId, categoriaId: fundas.id }).catch((e) => e)
    expect(error).toBeInstanceOf(ErrorDeInventario)
    expect(error.codigo).toBe('CATEGORIA_CON_HIJAS')
  })

  // El mensaje cuenta los artículos en vez de decir "no se puede": sin el
  // número, el dueño no sabe si mover uno o cuarenta.
  // Autocontenido a propósito: los casos de este describe comparten tenant y se
  // van pisando el árbol entre sí, y con una rama prestada este caso terminaba
  // chocando primero contra el chequeo de hijas —que gana— en vez de contra el
  // de artículos, que es el que quiere probar.
  it('no borra una categoría con artículos, y dice cuántos', async () => {
    const propia = await crearCategoria({ tenantId, nombre: 'Con dos adentro', padreId: null })
    await alta('Uno de los dos', 'Con dos adentro')
    await alta('El otro', 'Con dos adentro')

    const error = await borrarCategoria({ tenantId, categoriaId: propia.id }).catch((e) => e)
    expect(error).toBeInstanceOf(ErrorDeInventario)
    expect(error.codigo).toBe('CATEGORIA_CON_ARTICULOS')
    expect(error.message).toMatch(/\b2\b/)
  })

  // Un artículo DESACTIVADO sigue apuntando a la categoría, así que la FK
  // frenaría el borrado igual: el mensaje tiene que contarlo o diría "0
  // artículos" justo antes de fallar por la base.
  it('cuenta también los artículos desactivados', async () => {
    const propia = await crearCategoria({ tenantId, nombre: 'Con uno de baja', padreId: null })
    const a = await alta('Se da de baja', 'Con uno de baja')
    await desactivarArticulo({ tenantId, articuloId: a.id })

    const error = await borrarCategoria({ tenantId, categoriaId: propia.id }).catch((e) => e)
    expect(error.codigo).toBe('CATEGORIA_CON_ARTICULOS')
    expect(error.message).toMatch(/1 artículo/)
  })

  it('no toca una categoría de otro tenant', async () => {
    const ajena = await crearCategoria({ tenantId: otroTenantId, nombre: 'Ajena', padreId: null })
    await expect(
      renombrarCategoria({ tenantId, categoriaId: ajena.id, nombre: 'Robada' }),
    ).rejects.toMatchObject({ codigo: 'CATEGORIA_INEXISTENTE' })
  })
})
