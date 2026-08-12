# Spec: home y navegación

Fecha: 2026-08-12

Qué ve alguien cuando entra al sistema, y cómo se mueve entre pantallas. Son
dos preguntas y una sola respuesta: **el home no es una pantalla, es la
aplicación abierta en la pestaña por defecto.**

Sale del ciclo del rediseño del login, que está en producción desde `v1.6.0`.
Ese ciclo arregló la puerta; éste arregla lo que hay apenas se entra.

## Alcance

Entra:

- `/` deja de renderizar una pantalla propia y redirige a `/vender` para un
  tenant con sesión.
- La navbar pasa a ser la navegación primaria, con pestaña activa, y se sirve
  desde un solo lugar para todas las pantallas.
- El marcador `usuario-nombre` se muda del home al shell.
- El bloque Stack/Imagen sobrevive, chico, dentro del shell.

**Queda afuera**: la caja (pieza 6), cualquier tablero con números del día, y
el registry de módulos —CLAUDE.md promete la navegación como punto de
extensión del núcleo, y ese punto se diseña bien cuando exista Órdenes de
Trabajo para tironear de él, no antes.

## Estado del que se parte

Verificado sobre el repo, no recordado:

- **`app/page.tsx` no vive bajo `(app)`**, y no puede: el ápex entra por la
  misma ruta y no tiene sesión. Por eso llama a `exigirSesion()` por su cuenta
  y está declarado en `FUERA_DEL_GRUPO` de `test/rutas-con-guard.test.ts` con
  esa razón escrita.
- **Por lo tanto no hereda el shell de `app/(app)/layout.tsx`**, y hoy duplica
  una parte: renderiza `<Navegacion>` suelta, sin el header, sin el nombre del
  usuario en el mismo lugar, sin Salir.
- **`components/navegacion.tsx` existe porque tiene dos consumidores** — el
  layout del grupo y `app/page.tsx` —, y su comentario lo dice.
- **`usuario-nombre` existe en una sola pantalla**, `app/page.tsx`. Lo
  consumen `app/page.test.tsx` (presente en tenant, ausente en ápex) y
  `scripts/smoke.sh:320`.
- **Nadie consume `data-testid="stack"` ni `data-testid="sha"`.** Ningún test,
  ningún script. Su comentario los justifica como "la verificación humana más
  barata que existe después de un deploy", y el gate hoy compara `info.sha`
  del healthcheck por su cuenta.
- **`RUTAS_APP=('/')` está hardcodeado en `scripts/smoke.sh:390`**, no derivado
  de `scripts/lib/rutas-comun.sh`. El barrido abre cada ruta **sin `-L`** y
  exige 200 más el nombre del local.
- **`app/login/acciones.ts` termina en `redirect('/')`.**

## La decisión: `/` es un desvío, no una pantalla

| Quién llega a `/` | Qué pasa |
|---|---|
| Ápex (`arandano.app`) | El placeholder público. Sin cambios. |
| Tenant **sin** sesión | `exigirSesion()` → `/login`. Sin cambios. |
| Tenant **suspendido** | `forbidden()`. Sin cambios, y **antes** del redirect. |
| Tenant **con** sesión | `redirect('/vender')` |

Y `app/login/acciones.ts` pasa a `redirect('/vender')`, así se entra derecho.

**El orden importa y no es un detalle de estilo.** `forbidden()` va antes del
redirect: un tenant suspendido tiene que ver el 403 y no ser mandado a
`/vender` para que otra cosa lo rebote sin explicar por qué.

### Por qué redirigir y no renderizar

La alternativa evaluada era que `/` renderizara el punto de venta con el shell
compartido. No toca el gate —`/` seguiría devolviendo 200 con sus marcadores—
pero deja **la misma pantalla en dos URLs**. La barra de direcciones dejaría de
decir en qué pestaña estás, y "cuál es la canónica" es una pregunta que vuelve
cada vez que alguien toque la navegación.

Se prefirió pagar una vez el costo en el gate y quedarse con un modelo sin
ambigüedad. El costo es acotado y está enumerado más abajo; la ambigüedad
hubiera sido permanente y silenciosa.

### Lo que esto simplifica

El shell queda con **un solo consumidor**. `components/navegacion.tsx` deja de
tener el motivo que lo puso en `components/` —dos consumidores— y se queda
igual donde está por dos razones nuevas: pasa a ser componente de cliente, y es
el punto de extensión que CLAUDE.md ya promete para el registry de módulos.
El comentario del archivo se actualiza para decir eso, en vez de seguir
explicando un motivo que dejó de valer.

## La navbar

```
┌────────────────────────────────────────────────────────────────┐
│  Celulares Flor                            Ana · Dueño   Salir │
├────────────────────────────────────────────────────────────────┤
│  Vender    Ventas    Inventario    Usuarios     stage · 1b0104d│
│  ▔▔▔▔▔▔                                                        │
└────────────────────────────────────────────────────────────────┘
```

Dos filas con trabajos distintos: **identidad** arriba —de quién es esto, quién
sos, cómo salir—, **navegación** abajo.

- **El subrayado del activo va en `--primary`**, y no hace falta ningún token
  nuevo: `docs/sistema-de-diseno.md` ya declara que el arándano entra en
  acciones, foco y **selección**, y una pestaña activa es selección.
- **`Navegacion` pasa a ser componente de cliente**, porque el estado activo
  necesita `usePathname()`. No cuesta nada sin JavaScript: Next renderiza los
  componentes de cliente en el servidor para el HTML inicial, así que el
  subrayado sale correcto en la primera carga, y cada navegación sin JS es una
  carga completa que vuelve a salir correcta.
- **El nombre del local deja de ser un link.** Hoy enlaza a la home, y por eso
  la navegación no tiene "Inicio". Con la pestaña Vender a la vista, el link
  redundante pasa a ser el otro: el nombre del local queda como identidad,
  texto y nada más. **Cuidado al tocarlo**: `data-testid="tenant-nombre"` tiene
  que seguir siendo el último atributo, con el nombre como texto directo — el
  grep de `scripts/smoke.sh` busca el `>` pegado al nombre.
- **Usuarios sigue apareciendo sólo con rol `DUENO`.**
- **El Stack/Imagen va al final de la fila de pestañas**, chico y tenue.
  Sobrevive porque sigue siendo la verificación a ojo más barata después de un
  deploy, y ahora se ve desde cualquier pantalla en vez de sólo desde el home.
  **Se conservan `data-testid="stack"` y `data-testid="sha"`** aunque hoy no
  los lea nadie: cuestan nada, y el caso del layout que se suma más abajo pasa
  a leerlos, así que dejan de ser marcadores huérfanos.

### La pestaña activa se resuelve por prefijo

`/inventario/nuevo` y `/inventario/<id>` dejan **Inventario** subrayado;
`/ventas/<id>` deja **Ventas**. Con igualdad exacta, entrar al detalle de una
venta apagaría toda la navegación y parecería un bug.

`/vender` y `/ventas` no colisionan: son prefijos distintos. Vale dejarlo
escrito porque se parecen lo suficiente como para que alguien "arregle" el
matching a `startsWith('/vent')` alguna vez.

## Lo que toca el gate

| Qué | Cambio |
|---|---|
| `RUTAS_APP=('/')` | pasa a `RUTAS_APP=()`: `/` sale del barrido de 200 porque deja de devolver 200 |
| **nuevo** `caso_home_redirige_a_vender` | con sesión, `/` redirige a `/vender` |
| `caso_login_por_la_pantalla` | la aserción no cambia; el render incrustado ahora es `/vender` |
| `caso_home_responde` (ápex) | sin cambios |
| `caso_home_exige_sesion` | sin cambios |
| `scripts/lib/rutas-comun.sh` | **no se toca**: `/` nunca salió de ahí |

El caso nuevo no inventa mecanismo: `caso_home_exige_sesion` ya afirma un
redirect con `%{redirect_url}`.

**El gate queda más fuerte, no más débil.** Hoy `/` sólo prueba que algo
renderizó con el nombre del local; pasa a fijar el contrato real. Y
`usuario-nombre`, al mudarse al shell, deja de probarse en una pantalla y pasa
a probarse en todas las autenticadas: el barrido deja de decir sólo "el tenant
resolvió" y pasa a decir también "la sesión renderizó".

**El comentario de `caso_login_por_la_pantalla` se actualiza en el mismo
commit.** Hoy dice "el `redirect('/')` del final". Cambiar el código y dejar el
comentario es peor que un test roto: un test roto se ve.

## Tests

- **`app/page.test.tsx`** — los dos casos de tenant dejan de mirar HTML y pasan
  a afirmar que se llamó `redirect('/vender')`. El del ápex queda igual. El
  caso *"un dueño ve el link a /usuarios"* se muda al layout: dejó de ser un
  asunto del home.
- **`app/(app)/layout.test.tsx`** — gana `usuario-nombre`, el Stack/Imagen, y
  los dos casos de rol que llegan del home. **Pasa a necesitar el mock de
  `next/navigation`**: el layout renderiza `<Navegacion>`, que desde este ciclo
  llama a `usePathname()`. Sin el mock, este archivo se cae entero — y el
  síntoma no va a nombrar a la navegación, así que queda escrito acá.
- **Nuevo, para `Navegacion`** — la pestaña activa según `usePathname()`,
  mockeando `next/navigation`. Cubre las cuatro pestañas, el matching por
  prefijo con una ruta de detalle, y que `/vender` no active `Ventas`.
- **`test/rutas-con-guard.test.ts`** — sólo el texto de la razón de
  `app/page.tsx`: sigue siendo cierta —llama a `exigirSesion()` por su cuenta—
  pero ahora además redirige.

## Riesgo y deploy

Sin migraciones: el rollback sigue siendo puramente la imagen anterior.

Pero esto **modifica código que ya está en uso** —el destino del login y la
navegación de todas las pantallas—, que según CLAUDE.md es la categoría
peligrosa, no la de una pantalla nueva en una ruta nueva. Sale como **MINOR**.

El modo de falla que más importa vigilar es un bucle de redirects: si
`/vender` alguna vez redirigiera a `/`, el par se realimenta. Hoy no lo hace
—`/vender` está bajo `(app)` y sólo exige sesión—, y `caso_home_redirige_a_vender`
afirma un único salto con destino explícito, así que el bucle se vería en el
gate antes que en producción.

## Descartado

- **Un tablero con los números del día** (vendido hoy, cantidad de ventas,
  stock bajo). Es la respuesta genérica a "qué va en el home" y no es lo que
  este producto necesita: quien abre el local a las 9 va a cobrar, no a leer.
  Además, **`Articulo` no tiene stock mínimo** —verificado en el schema—, así
  que un panel de "stock bajo" pedía o un umbral inventado o una columna nueva,
  o sea una migración al servicio de un widget.
- **Navbar abajo, con targets grandes.** Tiene sentido en una tablet táctil;
  acá se opera con PC y teclado en el mostrador, así que la navbar va arriba y
  compacta.
- **Pestaña por defecto según el rol** (empleado a Vender, dueño a Ventas).
  Son dos caminos que mantener y probar a cambio de poco: el dueño llega a
  Ventas con un click.
- **Que el nombre del local siga enlazando a `/`.** Funcionaría, pero gasta un
  salto de servidor en cada click para llegar al mismo lugar que la pestaña
  Vender que está al lado.

## Verificación

Lo mecánico lo cubren los tests y el gate. Lo que **ningún test puede
responder** y queda para una persona, sobre el canario en producción después
del deploy:

- Que el subrayado de la pestaña activa se distinga de un vistazo, y que se
  distinga también del anillo de foco cuando se navega con teclado.
- Que entrar al sistema y caer en Vender se sienta bien y no como haberse
  salteado algo.

Es la misma clase de pendiente que el ciclo del sistema de diseño ya dejó
anotada, y por el mismo motivo.
