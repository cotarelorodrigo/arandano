import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermisosDeUsuario, FilasDePermisos } from './permisos-dialogo'
import { PERMISOS } from '@/lib/permisos/catalogo'

const EMPLEADA = {
  id: 'u1', nombre: 'Ana', email: 'ana@local.test',
  rol: 'EMPLEADO' as const, desactivadoEn: null,
}

describe('el diálogo de permisos', () => {
  // Salen del catálogo y no de una lista escrita a mano al lado: si
  // se escribieran dos veces, agregar un permiso dejaría la pantalla vieja.
  //
  // Contra `FilasDePermisos` y no contra `PermisosDeUsuario`: `DialogContent`
  // (Radix) sólo se monta con el diálogo abierto —lo resuelve `Presence`
  // mirando `context.open`—, así que un `renderToStaticMarkup` del diálogo
  // CERRADO (el estado inicial, y el único que este test puede producir sin
  // jsdom) nunca ve las filas. Forzar el montaje con `forceMount` se probó y
  // se descartó: ver el JSDoc de `FilasDePermisos` en `permisos-dialogo.tsx`.
  it('ofrece todos los permisos del catálogo, con su ayuda', () => {
    const html = renderToStaticMarkup(
      <FilasDePermisos usuarioId="u1" otorgados={new Set()} enCurso={false} onCambiar={() => {}} />,
    )
    for (const p of PERMISOS) {
      expect(html, `falta ${p.clave}`).toContain(p.nombre)
      expect(html, `falta la ayuda de ${p.clave}`).toContain(p.ayuda)
    }
    // M5 de la review final: lo de arriba prueba que ESTÁN todos, no que
    // sean los ÚNICOS — un switch de más, escrito a mano al lado de los del
    // catálogo, pasaba este test igual. El spec pide las dos direcciones
    // (catálogo ↔ pantalla), así que el conteo de `role="switch"` (el que
    // renderiza `SwitchPrimitive.Root` de Radix) tiene que cerrar exacto
    // contra `PERMISOS.length`.
    const cantidadDeSwitches = html.split('role="switch"').length - 1
    expect(cantidadDeSwitches).toBe(PERMISOS.length)
  })

  it('muestra el conteo de los otorgados', () => {
    const html = renderToStaticMarkup(
      <PermisosDeUsuario usuario={EMPLEADA} permisos={['COSTOS', 'CATEGORIAS']} />,
    )
    // El total sale de `PERMISOS.length` y no de un número escrito acá: el
    // catálogo crece de ciclo en ciclo (siete desde que existe PLANES_PAGO) y
    // un literal deja este caso fallando por el conteo en vez de por el
    // comportamiento que prueba.
    expect(html).toContain(`2 de ${PERMISOS.length} permisos`)
  })

  it('sin ninguno, lo dice en vez de mostrar un cero', () => {
    const html = renderToStaticMarkup(<PermisosDeUsuario usuario={EMPLEADA} permisos={[]} />)
    expect(html).toContain('Sin permisos')
  })
})
