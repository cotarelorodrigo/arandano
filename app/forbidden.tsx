// La página que Next renderiza cuando un componente de servidor llama a
// forbidden(). Hoy sólo la alcanza un tenant suspendido.
export default function Forbidden() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem' }}>
      <h1>Cuenta suspendida</h1>
      <p>
        Esta cuenta está suspendida y no se puede usar en este momento. Los datos
        están intactos: se reactiva al regularizar el pago.
      </p>
    </main>
  )
}
