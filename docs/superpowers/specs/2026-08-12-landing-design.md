# Spec: la landing del ápex

`arandano.app` resuelve al servidor desde el 2026-08-10 y sirve un stub: un
`<h1>` y la frase *"Acá va a vivir el sitio público"*. Este ciclo lo reemplaza
por la landing, que es la única superficie del producto que le habla a alguien
que todavía no es cliente.

La tesis es una sola y gobierna todo lo demás: **la página no ilustra el
producto, lo muestra**. El héroe es un fragmento real de la aplicación, armado
con los mismos componentes y el mismo formateo de plata que usa el mostrador. La
promesa es amplia —cualquier comercio argentino—, y una promesa amplia sin
prueba concreta es exactamente el "gestioná tu negocio" que no dice nada.

## Alcance

- `app/page.tsx`: la rama `apex` deja de ser un stub.
- `app/sitio/`: nuevo. `landing.tsx`, `secciones.tsx`, `retrato.tsx`,
  `formulario.tsx`, `acciones.ts`. **No crea ninguna ruta**: no hay `page.tsx`
  adentro.
- `app/opengraph-image.tsx`: nuevo.
- `lib/leads/`: nuevo. `guardar.ts`, `notificar.ts`.
- `prisma/schema.prisma` + migración aditiva: el modelo `Lead`.
- `scripts/setup-db-roles.sh`: el `REVOKE` por tabla de `leads`.
- `scripts/leads.mts` + `npm run leads`.
- `app/(app)/layout.tsx` y `app/login/page.tsx`: metadata `noindex`.
- `docs/sistema-de-diseno.md`: la enmienda de `--marca`.
- `test/rls-cobertura.test.ts`: la tercera entrada de `SIN_TENANT_ID`.

Ninguna pantalla de `app/(app)/**/page.tsx` cambia salvo por la metadata del
layout.

## Estado del que se parte

`app/page.tsx` rutea por resolución de tenant: `apex` renderiza `PaginaApex`,
`tenant` exige sesión y redirige a `/vender`, y el resto es 404 o 403. Ese
ruteo **no se toca**: lo que cambia es qué renderiza la rama `apex`.

Tres cosas del repo que condicionan el diseño y no son negociables desde acá:

1. **El registro público está apagado a propósito**
   (`app/api/auth/registro-publico.test.ts` lo afirma con el handler real).
   El alta de un tenant es manual, con `npm run tenant:crear`.
2. **Toda tabla del schema tiene `tenant_id`** y una policy `tenant_aislamiento`
   que falla cerrado. `test/rls-cobertura.test.ts` lo verifica, con un mapa
   `SIN_TENANT_ID` escrito a mano para que una excepción sea visible en el diff.
3. **El sistema de diseño está atado en las dos direcciones**
   (`test/sistema-de-diseno.test.ts`, `test/contraste.test.ts`): un color que
   sólo viva en el CSS o sólo en el documento rompe el build.

## Las decisiones

Van con quién las tomó, para que dentro de tres meses no se lean como
inevitables.

### 1. La conversión es un lead guardado, no un click a WhatsApp

El visitante deja nombre, mail, WhatsApp opcional, rubro y mensaje opcional. Se
guarda una fila y se dispara un aviso.

**Por qué no self-service.** El alta instantánea de tenant que promete
`CLAUDE.md` existe como arquitectura, no como flujo público: reabrir el registro
exige elegir subdominio, limitar, cobrar y sembrar datos demo. Es su propio
ciclo, y hacerlo apurado para tener un botón en la landing es la peor versión de
las dos cosas.

**Por qué no sólo `wa.me`.** Un link a WhatsApp no deja rastro: si nadie
contesta a tiempo, el interesado no existió nunca. La fila sí queda.

### 2. La promesa es horizontal

El titular le habla a cualquier comercio argentino, no al local de celulares.
Decisión de Rodrigo, contra la recomendación de arrancar por el rubro validado.

**Lo que eso obliga.** Una promesa amplia es más vaga por definición, así que la
página compensa con concreción en otro lado: el retrato del producto (pieza 3),
la dirección propia (pieza 4) y los módulos por rubro (pieza 6) están ahí
justamente para que "para cualquier negocio" no quede en el aire.

### 3. La landing describe el producto completo, incluido lo que no existe

Hoy están construidos ventas, inventario, usuarios y autenticación. Caja, ARCA,
catálogo público, bot y los tres módulos **no**. La landing igual los nombra,
**sin marcar cuáles faltan**. Decisión de Rodrigo, tomada sobre la alternativa
de marcar lo pendiente con un "en camino" sobrio.

**El riesgo, escrito para que sea revisable y no una sorpresa**: el interesado
llega a la demo esperando lo que leyó. Lo que lo mitiga es que la conversión es
una conversación con vos —no un alta automática—, así que hay alguien
calibrando expectativas antes de que nadie firme nada.

**Lo que el riesgo no toca**: la pieza 3 sólo puede retratar pantallas que
existen. La prueba dura de la página sigue siendo honesta aunque el texto
prometa más, y eso no es casualidad: es el único límite que este diseño le pone
a la decisión.

**Qué la haría caducar**: el primer interesado que se dé de baja en la demo por
un hueco que la landing no anticipó.

### 4. Los cuatro planes, sin precio

Básico, Negocio, Profesional (destacado, "el más elegido") y Premium, cada uno
con lo que incluye. El precio se conversa. Evita mantener números que la
inflación mueve; el costo aceptado es que el que necesita saber si le entra en
el presupuesto se va sin saberlo.

### 5. El enfoque: el mostrador

Elegido sobre dos alternativas, que quedan anotadas porque volver a discutirlas
sin saber que ya se discutieron es la forma más cara de decidir:

- **La persiana en el ápex** —el gesto del login abriendo el dominio—: máxima
  continuidad de marca, pero deja el producto en segundo plano justo cuando la
  promesa amplia es la que más prueba necesita, y obliga a reescribir la regla
  de `--marca` de entrada en vez de al final.
- **La cinta de papel** como hilo conductor vertical: distintiva y barata, pero
  decorativa. Por el criterio que ya rigió en el ciclo del shell, un gesto
  decorativo no paga una regla escrita.

## Dónde vive y cómo se renderiza

**La landing se queda en `app/page.tsx`.** El ápex llega por DNS y no por path:
no hay forma de moverlo a otra ruta, y eso ya está escrito en el archivo. Lo que
entra es composición: `PaginaApex` pasa a renderizar `<Landing />` desde
`app/sitio/`.

**`app/sitio/` no crea ruta.** Sólo `page.tsx`, `route.ts` y `layout.tsx` crean
rutas en el App Router; un directorio con componentes y un `acciones.ts` no.
Colocar así es la convención que ya usan `inventario` y `ventas`
(`formularios.tsx` + `acciones.ts`), aplicada a una superficie que no es una
ruta.

**Sigue siendo dinámico.** `app/page.tsx` lee `headers()` para saber de quién es
el request, y eso obliga a render dinámico — con la razón ya escrita en el
archivo: una página de tenant cacheada y servida a otro tenant es una fuga entre
clientes. La landing en sí **no consulta la base** (el ápex ni siquiera llega a
`resolverTenant`), así que el costo es CPU de render y no un ida y vuelta a
Postgres.

**Indexación.** Hoy nada impide que Google indexe el punto de venta de un
cliente. Entra:

- `metadata.robots = { index: false, follow: false }` en `app/(app)/layout.tsx`
  y en `app/login/page.tsx`.
- Metadata de marketing —`title`, `description`, Open Graph— sólo en la rama
  apex, vía `generateMetadata` en `app/page.tsx`, que ya resuelve tenant y por
  lo tanto puede distinguir.

No se agrega `robots.txt`: sería el mismo archivo para el ápex y para todos los
subdominios, que es justo la distinción que hay que hacer.

## La página, pieza por pieza

Ocho piezas, una sola página, cero rutas nuevas. El orden sigue el día de un
local, no el índice de features.

### 1. Barra

`Arándano` chico a la izquierda —la plataforma firma chico, igual que en el
login— y a la derecha **Ya tengo cuenta**: un campo donde se tipea el nombre del
negocio y un botón que manda a `https://<eso>.arandano.app`. Es la respuesta a
la pregunta más frecuente que este dominio va a recibir: el cliente que no se
acuerda de que su sistema no vive acá. Es navegación del navegador, no una
consulta a la base: si el subdominio no existe, contesta el 404 que ya existe.

### 2. El cartel

```
Abrís, vendés, cerrás la caja.
Arándano lleva la cuenta.

Ventas, stock, caja en pesos y dólares, facturación y un bot
que atiende por WhatsApp. Para cualquier negocio, en un solo lugar.

[ Quiero que me muestren ]
```

Los verbos del oficio y no la palabra "gestión". Sin imagen de fondo, sin gente
sonriendo con una tablet. El botón baja al formulario de la pieza 8.

### 3. La prueba

El corazón del enfoque: un fragmento **real** del punto de venta —carrito con
dos artículos, pago partido en pesos y dólares con su cotización, vuelto
calculado, el total grande— armado con los componentes de `components/ui` y el
`formatearPrecio` de `lib/formato/mostrar.ts` que usa la pantalla de verdad. No
es una captura PNG (se pudre en silencio y se ve borrosa en pantalla densa) ni
markup inventado (dibujaría un producto que no existe).

Tres anotaciones cortas alrededor, que dicen lo que la imagen no dice:

- el dólar entra con su cotización, y queda guardada con el pago;
- el lector de código de barras funciona sin instalar nada;
- si tocás **Cobrar** dos veces, cobra una sola.

**Dependencia real, y es la única del ciclo**: el punto de venta se está por
rediseñar (`docs/superpowers/plans/2026-08-12-punto-de-venta.md`, escrito y sin
implementar). Retratar una pantalla que está por cambiar es nacer con deuda, así
que **la landing va después de la cinta**. Si hubiera que adelantarla, el
retrato lo hace el inventario, que está estable — y eso es un cambio de un
archivo, `retrato.tsx`.

### 4. Tu negocio tiene su dirección

`flor.arandano.app` dibujado como una barra de navegador. Es lo más concreto que
el producto tiene para alguien que nunca usó un SaaS: no sos un usuario más
adentro de una app ajena, tenés una dirección tuya. Es además el lugar donde
Archivo aparece bajo la regla vigente, escribiendo el nombre de un local (ver
*Tipografía*).

### 5. Lo que hace

Bloques de una línea con el vocabulario del oficio, no con sustantivos de
software: vender, reponer, cerrar la caja, facturar, atender por WhatsApp. Sin
íconos genéricos de librería.

### 6. Cada rubro suma lo suyo

Órdenes de trabajo, turnos y gastronomía, con los rubros que habilita cada uno.
Es lo que sostiene la promesa horizontal de la decisión 2.

### 7. Planes

Los cuatro, sin precio, con qué incluye cada uno. Profesional destacado con
`--accent` y la etiqueta "el más elegido". El botón de los cuatro baja al mismo
formulario.

### 8. El cierre y el pie

Franja de `--marca` a sangre, y encima una `Card` blanca con el formulario:
nombre, mail, WhatsApp opcional, rubro, mensaje opcional. Debajo, el link a
WhatsApp para el que no quiere esperar. Es el único lugar de la página donde el
color de marca entra como superficie, y cierra el arco que abre el login: el
producto muestra, la marca firma.

## La captura del lead

### El modelo

```prisma
model Lead {
  id       String   @id @default(uuid(7)) @db.Uuid
  nombre   String
  email    String
  whatsapp String?
  rubro    String
  mensaje  String?
  creadoEn DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  @@map("leads")
}
```

`uuid(7)` y `Timestamptz(3)` no son elecciones nuevas: es lo que usa todo el
schema, y el v7 ordena por tiempo, que es exactamente cómo se van a leer estas
filas.

**Sin `tenant_id`, y es la primera tabla del schema que no lo tiene.** Un
interesado no es cliente de nadie todavía: no hay tenant al que pertenezca, y
inventarle uno sería peor que la excepción. Eso la convierte en la tercera
entrada de `SIN_TENANT_ID` en `test/rls-cobertura.test.ts`, con su razón escrita
al lado — que es exactamente para lo que ese mapa existe.

`rubro` es texto y no un enum: los rubros son ilimitados por diseño (son
presets, no código), y un enum obligaría a una migración cada vez que alguien
escriba "florería".

### Append-only para la aplicación

Sin `tenant_id` no hay policy de aislamiento que proteja esta tabla, así que
`arandano_app` quedaría pudiendo leer la lista entera de interesados. Se cierra
con el patrón que `scripts/setup-db-roles.sh` ya usa para `movimientos_stock`,
un paso más lejos:

```sql
REVOKE SELECT, UPDATE, DELETE ON public.leads FROM arandano_app;
```

La aplicación **sólo inserta**. Va con el mismo guard `IF EXISTS` que el
`REVOKE` de `movimientos_stock`, por el mismo motivo: el script corre también
contra una base donde la tabla todavía no existe.

**Consecuencia que hay que respetar en el código, y muerde**: `prisma.lead
.create()` emite `INSERT ... RETURNING`, y `RETURNING` exige `SELECT` sobre las
columnas devueltas. Con el `REVOKE` puesto, `create()` **falla**. El alta usa
`createMany`, que devuelve un contador y no una fila. Queda escrito acá porque
el error que produce ("permission denied for table leads") apunta al `INSERT` y
manda a investigar en la dirección equivocada.

### Leerlos

`npm run leads` → `tsx scripts/leads.mts`, conectando con
`MIGRATE_DATABASE_URL` igual que `tenant:crear` y `usuario:clave`. Lista los
últimos N con fecha, nombre, mail, WhatsApp y rubro.

### El aviso

`lib/leads/notificar.ts` expone `notificarLead(lead)` detrás de una interfaz,
mismo criterio que `billing/emitirFactura()`: hoy el adaptador escribe un log
estructurado, y el de la Cloud API de Meta entra cuando exista la cuenta, sin
tocar la landing.

**El estado real hoy**: hay un WhatsApp Business común, no la Cloud API. Dar de
alta un Tech Provider, un número dedicado y una plantilla aprobada es un trámite
externo que puede tardar más que la landing entera — por eso la costura, y por
eso el `wa.me` de la pieza 8 como salida directa mientras tanto.

**El aviso nunca voltea el alta.** La fila se guarda primero; el aviso se
intenta después y, si falla, se loguea. Un visitante no puede ver un error
porque un mensaje no salió.

### Antispam

Dos capas, las dos baratas:

- **Honeypot**: un campo oculto que un bot completa y una persona no. Si viene
  lleno, la respuesta es la misma pantalla de gracias y no se guarda nada — un
  bot que recibe un error aprende.
- **Límite por IP en memoria del proceso**: 5 envíos por hora. Se resetea en
  cada deploy y **no sirve si algún día hay dos instancias**, que es
  precisamente el escenario que `CLAUDE.md` tiene anotado como "sumar Redis es
  una decisión consciente, no un default". Escrito acá para que el día que haya
  una segunda instancia esto aparezca como deuda y no como misterio.

No hay captcha: mete un tercero en el camino del único formulario que convierte.

## Lo visual

### Tipografía

El titular va en la pila del sistema, grande y en 600. **Archivo no se toca**, y
no por disciplina abstracta: la regla dice que Archivo escribe *el nombre de un
local*, y la landing tiene dos lugares donde aparece exactamente eso — la barra
de navegador de la pieza 4 y el cartel del header dentro del retrato de la pieza
3. Ahí Archivo entra **bajo la regla vigente**, sin enmienda.

Si el titular de Arándano fuera en Archivo, la plataforma se estaría poniendo el
cartel del cliente — lo contrario de la jerarquía que el login declaró y que el
shell sostiene.

### Color, y la enmienda

Neutros, `--primary` en botones y links, `--accent` en el plan destacado, y
`--marca` sólo en la franja de cierre.

`docs/sistema-de-diseno.md`, sección *El arándano como superficie*, pasa de "el
login y nada más" a:

> `--marca` es el color de las **superficies de marca** —la pantalla de login y
> la franja de cierre del sitio público—, nunca de la aplicación.

La razón no cambia y ya está escrita: la contención existe porque una pantalla
de trabajo se mira ocho horas, y ni el login ni una landing se miran ocho horas.
**La condición que la hace caducar** va escrita igual que la anterior: si
aparece una tercera superficie de marca, se vuelve a discutir la regla en vez de
estirar la excepción una vez más.

**La enmienda no cuesta contraste.** El formulario va en una `Card` blanca sobre
la franja, así que los únicos pares que la franja introduce
—`--primary-foreground` sobre `--marca` (14.33) y su `/70` (7.69)— ya están en
la tabla medidos. No entra ningún token nuevo, y `npm run contraste` no cambia
de salida.

### Espaciado: sin enmienda

La escala habilitada llega a 48 px y alcanza: `py-12` por sección da 96 px de
aire entre bloques, que es ritmo de landing. La regla del subconjunto queda
intacta.

### Movimiento

No hay. La persiana es del login y repetirla la gasta.

### Imagen social

`app/opengraph-image.tsx`, generada por Next con los mismos tokens, en vez de un
PNG a mano que se desincroniza del color de marca sin que nadie se entere.

### Responsive

Mobile primero. El retrato de la pieza 3 escala a un recorte más angosto en
lugar de producir scroll horizontal: una landing que se lee de costado en el
teléfono es una landing que no se lee.

## Cómo se verifica

| Qué | Cómo |
|---|---|
| El ápex renderiza la landing y no una página de tenant | `app/page.test.tsx`, extendiendo el caso que ya existe |
| El alta guarda el lead | `app/sitio/acciones.test.ts` contra la base efímera |
| El honeypot no guarda y no delata | mismo archivo: campo lleno → 0 filas, misma respuesta |
| El límite por IP corta al sexto envío | mismo archivo |
| `arandano_app` inserta y **no puede leer** | test de privilegios contra la base real: `INSERT` pasa, `SELECT` es rechazado |
| La tabla sin `tenant_id` es una decisión visible | tercera entrada de `SIN_TENANT_ID`, con razón |
| Si `notificarLead()` falla, el lead igual quedó | test con el adaptador rompiendo a propósito |
| Los subdominios no se indexan y el ápex sí | test sobre la metadata de `(app)`, `/login` y apex |
| El retrato usa el formateo real | test que ata la importación de `formatearPrecio` en `retrato.tsx` |
| La franja de marca no rompe contraste | `npm run contraste` y `test/contraste.test.ts`, sin pares nuevos |
| El documento de diseño y el CSS siguen diciendo lo mismo | `test/sistema-de-diseno.test.ts` — la enmienda es texto, no token |
| El diagrama de la base incluye `leads` | `scripts/generar-erd.sh`, que el hook de pre-commit y el paso 3 de `deploy.sh` ya verifican |
| El ápex responde en producción | `scripts/smoke.sh` ya tiene `caso_home_responde`; se le suma que el cuerpo trae el formulario |

## Fuera de alcance

Explícito, para que no se lea como olvido:

- **El alta self-service.** El registro público sigue apagado. Elegir
  subdominio, limitar el trial, cobrar y sembrar datos demo es su propio ciclo.
- **El adaptador real de WhatsApp.** La costura entra; el trámite con Meta no
  depende de este ciclo.
- **Mail al interesado.** No hay SMTP ni proveedor de envío en el repo, y sumarlo
  es dominio verificado, credenciales y reintentos.
- **Precios.** Los cuatro planes van sin número, por decisión 4.
- **Blog, casos de éxito, páginas por rubro.** Una sola página.
- **Analytics.** Sentry y el uptime check ya están en el roadmap de
  infraestructura; medir conversión es otra cosa y otro ciclo.
- **Términos, privacidad y datos personales.** El pie los va a necesitar cuando
  haya clientes reales; hoy no hay texto legal escrito y redactarlo no es este
  trabajo.
- **Modo oscuro.** Sigue sin existir en todo el producto.

## Orden

1. La cinta (`docs/superpowers/plans/2026-08-12-punto-de-venta.md`), que ya está
   planificada. La landing la retrata.
2. Este ciclo.

**2026-08-12.**
