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
 * Satori (el motor de next/og): no resuelve custom properties de CSS. El hex es
 * el mismo que documenta docs/sistema-de-diseno.md para --marca y para
 * --primary-foreground; si algún día ese token cambia, este archivo es el
 * segundo lugar a tocar, y esta nota es el recordatorio.
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
          backgroundColor: '#271f52',
          color: '#fafafa',
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 6, textTransform: 'uppercase', opacity: 0.7 }}>
          Arándano
        </div>
        <div style={{ fontSize: 76, lineHeight: 1.1, marginTop: 32 }}>
          Abrís, vendés, cerrás la caja.
        </div>
      </div>
    ),
    size,
  )
}
