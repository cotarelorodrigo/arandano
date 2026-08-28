import { piezasDeOrigen } from '@/lib/auth/origen'

/*
 * La página que Next renderiza cuando algo llama a notFound().
 *
 * Comentario de archivo y no JSDoc, por lo mismo que lib/auth/origen.ts: abajo
 * hay otro bloque pegado al `export const dynamic`, y dos JSDoc consecutivos
 * dejan al primero documentando a nadie.
 *
 * Existe porque sin ella sale el 404 default de Next, que es el que se ve en
 * cualquier deploy de Vercel: un producto que le pide a un comercio que confíe
 * su facturación no puede contestar con la pantalla de otra empresa cuando
 * alguien escribe mal el subdominio.
 *
 * ES UNA SOLA PÁGINA PARA CUATRO CAMINOS, y eso decide el texto. Este boundary
 * es el de la RAÍZ y es el único que hay: test/boundaries-app.test.ts prohíbe
 * poner uno adentro de app/(app)/ —ahí taparía el marcador del gate—, así que
 * acá caen las cuatro cosas:
 *
 * - un subdominio que no es de ningún tenant (`proe.arandano.app`),
 * - un subdominio reservado (`admin.arandano.app`),
 * - un host ajeno o la IP pelada, que no tienen tenant posible,
 * - y el notFound() de una pantalla de adentro (`/inventario/foo`), donde hay
 *   un usuario logueado en un local que SÍ existe.
 *
 * Por eso el texto no habla del local. Decirle "este local no existe" a un
 * dueño que tipeó mal una ruta adentro de su propio negocio es peor que no
 * decirle nada, y la única forma de distinguir los casos sería resolver el
 * tenant acá — o sea una consulta a Postgres por cada 404, servida a cualquier
 * bot que escanee subdominios, contra un pool de max: 5. Es el mismo
 * amplificador de carga que ya está anotado para el nivel anónimo de
 * /api/health, y un 404 no vale eso.
 *
 * SE SIRVE DE DOS FORMAS DISTINTAS, y conviene saberlo antes de agregarle
 * nada. Medido, con el mismo código y el mismo status 404:
 *
 * - Una ruta que NO matchea ninguna (`/no-existe-esta-ruta`) entra por la ruta
 *   `/_not-found` y se renderiza normal: `<html lang="es">`, el layout raíz, y
 *   el `<h1>` y el marcador como atributos HTML de verdad. Sin JavaScript.
 *   Es, además, el 404 más frecuente que va a servir el producto: alguien
 *   tipeando mal una ruta.
 * - Un notFound() lanzado desde una ruta que SÍ matchea —los tres casos de
 *   Host de arriba, más `/inventario/foo`— sube al boundary de la raíz, y ESE
 *   se sirve con `<html id="__next_error__">`, el `<body>` vacío y todo el
 *   árbol en el payload de Flight: el navegador lo pinta recién al hidratar.
 *   Lo mismo le pasa a app/forbidden.tsx, que cuelga del mismo boundary.
 *
 * O sea que por el segundo camino esta pantalla necesita JavaScript, y no es
 * una decisión nuestra ni una regresión —el 404 default de Next se sirve
 * exactamente igual, verificado contra arandano-ensayo—. Es la razón por la
 * que acá no hay ningún formulario ni nada que tenga que funcionar sin JS, al
 * revés que el resto de las pantallas (ver el <form> de salir en
 * app/(app)/layout.tsx). Un link y dos párrafos sobreviven a las dos formas.
 *
 * Es también por lo que el caso del gate busca el marcador PELADO: en HTML
 * sale como `data-testid="pagina-404"` y en el payload como
 * `\"data-testid\":\"pagina-404\"`. Ver scripts/smoke.sh.
 *
 * NADA DE --marca. docs/sistema-de-diseno.md declara que --marca tiene dos
 * superficies y que son las últimas (el paño del login y la franja de cierre de
 * la landing). Esta página se mira dos segundos: no justifica reabrir esa
 * decisión. Sólo neutros, y --primary en el link porque es una acción, que es
 * exactamente para lo que ese token está declarado.
 */
/**
 * OBLIGATORIO, y lo descubrió el build de producción, no dev.
 *
 * Next intenta PRERENDERIZAR `/_not-found` en build time. Ahí no existe
 * DOMINIO_BASE, así que piezasDeOrigen() tira y `npm run build` sale con
 * código 1: "Export encountered an error on /_not-found/page". O sea que sin
 * esta línea el paso 7 del gate de deploy.sh no llega ni a buildear la imagen.
 *
 * Y si la variable estuviera definida en el build sería PEOR, no mejor: el
 * valor quedaría horneado en la imagen, y esta imagen se buildea una vez y se
 * promueve de stage a prod — el link saldría apuntando al dominio del otro
 * entorno. Que el prerender falle es la señal correcta; forzar el render
 * dinámico es la respuesta.
 *
 * LO QUE CUESTA, escrito acá porque tira contra el "un 404 tiene que ser
 * barato" de más arriba y no conviene que se lean por separado: `/_not-found`
 * pasa de estático (`○` en la salida del build) a render por request (`ƒ`), así
 * que un bot pidiendo /wp-login.php, /.env y /admin.php se lleva un render de
 * React por cada intento en vez de una página cacheada. Se acepta porque el
 * daño está acotado —no hay consulta a Postgres, que es la parte cara y la que
 * el resto de este archivo protege— y porque la alternativa no es "estático y
 * con link": es estático con el link apuntando al dominio del entorno
 * equivocado, o sin link.
 *
 * No hace falta un test que cubra esto: el build ES el test, y corre en el
 * paso 7 de cada deploy. Un test unitario no puede prerenderizar.
 */
export const dynamic = 'force-dynamic'

export default async function NoEncontrado() {
  // El link tiene que ser ABSOLUTO al ápex: desde un subdominio que no resuelve,
  // `/` es esta misma página, así que la única salida útil es salir del
  // subdominio.
  //
  // A QUIÉN NO LE SIRVE, decidido a sabiendas: al usuario logueado que tipeó
  // mal una ruta adentro de su propio local. Para ése `/` sí lleva a algún lado
  // —redirige a /vender—, y encima llega acá sin la navegación de (app),
  // porque este boundary es el de la raíz. O sea que su única salida en
  // pantalla lo manda a la landing pública y tiene que retipear su subdominio.
  // Se acepta: es el menos frecuente de los cuatro caminos, el botón Atrás lo
  // resuelve en un click, y las dos alternativas son peores — un segundo link
  // a `/` sería un link muerto en los otros tres caminos, y distinguirlos pide
  // la rama por Host que este archivo sacó a propósito.
  //
  // Y se arma con piezasDeOrigen() en vez de cablear `https://` + DOMINIO_BASE,
  // por lo mismo que el "Ya tengo cuenta" de la landing: la imagen se buildea
  // una vez y se promueve de stage a prod, así que un valor horneado en build
  // time sería el de otro entorno. Medido contra arandano-dev: con la función
  // sale `http://dev.arandano.app:3000`, que es una dirección que existe; con el
  // https cableado saldría una que no.
  //
  // Leer headers() acá obliga a render dinámico, y eso funciona en un
  // not-found.tsx (verificado contra Next 16.2.12: la respuesta sigue siendo
  // 404 y el link sale resuelto). No hay nada de tenant en esta página, así que
  // el render dinámico no protege ningún dato — es sólo el precio del link.
  const { protocolo, dominioBase, puerto } = await piezasDeOrigen()
  const apex = `${protocolo}://${dominioBase}${puerto}`

  return (
    // El data-testid lo consume caso_subdominio_inexistente_404 de
    // scripts/smoke.sh: sin él, ese caso pasaría igual con el 404 pelado de
    // Next, o sea que el gate no distinguiría si esta página existe.
    //
    // NO puede ser "tenant-nombre", el marcador de pantalla: Next incluye el
    // payload de este boundary en el cuerpo de TODA página, así que el barrido
    // autenticado del gate se volvería verde sobre cada pantalla rota.
    // app/not-found.test.tsx lo fija.
    <main
      className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center"
      data-testid="pagina-404"
    >
      {/* La firma va chica y arriba, no como cartel: quien llega acá llegó por
          error, y lo que necesita es entender qué pasó y salir. */}
      <p className="text-xs tracking-[0.06em] text-muted-foreground uppercase">Arándano</p>
      {/* `lg:` y no `md:`: el ciclo del teléfono dejó UN SOLO corte en 1024
          para todo el repo (hooks/use-mobile.ts), y éste era el último `md:`
          vivo de `app/`. */}
      <h1 className="mt-4 text-3xl font-semibold tracking-tight lg:text-4xl">
        No encontramos esta página.
      </h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        Puede que la dirección esté mal escrita, o que lo que buscabas ya no exista.
      </p>
      <a
        href={apex}
        className="mt-8 rounded-lg text-primary underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Ir a {dominioBase}
      </a>
    </main>
  )
}
