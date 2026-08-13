import { Retrato } from './retrato'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import estilos from './cierre.module.css'

/**
 * Las secciones de la landing, en el orden en que se leen.
 *
 * El orden sigue el día de un local —abrís, vendés, reponés, cerrás— y no el
 * índice de features, que es lo que hace que una promesa amplia se lea concreta.
 *
 * Todas son server components sin estado: la única parte interactiva del sitio
 * es el formulario y el campo de "ya tengo cuenta".
 *
 * El ritmo vertical sale de `py-12` por sección, o sea 96 px entre bloques, sin
 * salirse del subconjunto de la escala que declara docs/sistema-de-diseno.md.
 */

const ANCHO = 'mx-auto w-full max-w-5xl px-6'

export function Cartel() {
  return (
    <section className={`${ANCHO} py-12`}>
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
        Abrís, vendés, cerrás la caja.
        <br />
        Arándano lleva la cuenta.
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
        Ventas, stock, caja en pesos y dólares, facturación y un bot que atiende por WhatsApp.
        Para cualquier negocio, en un solo lugar.
      </p>
      <div className="mt-8">
        <Button asChild size="lg">
          <a href="#contacto">Quiero que me muestren</a>
        </Button>
      </div>
    </section>
  )
}

const ANOTACIONES = [
  'El dólar entra con su cotización, y queda guardada con el pago.',
  'El lector de código de barras funciona sin instalar nada.',
  'Si tocás Cobrar dos veces, cobra una sola.',
]

export function Prueba() {
  return (
    <section className={`${ANCHO} py-12`}>
      <div className="grid gap-8 md:grid-cols-2">
        <Retrato />
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold">Así se cobra</h2>
          <ul className="space-y-4">
            {ANOTACIONES.map((texto) => (
              <li key={texto} className="border-l-2 border-primary pl-4 text-muted-foreground">
                {texto}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export function Direccion({ dominio }: { dominio: string }) {
  return (
    <section className={`${ANCHO} py-12`}>
      <h2 className="text-2xl font-semibold">Tu negocio tiene su dirección</h2>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        No sos un usuario más adentro de una aplicación ajena. Tu local entra por su propia
        dirección, y tus empleados entran ahí con su usuario y su contraseña.
      </p>
      {/* La barra de navegador. El nombre del local NO va en Archivo acá: es una
          URL, no un cartel — la fuente de display escribe el nombre pintado en el
          frente, y esto es la dirección escrita en un navegador. */}
      <div className="mt-6 max-w-md rounded-lg border bg-muted p-4 font-mono text-sm">
        https://florcelulares.{dominio}
      </div>
    </section>
  )
}

const CAPACIDADES = [
  ['Vender', 'Buscás, cobrás y entregás. Efectivo, transferencia o tarjeta, en pesos o en dólares.'],
  ['Reponer', 'Cada movimiento de stock queda firmado: quién, cuándo y por qué.'],
  ['Cerrar la caja', 'Apertura, cierre y arqueo del día, con las dos monedas por separado.'],
  ['Facturar', 'Comprobantes de ARCA desde la misma pantalla en la que cobrás.'],
  ['Atender', 'Un bot conectado a tu stock y a tus precios contesta por WhatsApp e Instagram.'],
  ['Mostrar', 'Tu catálogo público, con los precios y el stock que ya tenés cargados.'],
]

export function LoQueHace() {
  return (
    <section className={`${ANCHO} py-12`}>
      <h2 className="text-2xl font-semibold">Lo que hace</h2>
      <div className="mt-8 grid gap-8 md:grid-cols-3">
        {CAPACIDADES.map(([titulo, texto]) => (
          <div key={titulo}>
            <h3 className="font-medium">{titulo}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{texto}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const MODULOS = [
  ['Órdenes de trabajo', 'Ingreso, diagnóstico, presupuesto, aprobación y cierre. Service técnico, celulares, electricistas, refrigeración.'],
  ['Turnos', 'Agenda, disponibilidad y recordatorio automático. Peluquería, estética, consultorio, veterinaria, taller.'],
  ['Gastronomía', 'Mesas, comandas, pantalla de cocina y recetas que descuentan insumos. Bar, cafetería, restó, delivery.'],
]

export function Rubros() {
  return (
    <section className={`${ANCHO} py-12`}>
      <h2 className="text-2xl font-semibold">Cada rubro suma lo suyo</h2>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        Lo de arriba lo tiene cualquier negocio. Después, según lo que hagas, se activa lo que te falta.
      </p>
      <div className="mt-8 grid gap-8 md:grid-cols-3">
        {MODULOS.map(([titulo, texto]) => (
          <Card key={titulo}>
            <CardContent>
              <h3 className="font-medium">{titulo}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{texto}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

const PLANES = [
  ['Básico', 'Un usuario, una sucursal. Ventas, stock y caja.', false],
  ['Negocio', 'Varios usuarios y facturación de ARCA.', false],
  ['Profesional', 'Todo lo anterior, más el bot de WhatsApp e Instagram y los reportes.', true],
  ['Premium', 'Infraestructura dedicada y todo a medida.', false],
] as const

export function Planes() {
  return (
    <section className={`${ANCHO} py-12`}>
      <h2 className="text-2xl font-semibold">Planes</h2>
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        {PLANES.map(([nombre, texto, destacado]) => (
          <Card key={nombre} className={destacado ? 'bg-accent' : undefined}>
            <CardContent className="flex h-full flex-col">
              <h3 className="font-medium">{nombre}</h3>
              {destacado ? <p className="mt-1 text-xs text-primary">el más elegido</p> : null}
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{texto}</p>
              <Button asChild variant={destacado ? 'default' : 'secondary'} className="mt-4">
                <a href="#contacto">Consultar</a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

export function Cierre({ children }: { children: React.ReactNode }) {
  return (
    <section id="contacto" className={`${estilos.franja} py-12`}>
      <div className={ANCHO}>
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold text-foreground">
              Contanos de tu negocio
            </h2>
            <p className="mt-4 text-foreground/70">
              Te mostramos el sistema andando con tus productos y tus precios, y respondemos lo que
              haga falta antes de que decidas nada.
            </p>
            <p className={`${estilos.firma} mt-8`}>Arándano</p>
          </div>
          {children}
        </div>
      </div>
    </section>
  )
}
