import { Formulario } from './formulario'
import { Retrato } from './retrato'
import { TitularTipeado } from './movimiento'
import { ANCHO } from './base'
import tipografia from './tipografia.module.css'

/**
 * El Hero: la promesa a la izquierda, el producto a la derecha.
 *
 * LO QUE CAMBIÓ EN EL REDISEÑO, y por qué cada cosa:
 *
 * SE FUE EL CROMO DE NAVEGADOR (los tres puntitos y la barra de URL que
 * envolvían al carrito). Dibujar una ventana falsa alrededor de una captura es
 * de las marcas más reconocibles de una landing hecha con plantilla, y encima
 * peleaba con lo que el carrito es ahora: algo que se toca, no algo que se
 * mira. El DATO que vivía ahí —que cada local abre en su propia dirección— no
 * se perdió: bajó a una línea propia, donde se lee como el argumento de venta
 * que es en vez de como un adorno de ventana.
 *
 * SE FUE EL BADGE "Hecho para el mercado argentino". Era un rótulo flotando
 * sobre el titular, y lo que decía ya lo dice el contenido con más fuerza:
 * facturación ARCA y caja en pesos y dólares no existen en ningún otro
 * mercado. Un badge que repite lo que la bajada ya prueba es decoración.
 *
 * SE FUE LA SECCIÓN `Muestra`. Era la copia del carrito para el teléfono, con
 * el mismo dato y las mismas dos frases renderizadas por segunda vez en el DOM
 * de cada request. Ahora `Retrato` sirve los dos anchos desde un solo árbol.
 *
 * LA LETRA CHICA DICE LO QUE PASA. Decía "5 días gratis · sin tarjeta · el
 * alta es instantánea", y el alta no es instantánea: el registro público está
 * apagado a propósito (`lib/auth/opciones.ts`) y el local lo damos de alta a
 * mano. Prometer dos minutos y contestar por WhatsApp al día siguiente quema
 * al primer interesado que llega.
 */
export function Hero({ whatsapp }: { whatsapp: string }) {
  return (
    // Las dos columnas NO son iguales: el `.pen` le da 560px al texto
    // (`eUCUn`) y 720 al producto (`g5k1vK`), con 48 de gap — 560:720 es 7:9.
    // En `fr` para que la proporción se sostenga cuando el contenedor no llega
    // a 1328. Abajo de 1024 es una sola columna.
    <section
      className={`${ANCHO} grid gap-6 pt-8 pb-7 lg:grid-cols-[7fr_9fr] lg:items-center lg:gap-12 lg:py-12`}
    >
      <div className="flex flex-col gap-5 lg:gap-[22px]">
        <div className="flex flex-col gap-3 lg:contents">
          <TitularTipeado
            texto="Todo el local en un solo lugar"
            className={`${tipografia.rotulo} text-[36px] leading-[1.1] font-semibold text-foreground lg:text-[62px] lg:leading-[1.03] lg:font-bold lg:tracking-[-2px]`}
          />

          <p className="text-sm leading-[1.5] text-foreground-soft lg:text-[17px] lg:leading-[1.6]">
            Ventas, stock, caja en pesos y dólares, facturación ARCA, catálogo público y un bot de
            WhatsApp que contesta con tus precios y tu stock de verdad. Sobre eso, cada rubro suma
            lo suyo.
          </p>
        </div>

        <Formulario whatsapp={whatsapp} />

        <p className="text-[11px] leading-[1.5] text-muted-foreground lg:text-xs">
          Cinco días de prueba, sin tarjeta. Te escribimos y te dejamos el local andando, con datos
          de ejemplo para probarlo en serio.
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Retrato />

        <p className="text-[11px] leading-[1.45] text-muted-foreground">
          Tocalo: no es una captura. Es el punto de venta, con el mismo formateo de plata que corre
          adentro del sistema.
        </p>
        <p className="text-[11px] leading-[1.45] text-muted-foreground">
          Tu local entra por su propia dirección:{' '}
          <span className="font-semibold text-foreground-soft">flor.arandano.app</span>
        </p>
      </div>
    </section>
  )
}
