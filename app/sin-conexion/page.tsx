import type { Metadata } from 'next'

/**
 * Lo que ve el dueño cuando abre la app instalada sin internet.
 *
 * Instalada, la ventana no tiene barra de direcciones, así que el error del
 * navegador se lee como que la aplicación se rompió. Esto es un cartel, no una
 * capacidad: el producto sigue sin funcionar sin conexión.
 *
 * ESTÁTICA A PROPÓSITO, y es load-bearing: el service worker la cachea, así
 * que si resolviera tenant lo que quedaría guardado en el celular sería el
 * nombre de un local. No lee headers, no abre sesión y no nombra al negocio.
 *
 * Y SE PINTA SOLA. El service worker cachea este HTML, no las hojas de estilo
 * —que llevan hash en el nombre y cambian en cada build, así que no hay lista
 * de assets que siga siendo válida después del deploy siguiente—. Con clases
 * de Tailwind, servida desde la caché se vería como HTML pelado. Los hex están
 * copiados de app/globals.css y atados por page.test.tsx.
 */
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Sin conexión — Arándano',
  robots: { index: false, follow: false },
}

export default function SinConexion() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        backgroundColor: '#f6f5f9',
        color: '#171221',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: '#2a1760',
        }}
      >
        Arándano
      </div>
      <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>Sin conexión</h1>
      <p style={{ fontSize: 14, margin: 0, color: '#4a4358', maxWidth: 320 }}>
        No hay internet en este momento. Volvé a intentar cuando se recupere la
        conexión.
      </p>
    </main>
  )
}
