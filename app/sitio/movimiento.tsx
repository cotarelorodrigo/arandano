'use client'

import { useEffect, useRef, useState } from 'react'
import {
  LazyMotion, domMax, useInView, useReducedMotion, useScroll, useSpring,
} from 'motion/react'
import * as m from 'motion/react-m'

/**
 * El movimiento de la landing: el titular que se tipea, los revelados por
 * scroll, los hovers de las tarjetas y la barra de progreso.
 *
 * DECISIÓN DEL DUEÑO DEL PRODUCTO, tomada con la objeción sobre la mesa. La
 * recomendación había sido lo contrario —movimiento sólo donde muestre
 * producto— por dos motivos que siguen siendo ciertos y que conviene dejar
 * escritos acá en vez de volver a discutirlos:
 *
 * 1. El revelado por sección al scrollear es el patrón más repetido de las
 *    landings generadas, así que "se ve moderna" y "se ve hecha con plantilla"
 *    son en este caso la misma cosa.
 * 2. El titular tipeado empuja el LCP de la ÚNICA página indexable del
 *    producto: el H1 es justamente el elemento que esa métrica mide, y tipearlo
 *    significa que arranca vacío.
 *
 * Lo que sí se hizo, porque no cuesta nada y evita lo peor de cada uno:
 *
 * - **El texto completo del titular está en el HTML desde el primer byte**, en
 *   un `sr-only`. Los buscadores y los lectores de pantalla leen la frase
 *   entera; lo que se tipea es una copia visual marcada `aria-hidden`. El LCP
 *   lo paga igual, pero el SEO y la accesibilidad no.
 * - **La caja del titular se reserva completa antes de tipear**, con una copia
 *   invisible que ocupa el lugar. Sin eso, cada letra empuja el layout y la
 *   página entera baila mientras escribe.
 * - **Todo se apaga con `prefers-reduced-motion`**, y apagado la página queda
 *   completa: el titular aparece entero, las secciones visibles y la barra de
 *   progreso no se dibuja. Mismo criterio que la persiana del login.
 * - **Los revelados nunca dejan una sección invisible para siempre.** Se
 *   disparan una sola vez (`once`) y con un margen que los adelanta, así que
 *   una sección que ya está en pantalla al cargar no espera a que alguien
 *   scrollee para existir.
 */

/**
 * El proveedor: una sola carga diferida de las features para toda la página.
 *
 * `domMax` y no `domAnimation`, que es el más chico: el índice de Rubros usa
 * animación de LAYOUT (FLIP) para que las filas se deslizan a su lugar nuevo
 * al filtrar en vez de saltar, y eso vive sólo en el paquete grande. Es la
 * única razón por la que este archivo pide `domMax`; si algún día el filtro
 * desaparece, esto vuelve a `domAnimation`.
 *
 * Y EL SEGURO CONTRA EL PEOR MODO DE FALLA DE ESTA PÁGINA. Los revelados salen
 * del servidor en `opacity: 0` y sólo aparecen cuando el JavaScript los ve
 * entrar en pantalla: cuatro de las siete secciones. Sin JavaScript —una red
 * que cortó a mitad de la descarga, una extensión que lo bloquea, un crawler
 * que no ejecuta— esas cuatro quedarían invisibles para siempre, y la página
 * se vería como si le faltara la mitad sin que nada lo avise.
 *
 * El `<noscript>` las devuelve a la vista. Es la misma clase de defensa que
 * `prefers-reduced-motion`, para el otro escenario: cuando el movimiento no
 * puede correr, lo que queda tiene que ser una página correcta.
 */
export function ProveedorDeMovimiento({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <noscript>
        <style>{`[data-revelar]{opacity:1!important;transform:none!important}`}</style>
      </noscript>
      {children}
    </LazyMotion>
  )
}

const MS_POR_LETRA = 28

/**
 * El titular que se tipea.
 *
 * El texto entero viaja en el HTML (ver el docblock del archivo). Lo que cambia
 * en pantalla es la copia visual.
 */
export function TitularTipeado({ texto, className }: { texto: string; className?: string }) {
  const sinMovimiento = useReducedMotion()
  const [escritas, setEscritas] = useState(0)

  useEffect(() => {
    // Sin movimiento no hay nada que agendar: el titular ya se dibuja entero
    // más abajo, derivado y no por estado — poner el largo con `setEscritas`
    // acá sería un setState sincrónico dentro de un efecto, que dispara un
    // render en cascada de más.
    if (sinMovimiento) return
    let letra = 0
    const reloj = setInterval(() => {
      letra += 1
      setEscritas(letra)
      if (letra >= texto.length) clearInterval(reloj)
    }, MS_POR_LETRA)
    return () => clearInterval(reloj)
  }, [texto, sinMovimiento])

  const mostradas = sinMovimiento ? texto.length : escritas
  const completo = mostradas >= texto.length

  return (
    <h1 className={className}>
      {/* Para buscadores y lectores de pantalla: la frase entera, siempre. */}
      <span className="sr-only">{texto}</span>
      {/* La caja reservada: una copia invisible que ocupa exactamente el lugar
          del titular terminado, para que tipear no empuje el layout. */}
      <span aria-hidden="true" className="relative block">
        <span className="invisible">{texto}</span>
        <span className="absolute inset-0">
          {texto.slice(0, mostradas)}
          {!completo && (
            <span className="ml-[2px] inline-block h-[0.78em] w-[3px] translate-y-[0.08em] animate-pulse bg-primary align-middle" />
          )}
        </span>
      </span>
    </h1>
  )
}

/**
 * El revelado por scroll. `once` y con margen: una sección no puede quedar
 * invisible para siempre porque alguien no scrolleó hasta el píxel exacto.
 */
export function Revelar({
  children,
  className,
  demora = 0,
}: {
  children: React.ReactNode
  className?: string
  demora?: number
}) {
  const sinMovimiento = useReducedMotion()
  const referencia = useRef<HTMLDivElement>(null)
  const aLaVista = useInView(referencia, { once: true, margin: '-80px' })

  if (sinMovimiento) return <div className={className}>{children}</div>

  return (
    <m.div
      ref={referencia}
      data-revelar=""

      initial={{ opacity: 0, y: 24 }}
      animate={aLaVista ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: demora }}
      className={className}
    >
      {children}
    </m.div>
  )
}

/**
 * Una tarjeta que responde al puntero. `y` y nada más: un `scale` sobre una
 * card con borde deja el borde borroso en pantallas no densas.
 */
export function TarjetaAnimada({
  children,
  className,
  as = 'div',
}: {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'li'
}) {
  const sinMovimiento = useReducedMotion()
  const Elemento = as === 'li' ? m.li : m.div
  const Simple = as === 'li' ? 'li' : 'div'

  if (sinMovimiento) return <Simple className={className}>{children}</Simple>

  return (
    <Elemento
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      className={className}
    >
      {children}
    </Elemento>
  )
}

/**
 * La barra de progreso del scroll. Fija arriba de todo, por encima del Nav.
 *
 * `useSpring` sobre el progreso y no el progreso crudo: sin el resorte, la
 * barra copia el scroll cuadro a cuadro y con la rueda del mouse se ve
 * escalonada en vez de continua.
 */
export function BarraDeProgreso() {
  const sinMovimiento = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const avance = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 })

  if (sinMovimiento) return null

  return (
    <m.div
      aria-hidden="true"
      style={{ scaleX: avance }}
      className="fixed inset-x-0 top-0 z-50 h-[3px] origin-left bg-primary"
    />
  )
}
