import type { Metadata } from 'next'

/**
 * Lo que ve el dueño cuando abre la app instalada sin internet.
 *
 * Instalada, la ventana no tiene barra de direcciones, así que el error del
 * navegador se lee como que la aplicación se rompió. Esto es un cartel, no una
 * capacidad: el producto sigue sin funcionar sin conexión.
 *
 * SIN NADA DE TENANT, y ESO es lo load-bearing: el service worker la cachea,
 * así que si resolviera tenant lo que quedaría guardado en el celular sería el
 * nombre de un local. No lee headers, no abre sesión y no nombra al negocio.
 * Lo atan por fuente los tres primeros casos de page.test.tsx, que es donde
 * vive la garantía — no en el modo de render.
 *
 * Y SIN EMBARGO SE RENDERIZA POR REQUEST, que es lo contrario de lo que este
 * archivo pedía al nacer. `force-static` era lo natural —no depende de nada— y
 * volteó el build de producción: `not-found.tsx` es el boundary de 404 de TODA
 * ruta, llama a piezasDeOrigen() y ésa tira sin DOMINIO_BASE, que en build time
 * no existe a propósito. Su propio `force-dynamic` la protege cuando
 * `/_not-found` ES la página y no cuando el boundary cuelga del árbol de otra
 * ruta, así que prerenderizar ESTA lo arrastraba al build: "Export encountered
 * an error on /sin-conexion/page", con tests, typecheck y lint en verde. La
 * regla y su porqué viven en test/prerender.test.ts. Lo que cuesta es un render
 * de React por cada install del service worker, o sea uno por dispositivo: no
 * hay consulta a Postgres acá, y la caché del SW es la que atiende después.
 *
 * Y SE PINTA SOLA. El service worker cachea este HTML, no las hojas de estilo
 * —que llevan hash en el nombre y cambian en cada build, así que no hay lista
 * de assets que siga siendo válida después del deploy siguiente—. Con clases
 * de Tailwind, servida desde la caché se vería como HTML pelado. Los hex están
 * copiados de app/globals.css y atados por page.test.tsx.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sin conexión — Arándano',
  robots: { index: false, follow: false },
}

export default function SinConexion() {
  return (
    <main
      style={{
        // fixed + inset en vez de minHeight: '100vh' porque esta página se
        // sirve sin el stylesheet (el SW cachea el HTML, no el CSS con hash),
        // así que no corre el preflight de Tailwind y vuelve el margin: 8px
        // del navegador — con minHeight eso deja una barra de scroll vertical
        // y un marco blanco alrededor del fondo, en el único momento en que
        // esta pantalla existe para atender.
        position: 'fixed',
        inset: 0,
        overflow: 'auto',
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
