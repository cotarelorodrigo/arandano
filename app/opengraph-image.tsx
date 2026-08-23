import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Arándano — el sistema para tu negocio'

/**
 * La imagen que muestran WhatsApp, Instagram y los buscadores al compartir el
 * link. Generada y no un PNG a mano: un archivo binario se desincroniza del
 * color de marca sin que nadie se entere.
 *
 * Los colores van en hex y NO en var(--marca), y es una limitación real de
 * Satori (el motor de next/og): no resuelve custom properties de CSS. Son
 * --marca y --marca-foreground copiados a mano.
 *
 * Que la paleta se escriba en hex desde el rediseño hace la copia literal en
 * vez de una conversión, pero no la vuelve inocua: sigue siendo el mismo color
 * escrito en dos archivos.
 *
 * La nota nunca fue el recordatorio principal: test/opengraph.test.ts
 * convierte los tokens reales a hex y compara contra este archivo, así que un
 * cambio de paleta que se olvide de acá rompe el build en vez de servir en
 * silencio una tarjeta con el color viejo.
 */
export default function Imagen() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 96,
          backgroundColor: '#2a1760',
          color: '#ffffff',
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 6, textTransform: 'uppercase', opacity: 0.7 }}>
          Arándano
        </div>
        {/* Minor 17 de la review final: esta frase seguía siendo la vieja
            propuesta de valor, mientras el H1 de la landing (app/sitio/
            secciones.tsx, Hero) ya decía otra desde el rediseño de la Task
            4 — es la vista previa social de la única página pública. */}
        <div style={{ fontSize: 76, lineHeight: 1.1, marginTop: 32 }}>
          Todo el local en un solo lugar
        </div>
      </div>
    ),
    size,
  )
}
