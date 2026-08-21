import estilos from './encabezado.module.css'

/**
 * La franja de 66 px que abre las diez pantallas de la aplicación.
 *
 * La geometría sale de design/arandano.pen: `Topbar [fill x 66] fill:$ar-surface
 * pad:[0,28]`. Es la misma en las diez, y por eso es un componente y no un
 * bloque copiado: un padding distinto en una pantalla se ve como un salto al
 * navegar entre ellas.
 *
 * El <h1> paga Archivo (encabezado.module.css) porque el nodo Título > H1 del
 * Topbar lo pide en el .pen — no la pila del sistema que documentaba antes
 * docs/sistema-de-diseno.md, corregido en el mismo ciclo que este componente.
 * El subtítulo se queda en la pila del sistema: el nodo Sub del mismo frame
 * pide $ar-font, no $ar-display.
 *
 * Renderiza EL <h1> de la pantalla. La que lo use no puede tener otro.
 */
export function Encabezado({
  titulo,
  subtitulo,
  acciones,
}: {
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  acciones?: React.ReactNode
}) {
  return (
    <header className="flex h-[66px] shrink-0 items-center justify-between gap-6 border-b bg-card px-7">
      <div className="min-w-0">
        <h1 className={`${estilos.titulo} truncate text-foreground`}>{titulo}</h1>
        {/* Condicional y no un <p> siempre presente: sin subtítulo, un párrafo
            vacío corre el título hacia arriba y la franja deja de leerse
            centrada. */}
        {subtitulo ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitulo}</p>
        ) : null}
      </div>
      {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
    </header>
  )
}
