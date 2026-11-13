'use client'

import { useRef, useState } from 'react'
import { Play, Timer } from 'lucide-react'
import { CAPITULOS, VIDEO } from './datos'
import estilos from './video.module.css'

/**
 * `1:05`, no `65 s`: es como lo escribe cualquier reproductor, y como lo
 * dibuja la maqueta en el chip y en los capítulos.
 */
export function etiquetaDeTiempo(segundos: number): string {
  const total = Math.round(segundos)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

type VideoMinimo = {
  readyState: number
  currentTime: number
  play(): Promise<void>
  addEventListener(tipo: 'loadedmetadata', fn: () => void, opciones: { once: true }): void
}

/**
 * Salta al segundo pedido y reproduce.
 *
 * Con `preload="none"`, antes del primer click el video no tiene metadatos
 * (`readyState` 0): no sabe cuánto dura, y un `currentTime` puesto en ese
 * estado lo ignora Safari. Por eso el salto espera a `loadedmetadata`, que
 * dispara el propio `play()`. El oyente se registra ANTES del play: si el
 * archivo ya estuviera en caché, el evento podría llegar enseguida.
 *
 * Un `play()` rechazado (red caída, el navegador que se niega) no se reporta:
 * la capa ya se fue y quedan los controles nativos para reintentar.
 */
export function buscarYReproducir(video: VideoMinimo, segundo?: number) {
  if (segundo !== undefined) {
    if (video.readyState >= 1) {
      video.currentTime = segundo
    } else {
      video.addEventListener('loadedmetadata', () => { video.currentTime = segundo }, { once: true })
    }
  }
  video.play().catch(() => {})
}

/**
 * El reproductor y sus capítulos. Van juntos en un componente cliente porque
 * comparten el `<video>`: un capítulo es un salto adentro de ese mismo
 * elemento, no un link a otro lado.
 *
 * LA CAPA, Y POR QUÉ ES OPACA. El póster, el velo, el botón de play y el chip
 * de duración son un solo `<button>` que tapa el video entero. El `<video>`
 * lleva `controls` desde el servidor, debajo; al primer click la capa se va y
 * aparecen los controles nativos. La capa tiene su propia `<img>` del póster
 * —además del `poster` del video, que es lo que se ve mientras carga— para
 * que el botón de play nativo que Safari y Chrome móvil dibujan sobre un video
 * con `controls` no se asome a través del velo semitransparente.
 *
 * SIN JAVASCRIPT la capa no podría sacarse, así que el `<noscript>` la
 * esconde junto con los capítulos, y queda el video con sus controles
 * nativos: se reproduce igual. Mismo mecanismo que el `<noscript>` de
 * `ProveedorDeMovimiento` (./movimiento).
 */
export function Reproductor() {
  const video = useRef<HTMLVideoElement>(null)
  const [empezado, setEmpezado] = useState(false)
  const duracion = etiquetaDeTiempo(VIDEO.segundos)

  function reproducir(segundo?: number) {
    const elemento = video.current
    if (!elemento) return
    setEmpezado(true)
    buscarYReproducir(elemento, segundo)
    if (segundo === undefined) {
      // El botón que tenía el foco desaparece: sin esto el foco cae al
      // <body> y el teclado pierde el lugar. El video, con sus controles
      // nativos, es lo que se sigue operando.
      elemento.focus()
    } else {
      elemento.scrollIntoView({ block: 'nearest' })
    }
  }

  return (
    <>
      <noscript>
        <style>{'[data-video-capa],[data-video-capitulos]{display:none!important}'}</style>
      </noscript>

      <div
        className={`${estilos.reproductor} relative aspect-video w-full max-w-[960px] overflow-hidden rounded-[14px] lg:rounded-[18px]`}
      >
        <video
          ref={video}
          src={VIDEO.src}
          poster={VIDEO.poster}
          preload="none"
          playsInline
          muted
          controls
          aria-label="Video de presentación de Arándano"
          className="absolute inset-0 size-full"
        />

        {!empezado && (
          <button
            type="button"
            data-video-capa=""
            aria-label={`Reproducir el video de presentación: ${VIDEO.segundos} segundos, sin audio`}
            onClick={() => reproducir()}
            className={`${estilos.foco} absolute inset-0 grid cursor-pointer place-items-center`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- el
                póster ya está recortado a 16:9 y pesa 100 KB; next/image no
                tiene nada que optimizar y sumaría un pedido al optimizador. */}
            <img src={VIDEO.poster} alt="" className="absolute inset-0 size-full object-cover" />
            <span aria-hidden="true" className={`${estilos.velo} absolute inset-0`} />
            <span
              aria-hidden="true"
              className={`${estilos.botonDePlay} relative flex size-14 items-center justify-center rounded-full lg:size-20`}
            >
              <Play className="size-[22px] lg:size-[30px]" />
            </span>
            <span
              aria-hidden="true"
              className={`${estilos.chip} absolute bottom-[13px] left-[14px] flex items-center gap-[5px] rounded-full px-[9px] py-1 text-[11px] leading-[13px] font-semibold lg:bottom-[43px] lg:left-7 lg:gap-1.5 lg:px-[11px] lg:py-[5px] lg:text-xs lg:leading-[15px]`}
            >
              <Timer className="size-[11px] lg:size-3" />
              <span className="lg:hidden">{`${duracion} · sin audio`}</span>
              <span className="hidden lg:inline">{`${duracion} · sin audio, todo se lee en pantalla`}</span>
            </span>
          </button>
        )}
      </div>

      <div
        data-video-capitulos=""
        className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center lg:gap-2.5"
      >
        {/* El padding es el del .pen menos el borde: en Pencil el trazo va por
            dentro y no suma, en el navegador sí. Con px-3/py-[7px] las
            pastillas medían 31 px y no 29, y el texto arrancaba un píxel más
            adentro que en la maqueta. */}
        {CAPITULOS.map(({ icono: Icono, titulo, desde }) => (
          <button
            key={titulo}
            type="button"
            data-capitulo={titulo}
            onClick={() => reproducir(desde)}
            className={`flex h-10 w-full cursor-pointer items-center gap-2 rounded-[10px] px-[11px] text-left text-[13px] font-semibold lg:h-auto lg:w-auto lg:gap-[7px] lg:rounded-full lg:px-3 lg:py-[6px] lg:text-xs lg:leading-[15px] ${estilos.capitulo} ${estilos.foco}`}
          >
            <Icono aria-hidden="true" className={`${estilos.iconoDeCapitulo} size-[14px] shrink-0 lg:size-[13px]`} />
            {`${titulo} · ${etiquetaDeTiempo(desde)}`}
          </button>
        ))}
      </div>
    </>
  )
}
