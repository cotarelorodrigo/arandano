import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { CamposDePlan, TablaDePlanes, SinPlanes, type FilaDePlan } from './formularios'
import { MEDIOS } from '@/lib/ventas/medios'

const PLAN: FilaDePlan = {
  id: '00000000-0000-4000-8000-000000000001',
  nombre: 'Crédito 3 cuotas',
  rotuloMedio: 'Crédito',
  cuotas: 3,
  porcentaje: '40',
  porcentajeMostrado: '+40%',
  orden: 3,
  ejemplo: '$ 14.000,00',
  desactivado: false,
}

/**
 * Los campos se prueban SUELTOS y no adentro del diálogo, con el mismo motivo
 * que `FilasDePermisos` en `/usuarios`: `DialogContent` (Radix) sólo se monta
 * cuando el diálogo está abierto, así que renderizar el diálogo cerrado nunca
 * vería estos campos y el test daría un falso negativo en vez de un bug real.
 */
describe('CamposDePlan', () => {
  it('el alta pide nombre, medio, cuotas y recargo', () => {
    const html = renderToStaticMarkup(<CamposDePlan pendiente={false} />)
    for (const campo of ['nombre', 'medio', 'cuotas', 'porcentaje']) {
      expect(html, `falta el campo ${campo}`).toContain(`name="${campo}"`)
    }
  })

  // El orden sale de las cuotas en el alta: un campo más para confirmar ese
  // default sería una pregunta sin respuesta interesante.
  it('el alta no pide el orden', () => {
    const html = renderToStaticMarkup(<CamposDePlan pendiente={false} />)
    expect(html).not.toContain('name="orden"')
  })

  /**
   * Los ítems del `Select` no salen en el HTML estático: Radix los monta en un
   * DocumentFragment aparte mientras el desplegable está cerrado, así que el
   * render no los ve. Lo que sí se puede fijar —y es lo que importa— es que la
   * lista salga de `lib/ventas/medios.ts` y no de cuatro `<SelectItem>`
   * escritos a mano, que es lo que se desincronizaría del enum del schema.
   */
  it('los medios que ofrece salen del catálogo, no de una lista a mano', () => {
    const fuente = readFileSync('app/(app)/formas-de-pago/formularios.tsx', 'utf8')
    expect(fuente).toContain('MEDIOS.map')
    expect(fuente).toContain('ROTULO_MEDIO[m]')
    for (const m of MEDIOS) {
      expect(fuente, `${m} escrito a mano en el JSX`).not.toContain(`value="${m}"`)
    }
  })

  /**
   * El medio NO se edita: cambiarlo dejaría las ventas viejas apuntando a un
   * plan que ya no describe cómo se cobraron. La pantalla lo muestra y explica
   * cuál es la salida, en vez de ofrecer un control que el servidor ignora.
   */
  it('la edición muestra el medio pero no lo deja cambiar', () => {
    const html = renderToStaticMarkup(<CamposDePlan plan={PLAN} pendiente={false} />)
    expect(html).toContain('Crédito')
    expect(html).not.toContain('name="medio"')
    expect(html).toContain('dale de baja')
  })

  it('la edición sí deja tocar el orden, y llega el id del plan', () => {
    const html = renderToStaticMarkup(<CamposDePlan plan={PLAN} pendiente={false} />)
    expect(html).toContain('name="orden"')
    expect(html).toContain(`value="${PLAN.id}"`)
  })

  /**
   * El campo se rellena con el porcentaje CRUDO y no con el formateado: un
   * `+40 %` no vuelve a parsear, así que guardar sin tocar nada rompería.
   */
  it('la edición rellena el recargo con el número tal como está guardado', () => {
    const html = renderToStaticMarkup(<CamposDePlan plan={PLAN} pendiente={false} />)
    expect(html).toContain('value="40"')
    expect(html).not.toContain('value="+40%"')
  })

  // El signo es la mitad del sentido del campo, y no se deduce de un rótulo
  // que dice "Cuánto recarga".
  it('dice que un número negativo es un descuento', () => {
    const html = renderToStaticMarkup(<CamposDePlan pendiente={false} />)
    expect(html).toContain('descuento')
  })

  it('con la acción en curso, los campos quedan deshabilitados', () => {
    const html = renderToStaticMarkup(<CamposDePlan pendiente={true} />)
    expect(html).toContain('disabled')
  })
})

describe('TablaDePlanes', () => {
  const render = (planes: FilaDePlan[]) =>
    renderToStaticMarkup(<TablaDePlanes planes={planes} ejemploBase="$ 10.000,00" />)

  it('muestra el porcentaje ya formateado y el ejemplo derivado', () => {
    const html = render([PLAN])
    expect(html).toContain('+40%')
    expect(html).toContain('14.000')
  })

  // Un plan dado de baja sigue en la tabla —hay que poder reactivarlo— pero
  // tiene que decir que hoy no se ofrece: si no, se lee como uno activo más.
  it('un plan dado de baja lo dice, y ofrece reactivarlo en vez de editarlo', () => {
    const html = render([{ ...PLAN, desactivado: true }])
    expect(html).toContain('Dado de baja')
    expect(html).toContain('Reactivar')
    expect(html).not.toContain('>Baja<')
  })

  it('un plan activo ofrece editarlo y darlo de baja', () => {
    const html = render([PLAN])
    expect(html).toContain('Editar')
    expect(html).toContain('Baja')
    expect(html).not.toContain('Reactivar')
  })

  // El encabezado de la columna nombra el artículo de referencia: sin eso, la
  // columna muestra un precio y no dice de qué.
  it('el encabezado del ejemplo nombra el artículo de referencia', () => {
    expect(render([PLAN])).toContain('$ 10.000,00')
  })
})

describe('SinPlanes', () => {
  // Un local que nunca cargue un plan es un caso válido y completo, no un
  // estado a medio configurar: el vacío tiene que explicar qué está pasando.
  it('explica que sin planes todo se cobra a precio de lista', () => {
    const html = renderToStaticMarkup(<SinPlanes />)
    expect(html).toContain('precio de lista')
  })
})

/**
 * Las tres reglas de los toasts que este repo ya pagó dos veces (ABM de
 * categorías y diálogo de permisos), sobre el fuente: son de RUNTIME y ningún
 * render estático las ve. Lo que se mide es lo que hizo desaparecer los avisos
 * la primera vez.
 */
describe('los avisos por toast', () => {
  const CRUDO = readFileSync('app/(app)/formas-de-pago/formularios.tsx', 'utf8')
  // Sin comentarios: los JSDoc de este archivo NOMBRAN a `useEffect` y al
  // `<Toaster>` para explicar por qué no están, así que un `not.toContain`
  // sobre el fuente crudo fallaría por la explicación en vez de por el código.
  const FUENTE = CRUDO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  // Un efecto está atado al ciclo de vida del componente, y las filas se
  // desmontan con cada revalidatePath: el aviso moría antes de poder leerse.
  it('no se lanzan desde un useEffect', () => {
    expect(FUENTE).not.toContain('useEffect')
    expect(FUENTE).not.toContain('useActionState')
  })

  // Un error es accionable —dice qué corregir antes de reintentar— y uno que
  // se va solo a los cuatro segundos se lleva justamente la instrucción.
  it('los errores no se auto-descartan y los avisos de éxito sí', () => {
    expect(CRUDO).toContain('toast.error(resultado.error, { id: clave, duration: Infinity })')
    expect(CRUDO).toContain('toast.success(resultado.aviso, { id: clave })')
  })

  // Sin clave estable, sonner apila una copia por cada vez que se toca el
  // mismo control.
  it('cada toast lleva clave estable por acción y por plan', () => {
    expect(CRUDO).toContain('`plan-${plan.id}-${sufijo}`')
    expect(CRUDO).toContain('`plan-${plan.id}-edicion`')
  })

  // Que el Toaster viva sólo en el root layout no se comprueba acá: lo cubre
  // test/toaster.test.ts para TODO app/, que es el alcance correcto — un
  // segundo caso local sería una copia que se desincroniza.
})
