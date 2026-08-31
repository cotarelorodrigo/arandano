'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Bot, Link2, MessageCircle, Power, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'
import { cn } from '@/lib/utils'
import estilos from './tipografia.module.css'
import {
  confirmarNumeroDelLocal,
  desconectarNumero,
  generarEnlaceDeConexion,
  guardarInformacionDelLocal,
  prenderOApagar,
  type EstadoBot,
} from './acciones'

/**
 * `INICIAL` vive acá y no en `acciones.ts`: un archivo `'use server'` sólo
 * puede exportar funciones async, y un `export const` ahí tira abajo la
 * pantalla en runtime con el build en verde. Lo fija `test/use-server.test.ts`.
 */
export const INICIAL: EstadoBot = { error: null, aviso: null, enlace: null }

/** El tope de la información del local. Igual que `TOPE_INSTRUCCIONES` de
 *  `lib/bot/prompt.ts`, repetido acá porque ese módulo llega a Prisma y un
 *  import de valor desde un archivo `'use client'` arrastraría `pg` al bundle
 *  — el bug que `test/limite-cliente-servidor.test.ts` existe para atrapar. */
const TOPE = 2000

export type NumeroOfrecido = { phoneNumberId: string; numeroVisible: string | null }

export type VistaDelBot = {
  conectado: boolean
  numeroVisible: string | null
  conectadoEn: string | null
  activo: boolean
  instrucciones: string
  respuestasDelMes: number
  topeMensual: number
  esDuenio: boolean
  kapsoListo: boolean
  modeloListo: boolean
  /** Los que Kapso reporta y todavía no se confirmaron. */
  numeros: NumeroOfrecido[]
}

/**
 * Lanza el toast con el resultado ya en la mano.
 *
 * Función normal en el mismo handler que ejecuta la acción, NUNCA un
 * `useEffect` sobre `useActionState`: un efecto está atado al ciclo de vida del
 * componente, y con cada `revalidatePath` el componente se desmonta y se lleva
 * el aviso puesto. Los errores no se auto-descartan porque dicen qué corregir;
 * los éxitos sí. La clave es estable por acción, o sonner apila una copia por
 * cada vez que se toca el mismo control.
 */
function avisar(resultado: EstadoBot, clave: string): EstadoBot {
  if (resultado.error) toast.error(resultado.error, { id: clave, duration: Infinity })
  else if (resultado.aviso) toast.success(resultado.aviso, { id: clave })
  return resultado
}

const TITULO = cn(estilos.tituloDeCard, 'text-foreground')
const AYUDA = 'text-xs leading-relaxed text-foreground-soft'

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card className="gap-0 p-[14px] lg:p-[18px]">
      <h2 className={TITULO}>{titulo}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </Card>
  )
}

/**
 * El disparador de conexión del Topbar, en sus dos copias.
 *
 * Las dos las gobierna el MISMO `esDuenio`. Un botón duplicado con una guarda
 * en una sola copia es el defecto que el merge del ciclo del teléfono dejó
 * documentado, y por eso `test/permisos-en-las-dos-copias.test.ts` cuenta las
 * apariciones en las dos direcciones.
 */
export function BotonDeConexion({
  esDuenio,
  kapsoListo,
  movil,
}: {
  esDuenio: boolean
  kapsoListo: boolean
  movil?: boolean
}) {
  const [enCurso, empezar] = useTransition()
  const [enlace, setEnlace] = useState<string | null>(null)

  if (!esDuenio || !kapsoListo) return null

  const pedir = () =>
    empezar(async () => {
      const r = avisar(await generarEnlaceDeConexion(), 'bot-enlace')
      if (r.enlace) setEnlace(r.enlace)
    })

  // `Button asChild` y no un `<a>` con clases de color propias: los tokens del
  // botón de acción sólo se nombran dentro de components/ui/, y
  // test/sistema-de-diseno.test.ts lo verifica —sobre el texto del archivo, así
  // que ni siquiera se pueden nombrar en un comentario como éste. Escribir el
  // par a mano acá es exactamente el bug que ese caso existe para atrapar.
  if (enlace) {
    return (
      <Button asChild size={movil ? 'icon' : 'sm'} className={movil ? CLASES_RANURA_MOVIL : undefined}>
        <a href={enlace} target="_blank" rel="noreferrer" aria-label="Abrir el enlace de conexión">
          <Link2 className="size-4" />
          {movil ? null : 'Abrir el enlace'}
        </a>
      </Button>
    )
  }

  return (
    <Button
      type="button"
      size={movil ? 'icon' : 'sm'}
      className={movil ? CLASES_RANURA_MOVIL : undefined}
      disabled={enCurso}
      onClick={pedir}
      aria-label="Conectar mi WhatsApp"
    >
      <Smartphone className="size-4" />
      {movil ? null : 'Conectar mi WhatsApp'}
    </Button>
  )
}

function Conexion({ vista }: { vista: VistaDelBot }) {
  const [enCurso, empezar] = useTransition()

  if (!vista.kapsoListo) {
    return (
      <Seccion titulo="Conectá el WhatsApp del local">
        <p className={AYUDA}>
          La integración con WhatsApp todavía no está configurada en este servidor. Cuando lo esté,
          vas a poder conectar el número del local desde acá.
        </p>
      </Seccion>
    )
  }

  if (vista.conectado) {
    return (
      <Seccion titulo="El número">
        <p className="text-base font-semibold text-foreground">{vista.numeroVisible ?? '—'}</p>
        {vista.conectadoEn && <p className={AYUDA}>Conectado el {vista.conectadoEn}.</p>}
        <p className={AYUDA}>
          Seguís usando WhatsApp desde tu celular como siempre: el bot contesta sobre el mismo
          número, sin sacarte la aplicación.
        </p>
        {vista.esDuenio && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={enCurso}
            onClick={() =>
              empezar(async () => {
                avisar(await desconectarNumero(), 'bot-desconectar')
              })
            }
          >
            Desconectar
          </Button>
        )}
      </Seccion>
    )
  }

  if (vista.numeros.length > 0) {
    return (
      <Seccion titulo="Encontramos tu número">
        <p className={AYUDA}>
          Kapso ya tiene conectado {vista.numeros.length === 1 ? 'este número' : 'estos números'}.
          Confirmá cuál usa el local y el bot queda listo para prender.
        </p>
        {vista.numeros.map((n) => (
          <div
            key={n.phoneNumberId}
            className="flex flex-col gap-2 rounded-md border border-border p-3 lg:flex-row lg:items-center lg:justify-between"
          >
            <span className="text-sm font-semibold text-foreground">
              {n.numeroVisible ?? n.phoneNumberId}
            </span>
            {vista.esDuenio && (
              <Button
                type="button"
                size="sm"
                disabled={enCurso}
                onClick={() =>
                  empezar(async () => {
                    avisar(await confirmarNumeroDelLocal(n.phoneNumberId), 'bot-confirmar')
                  })
                }
              >
                Es este, conectalo
              </Button>
            )}
          </div>
        ))}
      </Seccion>
    )
  }

  return (
    <Seccion titulo="Conectá el WhatsApp del local">
      <p className={AYUDA}>
        El bot contesta sobre el número que ya usás. Seguís atendiendo desde la aplicación de
        WhatsApp Business en tu celular; el bot responde en paralelo cuando vos no estás.
      </p>
      <p className={AYUDA}>
        Para conectarlo hace falta la cuenta de Facebook del negocio. Generá el enlace desde el
        botón de arriba y abrilo —si la cuenta la tenés en el celular, abrilo ahí.
      </p>
      {!vista.esDuenio && (
        <p className={AYUDA}>El número lo conecta el dueño del local.</p>
      )}
    </Seccion>
  )
}

function Interruptor({ vista }: { vista: VistaDelBot }) {
  const [enCurso, empezar] = useTransition()
  const [activo, setActivo] = useState(vista.activo)

  if (!vista.conectado) return null

  const cambiar = (valor: boolean) => {
    const antes = activo
    setActivo(valor)
    empezar(async () => {
      const r = avisar(await prenderOApagar(valor), 'bot-switch')
      // Rollback si el servidor lo rechazó: el switch no puede quedar diciendo
      // algo distinto de lo que la base guardó.
      if (r.error) setActivo(antes)
      else if (valor && !vista.instrucciones.trim()) {
        toast('El bot va a contestar sólo precios y disponibilidad hasta que cargues la información del local.', {
          id: 'bot-sin-info',
        })
      }
    })
  }

  return (
    <Seccion titulo="El bot">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="bot-activo" className="flex items-center gap-2 text-sm">
          <Power className="size-4 text-foreground-soft" />
          {activo ? 'Está contestando' : 'No está contestando'}
        </Label>
        <Switch id="bot-activo" checked={activo} disabled={enCurso} onCheckedChange={cambiar} />
      </div>
      {!vista.modeloListo && (
        <p className="rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
          Falta configurar el modelo en este servidor, así que el bot no puede responder todavía.
          Los mensajes que lleguen quedan guardados.
        </p>
      )}
    </Seccion>
  )
}

function Informacion({ vista }: { vista: VistaDelBot }) {
  const [enCurso, empezar] = useTransition()
  const [texto, setTexto] = useState(vista.instrucciones)

  return (
    <Seccion titulo="Lo que el bot cuenta del local">
      <p className={AYUDA}>
        Horarios, dirección, si hacés envíos, cómo se paga. El bot usa esto para responder; lo que
        no esté escrito acá, no lo sabe y no lo inventa.
      </p>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={TOPE}
        rows={7}
        placeholder={
          'Abrimos de lunes a viernes de 9 a 18 y sábados de 9 a 13.\n' +
          'Estamos en Av. Siempreviva 742.\n' +
          'Hacemos envíos a todo el país.\n' +
          'Se puede pagar en efectivo, con transferencia o con tarjeta.'
        }
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-foreground-soft">
          {texto.length} de {TOPE}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={enCurso}
          onClick={() =>
            empezar(async () => {
              avisar(await guardarInformacionDelLocal(texto), 'bot-info')
            })
          }
        >
          Guardar
        </Button>
      </div>
    </Seccion>
  )
}

function Consumo({ vista }: { vista: VistaDelBot }) {
  if (!vista.conectado) return null
  const usado = vista.respuestasDelMes
  const tope = vista.topeMensual
  const porcentaje = tope > 0 ? Math.min(100, Math.round((usado / tope) * 100)) : 0
  const lleno = usado >= tope

  return (
    <Seccion titulo="Este mes">
      <p className="text-2xl font-semibold text-foreground">
        {usado}
        <span className="text-base font-normal text-foreground-soft"> de {tope}</span>
      </p>
      <Progress value={porcentaje} />
      <p className={AYUDA}>
        {lleno
          ? 'Llegaste al tope del mes: el bot dejó de contestar. Los mensajes que lleguen se siguen guardando.'
          : 'Respuestas que dio el bot este mes. El contador vuelve a cero el primero de cada mes.'}
      </p>
    </Seccion>
  )
}

function QueContesta() {
  return (
    <Seccion titulo="Qué contesta">
      <ul className={cn(AYUDA, 'flex flex-col gap-2')}>
        <li className="flex gap-2">
          <MessageCircle className="mt-0.5 size-3.5 shrink-0" />
          Precios y disponibilidad de los artículos de tu catálogo.
        </li>
        <li className="flex gap-2">
          <Bot className="mt-0.5 size-3.5 shrink-0" />
          La información del local que cargues acá al lado.
        </li>
      </ul>
      <p className={AYUDA}>
        No toma pedidos, no reserva, no cobra y no ve tus ventas, tus clientes ni tus costos. Si no
        puede resolver algo, avisa que responde una persona del local.
      </p>
    </Seccion>
  )
}

export function CuerpoBot({ vista }: { vista: VistaDelBot }) {
  return (
    // Apilado en el teléfono y en fila recién en `lg:`, con el ancho fijo
    // TAMBIÉN prefijado: un `flex` sin prefijo con un hermano de ancho fijo
    // lleva la otra columna a cero abajo de ~424 px. Es el defecto que
    // /formas-de-pago tuvo y que `test/responsive.test.ts` no puede atrapar —
    // su umbral mira desbordes, y esto es un colapso.
    <div className="flex flex-col gap-3 p-[14px] lg:flex-row lg:items-start lg:gap-4 lg:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:gap-4">
        <Conexion vista={vista} />
        <Interruptor vista={vista} />
        <Informacion vista={vista} />
      </div>
      <div className="flex w-full flex-col gap-3 lg:w-[360px] lg:gap-4">
        <Consumo vista={vista} />
        <QueContesta />
      </div>
    </div>
  )
}
