import { ANCHO } from './base'
import { VIDEO } from './datos'
import { Revelar } from './movimiento'
import { Reproductor } from './reproductor'
import tipografia from './tipografia.module.css'
import estilos from './video.module.css'

/**
 * Video: la presentación del producto, entre el Hero y Módulos
 * (design/arandano.pen, `f3fZZ` en escritorio y `EcZt5` en el teléfono).
 *
 * En la maqueta va después de la banda "Prueba" ("Alta instantánea"), que el
 * rediseño de la landing sacó porque el alta no es instantánea — ver la
 * entrada 35 de docs/correcciones-pendientes-del-pen.md. Acá queda pegada al
 * Hero.
 *
 * EL COPY NO ES EL DE LA MAQUETA, y es a propósito. El `.pen` dice "en 2
 * minutos", un chip de "2:04 · con subtítulos" y una bajada sobre servicio
 * técnico y cierre de caja: textos de relleno dibujados antes de que existiera
 * el video. El video real dura 36 segundos, no tiene audio, el texto está
 * escrito en la imagen y muestra la venta, el cobro con factura ARCA, la caja,
 * el bot y los rubros. Un título que promete dos minutos sobre un video de
 * medio minuto es la misma clase de promesa vacía que el rediseño sacó del
 * Hero y del Cierre. La geometría, los colores y la estructura son los de la
 * maqueta, letra por letra.
 *
 * La sección es de servidor y sólo el reproductor es cliente: el título, la
 * bajada y la letra chica no necesitan JavaScript para existir.
 */
export function Video() {
  return (
    <section id="video" className={`${estilos.franja} py-8 lg:py-16`}>
      <Revelar className={`${ANCHO} flex flex-col items-center gap-4 lg:gap-7`}>
        <div className="flex w-full max-w-[720px] flex-col items-center gap-2 text-center lg:gap-3">
          <h2
            className={`${estilos.titulo} ${tipografia.archivo} text-[26px] leading-[1.15] font-bold lg:text-[38px] lg:leading-[1.12]`}
          >
            {`Mirá cómo funciona, en ${VIDEO.segundos} segundos`}
          </h2>
          <p className={`${estilos.bajada} text-[13px] leading-[1.55] lg:text-[15px] lg:leading-[1.6]`}>
            <span className="lg:hidden">
              Una venta, el cobro con factura ARCA y el bot de WhatsApp, de punta a punta.
            </span>
            <span className="hidden lg:inline">
              Una venta que descuenta el stock, el cobro con factura ARCA, la caja en pesos y dólares
              y el bot de WhatsApp, de punta a punta. Sin registrarte y sin dejar un dato.
            </span>
          </p>
        </div>

        <Reproductor />

        <p className={`${estilos.letraChica} text-center text-[11px] leading-[1.5] lg:text-xs lg:leading-[15px]`}>
          El video no reemplaza la prueba: el punto de venta de arriba es la app de verdad.
        </p>
      </Revelar>
    </section>
  )
}
