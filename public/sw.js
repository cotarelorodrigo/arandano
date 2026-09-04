/**
 * El service worker de Arándano. Hace dos cosas y ninguna más.
 *
 * 1. Existe. Chrome ya no exige un service worker para instalar desde el menú
 *    (v108 en Android, v112 en escritorio), pero sí para disparar
 *    `beforeinstallprompt`, que es el evento del que depende el botón
 *    "Instalar" del pie del sidebar. O sea que esto no compra instalabilidad
 *    —eso lo da el manifest— sino descubribilidad.
 * 2. Sirve /sin-conexion cuando falla una navegación.
 *
 * NO CACHEA NADA DE NINGÚN LOCAL, y eso no es prolijidad. Todo lo demás de
 * este repo se revierte revirtiendo la imagen; un service worker no: queda
 * instalado en el navegador del dueño y sobrevive al rollback automático del
 * healthcheck, que es la única red que este proyecto tiene por decisión
 * escrita. Por eso es tan chico que se lee entero de una sentada.
 *
 * PARA DESACTIVARLO no hay rollback: hay un deploy de desactivación, escrito
 * en la sección "Deploy y rollback" de docs/runbook-stacks.md.
 *
 * Ver docs/superpowers/specs/2026-09-04-pwa-instalable-design.md.
 */

// Se sube a mano cuando cambia este archivo: activate borra toda caché que no
// coincida, así que una versión nueva limpia la anterior sola.
const VERSION = 'v1'
const CACHE = `arandano-${VERSION}`
const SIN_CONEXION = '/sin-conexion'

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SIN_CONEXION))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request

  // Sin respondWith, el navegador hace lo de siempre: la API, los server
  // actions, las imágenes y la fuente pasan sin que este archivo los toque.
  // El filtro por GET no es de más — un formulario enviado sin JavaScript es
  // una navegación POST, y contestarle una página cacheada de GET es responder
  // algo que no se pidió.
  if (pedido.method !== 'GET' || pedido.mode !== 'navigate') return

  evento.respondWith(
    fetch(pedido).catch(() =>
      caches.match(SIN_CONEXION).then((respuesta) => respuesta ?? Response.error()),
    ),
  )
})
