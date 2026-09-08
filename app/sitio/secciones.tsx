import { Box, Check } from 'lucide-react'
import { ANCHO, EncabezadoDeSeccion } from './base'
import { Revelar, TarjetaAnimada } from './movimiento'
import { MODULOS, NUCLEO, PLANES } from './datos'
import { IndiceDeRubros } from './rubros'
import { Button } from '@/components/ui/button'
import estilos from './cierre.module.css'
import importe from '@/components/importe.module.css'
import tipografia from './tipografia.module.css'

/**
 * Las cuatro secciones de contenido: Módulos, Rubros, Planes y Cierre.
 *
 * LA DECISIÓN ESTRUCTURAL DEL REDISEÑO, que vale para las cuatro: hasta acá la
 * página era el mismo objeto siete veces —H2, bajada, grilla de tarjetas de
 * `rounded-[18px]`—, con el mismo radio y la misma caja para el núcleo del
 * producto, un rubro y un plan. Cuando toda la estructura es idéntica, la
 * estructura deja de decir nada sobre el contenido, y eso es exactamente lo
 * que hace que una página se lea como una plantilla.
 *
 * Ahora cada sección tiene la forma de lo suyo: el núcleo es una banda ancha
 * (es uno, y está abajo de todo lo demás), los módulos son tres paneles
 * paralelos (son tres cosas comparables), los rubros son un ÍNDICE (no son
 * doce features: son una búsqueda, "¿está el mío?") y los planes son cuatro
 * columnas que se comparan de a pares.
 */

/**
 * Módulos: la banda del núcleo y los tres paneles.
 *
 * EL NÚCLEO YA NO ES UN PAÑO DE MARCA. Era una de las tres superficies de
 * `--marca` de la página, y `docs/sistema-de-diseno.md` es explícito en que no
 * puede haber dos en secciones consecutivas — Planes y Cierre lo eran, y el
 * propio documento admitía que ahí "el argumento es más débil". El rediseño
 * las baja a dos, no consecutivas: la banda del Total adentro del carrito
 * (ancla la plata) y la franja del Cierre (ancla la conversión). El núcleo se
 * distingue ahora por FORMA —una banda a todo el ancho contra tres paneles en
 * tercios—, que es más barato y dice lo mismo: hay uno solo y es la base.
 *
 * Y con el paño se fue el hex crudo que pintaba los chips del núcleo sobre el
 * violeta, que era el único color fuera del sistema de tokens en toda la
 * landing. Los chips viven ahora sobre papel y usan tokens.
 */
export function Modulos() {
  return (
    <section id="que-hace" className="bg-background py-8 lg:py-16">
      <Revelar className={`${ANCHO} flex flex-col gap-[18px] lg:gap-7`}>
        <EncabezadoDeSeccion
          titulo="Un núcleo, tres módulos, rubros ilimitados"
          bajada="El núcleo solo ya cubre un comercio completo. Los módulos agregan comportamiento, y un rubro nuevo es un archivo de configuración, no desarrollo."
        />

        <div className="flex flex-col gap-4 rounded-[18px] border bg-card p-4 lg:flex-row lg:items-center lg:gap-8 lg:p-[26px]">
          <div className="flex items-center gap-2.5 lg:w-[220px] lg:shrink-0 lg:flex-col lg:items-start lg:gap-1.5">
            <Box aria-hidden="true" className="size-[17px] text-primary lg:size-[19px]" />
            <span className={`${tipografia.archivo} text-[17px] font-semibold text-foreground lg:text-xl`}>
              Núcleo
            </span>
            <span className="text-[11px] text-muted-foreground lg:text-[13px]">
              lo que todo negocio necesita
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-1 lg:flex-wrap lg:gap-2.5">
            {NUCLEO.map((pieza) => (
              <span
                key={pieza}
                className="flex h-[34px] items-center justify-center rounded-[9px] bg-background px-2 text-xs font-medium text-foreground-soft lg:h-auto lg:justify-start lg:rounded-full lg:border lg:px-[13px] lg:py-2"
              >
                {pieza}
              </span>
            ))}
          </div>
        </div>

        {/* El estado de cada módulo se ve antes de leerse: el que está
            construido es una card de papel con borde, y los dos que no
            todavía se quedan sobre el fondo hundido, sin borde y con el texto
            un nivel más apagado. El chip sigue estando —es el rótulo, y decir
            las cosas con todas las letras vale— pero deja de ser la ÚNICA
            señal. Que dos de los tres módulos estén en camino es lo que la
            página tiene para decir, no algo que haya que disimular. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {MODULOS.map((modulo) => {
            const disponible = modulo.estado === 'Disponible'
            return (
              <TarjetaAnimada
                key={modulo.titulo}
                className={`flex flex-col gap-3 rounded-[16px] p-[22px] ${
                  disponible ? 'border bg-card' : 'bg-secondary'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex size-[38px] items-center justify-center rounded-[11px] ${
                      disponible ? 'bg-accent' : 'bg-card'
                    }`}
                  >
                    <modulo.icono
                      aria-hidden="true"
                      className={`size-[18px] ${disponible ? 'text-primary' : 'text-muted-foreground'}`}
                    />
                  </span>
                  <span
                    className={`rounded-full px-[9px] py-[3px] text-[11px] font-semibold ${
                      disponible ? 'bg-ok-soft text-ok' : 'bg-card text-muted-foreground'
                    }`}
                  >
                    {modulo.estado}
                  </span>
                </div>
                <span
                  className={`${tipografia.archivo} text-[19px] leading-[1.2] font-semibold ${
                    disponible ? 'text-foreground' : 'text-foreground-soft'
                  }`}
                >
                  {modulo.titulo}
                </span>
                <p className="text-[13px] leading-[1.5] text-foreground-soft">{modulo.detalle}</p>
                <p
                  className={`text-[11px] leading-[1.5] font-semibold ${
                    disponible ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {modulo.rubros}
                </p>
              </TarjetaAnimada>
            )
          })}
        </div>
      </Revelar>
    </section>
  )
}

/**
 * Rubros: un índice, no doce tarjetas.
 *
 * Doce cards idénticas era el kit de tarjetas en su peor versión, y encima no
 * describía lo que la sección hace: nadie LEE los doce rubros, se busca el
 * propio. Un índice se recorre con el ojo en dos segundos; doce cards hay que
 * leerlas de a una.
 *
 * Y ARREGLA UNA CONTRADICCIÓN QUE ERA VISIBLE PARA EL CLIENTE: cuatro rubros
 * anunciaban "Núcleo + Turnos" bajo un título que dice "Tu rubro ya está
 * adentro", mientras la sección de arriba decía que Turnos está En camino. Un
 * dueño de peluquería leía que su rubro ya estaba y no estaba. Ahora el texto
 * se deriva de `MODULOS` (ver `./datos`), y lo que falta se dice.
 */
export function Rubros() {
  return (
    <section id="rubros" className="py-8 lg:py-16">
      <Revelar className={`${ANCHO} flex flex-col gap-[18px] lg:gap-6`}>
        <EncabezadoDeSeccion
          titulo="Tu rubro ya está adentro"
          bajada="Un rubro no es código: es qué módulos vienen activados, qué datos demo se cargan y cómo se llaman las cosas en la pantalla."
        />

        <IndiceDeRubros />

        <p className="text-xs font-semibold text-primary">¿No está el tuyo? Se agrega sin desarrollo.</p>
      </Revelar>
    </section>
  )
}

/**
 * Planes.
 *
 * EL DESTACADO YA NO ES UN PAÑO DE MARCA (ver la nota de `Modulos`): se
 * distingue con un contorno de `--primary`, que es el token de acción y
 * selección del sistema. Un contorno no es una superficie, así que la regla de
 * "una superficie de marca por sección" queda intacta y Planes deja de ser la
 * segunda sección violeta consecutiva antes del Cierre.
 *
 * LA PLATA SE ESCRIBE COMO ADENTRO DEL PRODUCTO: el monto usa el mismo rol
 * `importe` que la banda del total del punto de venta —cara angosta, cifras
 * tabulares— y el signo va aparte, con su propio tamaño. Antes el precio era
 * un string con el signo pegado ("$ 24.900") tipografiado como un titular, así
 * que la misma página escribía la plata de dos maneras distintas.
 */
export function Planes() {
  return (
    <section id="precios" className="bg-background py-8 lg:py-16">
      <Revelar className={`${ANCHO} flex flex-col gap-[18px] lg:gap-7`}>
        <EncabezadoDeSeccion
          titulo="Precios claros, en pesos"
          bajada="Los módulos no se cobran aparte ni dependen del plan: activás los que necesites. El plan limita capacidad, no rubro."
        />

        <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-4 lg:gap-4">
          {PLANES.map((plan) => (
            <TarjetaAnimada
              key={plan.nombre}
              className={`flex flex-col gap-3 rounded-[18px] border bg-card p-4 lg:gap-4 lg:p-6 ${
                plan.destacado ? 'border-primary ring-1 ring-primary' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">{plan.nombre}</span>
                {plan.destacado && (
                  <span className="rounded-full bg-accent px-[9px] py-1 text-[10px] font-bold text-primary">
                    Más elegido
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                {plan.precio ? (
                  <span className="flex items-baseline gap-1 text-foreground">
                    <span className={`${importe.signo} text-muted-foreground`}>$</span>
                    <span className={`${importe.importe} text-[32px] leading-none font-bold tracking-[-1px]`}>
                      {plan.precio}
                    </span>
                  </span>
                ) : (
                  <span className={`${tipografia.archivo} text-[32px] leading-none font-bold tracking-[-1px] text-foreground`}>
                    {plan.textoSinPrecio}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">{plan.periodo}</span>
              </div>

              <p className="text-xs text-foreground-soft">{plan.detalle}</p>

              <ul className="flex flex-1 flex-col gap-2">
                {plan.incluye.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <Check aria-hidden="true" className="size-[13px] shrink-0 text-primary" />
                    <span className="text-xs leading-[1.4] text-foreground-soft">{item}</span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                variant={plan.destacado ? 'default' : 'outline'}
                className={plan.destacado ? 'h-11 lg:h-[42px]' : 'h-11 border-input bg-card lg:h-[42px]'}
              >
                <a href="#contacto">{plan.accion}</a>
              </Button>
            </TarjetaAnimada>
          ))}
        </div>
      </Revelar>
    </section>
  )
}

/**
 * El Cierre: la única superficie de `--marca` de una sección entera, y la
 * única cosa que hay para hacer en la página.
 *
 * EL COPY DICE LO QUE PASA. El H2 decía "El alta es instantánea" y la bajada
 * prometía "elegís el rubro y en dos minutos tenés tu local cargado". Ninguna
 * de las dos era cierta: el registro público está apagado a propósito y el
 * formulario tiene UN campo, que guarda `rubro: null`. No hay ningún rubro que
 * elegir ni ningún alta de dos minutos. Lo que sí pasa —alguien te escribe y
 * te deja el local andando— es una promesa que el producto cumple hoy.
 */
export function Cierre({ whatsapp, children }: { whatsapp: string; children: React.ReactNode }) {
  return (
    <section id="contacto" className={`${estilos.franja} py-9 lg:py-[72px]`}>
      <Revelar className={`${ANCHO} flex flex-col items-center gap-4 text-center lg:gap-[22px]`}>
        <h2
          className={`${estilos.titulo} ${tipografia.archivo} max-w-[720px] text-[28px] leading-[1.15] font-semibold lg:text-[44px] lg:leading-[1.1] lg:font-bold lg:tracking-[-1.4px]`}
        >
          Probalo con tu propio local
        </h2>
        <p className={`${estilos.bajada} max-w-[620px] text-[13px] leading-[1.5] lg:text-base lg:leading-[1.6]`}>
          Dejanos tu WhatsApp o tu mail. Te escribimos, te damos de alta el local y te lo dejamos
          cargado con datos de ejemplo para que lo pruebes cinco días.
        </p>

        <div className="w-full max-w-[520px]">{children}</div>

        <p className="text-[11px] lg:text-xs" style={{ color: 'var(--marca-dim)' }}>
          Sin tarjeta. Exportás tus datos cuando quieras
          {whatsapp ? ', y el soporte es por WhatsApp.' : '.'}
        </p>
      </Revelar>
    </section>
  )
}
