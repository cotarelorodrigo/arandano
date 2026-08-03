// Verificación humana más barata que existe: saber de un vistazo qué
// imagen está corriendo en qué stack.
export const dynamic = 'force-dynamic'

export default function Home() {
  const stack = process.env.ARANDANO_STACK ?? 'desconocido'
  const sha = process.env.GIT_SHA ?? 'dev'

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem' }}>
      <h1>Arándano</h1>
      <dl>
        <dt>Stack</dt>
        <dd data-testid="stack">{stack}</dd>
        <dt>Imagen</dt>
        <dd data-testid="sha">{sha}</dd>
      </dl>
    </main>
  )
}
