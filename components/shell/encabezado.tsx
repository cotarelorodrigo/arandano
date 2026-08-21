/**
 * La franja de 66 px que abre las diez pantallas de la aplicación.
 *
 * La geometría sale de design/arandano.pen: `Topbar [fill x 66] fill:$ar-surface
 * pad:[0,28]`. Es la misma en las diez, y por eso es un componente y no un
 * bloque copiado: un padding distinto en una pantalla se ve como un salto al
 * navegar entre ellas.
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
        <h1 className="truncate text-xl font-semibold text-foreground">{titulo}</h1>
        {/* Condicional y no un <p> siempre presente: sin subtítulo, un párrafo
            vacío corre el título hacia arriba y la franja deja de leerse
            centrada. */}
        {subtitulo ? (
          <p className="truncate text-[13px] text-muted-foreground">{subtitulo}</p>
        ) : null}
      </div>
      {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
    </header>
  )
}
