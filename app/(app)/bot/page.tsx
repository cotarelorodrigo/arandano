import { notFound } from 'next/navigation'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { botHabilitadoEn } from '@/lib/bot/habilitado'
import { botDelLocal, numerosDisponibles } from '@/lib/bot/administrar'
import { kapsoConfigurado } from '@/lib/bot/kapso'
import { modeloConfigurado } from '@/lib/bot/agente'
import { respuestasDelMes } from '@/lib/bot/limites'
import { formatearFechaCorta } from '@/lib/formato/mostrar'
import { BotonDeConexion, CuerpoBot, type NumeroOfrecido, type VistaDelBot } from './formularios'

export const dynamic = 'force-dynamic'

export default async function PantallaDelBot() {
  // La pantalla exige el permiso además de cada action: sin esto, un empleado
  // sin BOT vería la información del local y el consumo aunque no pudiera
  // tocar nada. Un DUENO lo tiene sin necesitar fila en usuario_permisos.
  const sesion = await exigirPermiso('BOT')

  // El gate del rollout, y no una segunda capa de permisos: `BOT_HABILITADO_EN`
  // decide en qué LOCALES existe el bot todavía, mientras se prueba en
  // producción con uno solo. Ocultar la pestaña no alcanza — un DUENO tiene el
  // permiso BOT sin fila en `usuario_permisos`, así que tipear /bot lo dejaría
  // entrar igual. Ver lib/bot/habilitado.ts, que también explica por qué la
  // ausencia de la variable habilita a todos.
  //
  // notFound() y no forbidden(): para ese local esta pantalla no existe. Un 403
  // anunciaría que hay algo a lo que vale la pena volver.
  if (!botHabilitadoEn(sesion.subdominio)) notFound()

  const esDuenio = sesion.usuario.rol === 'DUENO'

  const bot = await botDelLocal(sesion.tenant.id)
  const conectado = bot.phoneNumberId !== null

  /**
   * Los números que Kapso reporta, y la razón por la que esta pantalla llama a
   * un tercero al renderizar.
   *
   * Es lo que resuelve el caso de la pestaña cerrada a mitad del onboarding: el
   * dueño vuelve cuando quiera y el número lo está esperando. Y es lo que
   * permite que el redirect de Kapso NO escriba nada — sus query params son
   * texto del navegador, y un `phone_number_id` falseado conectaría el número
   * de otro comercio.
   *
   * Sólo mientras falta conectar, y envuelto para que una caída de Kapso no
   * deje la pantalla en blanco: `scripts/smoke.sh` barre esta ruta contra
   * `arandano-stage`, que no tiene credenciales, y si acá se tira una excepción
   * TODO deploy hace rollback.
   */
  let numeros: NumeroOfrecido[] = []
  if (!conectado && bot.kapsoCustomerId) {
    try {
      numeros = (await numerosDisponibles(sesion.tenant.id)).map((n) => ({
        phoneNumberId: n.phoneNumberId,
        numeroVisible: n.numeroVisible,
      }))
    } catch (e) {
      console.error('[bot] no se pudieron leer los números del local:', e)
    }
  }

  const vista: VistaDelBot = {
    conectado,
    numeroVisible: bot.numeroVisible,
    // Formateado en el servidor: un Date cruza al cliente, pero el formato con
    // huso de Buenos Aires vive de este lado en todo el resto del producto.
    conectadoEn: bot.conectadoEn ? formatearFechaCorta(bot.conectadoEn) : null,
    activo: bot.activo,
    instrucciones: bot.instrucciones,
    respuestasDelMes: conectado ? await respuestasDelMes(sesion.tenant.id) : 0,
    topeMensual: bot.topeMensual,
    esDuenio,
    kapsoListo: kapsoConfigurado(),
    modeloListo: modeloConfigurado(),
    numeros,
  }

  return (
    <>
      <Encabezado
        titulo="Bot de WhatsApp"
        subtitulo={
          conectado
            ? `${bot.numeroVisible ?? 'Conectado'} · ${bot.activo ? 'Contestando' : 'Apagado'}`
            : 'Sin conectar'
        }
        // Un elemento y no una función: pasarle una función como prop a un
        // Client Component es lo que Next rechaza en runtime con el build en
        // verde. Las dos copias llevan la MISMA guarda —`esDuenio` y
        // `kapsoListo`—, que es lo que verifica
        // test/permisos-en-las-dos-copias.test.ts.
        acciones={
          conectado ? undefined : (
            <BotonDeConexion esDuenio={esDuenio} kapsoListo={vista.kapsoListo} />
          )
        }
        controlMovil={
          conectado ? undefined : (
            <BotonDeConexion esDuenio={esDuenio} kapsoListo={vista.kapsoListo} movil />
          )
        }
      />
      <CuerpoBot vista={vista} />
    </>
  )
}
