/**
 * Qué stack y qué imagen está corriendo.
 *
 * La verificación humana más barata que existe después de un deploy: se abre
 * cualquier pantalla y se lee. El gate compara `info.sha` del healthcheck por
 * su cuenta, así que esto no lo reemplaza — lo complementa para quien está
 * mirando y no quiere abrir una consola.
 *
 * Vive en components/ porque lo usan dos pantallas que no comparten layout: el
 * shell de la aplicación y el placeholder del ápex (app/page.tsx), que no
 * puede estar bajo (app) porque no tiene sesión.
 */
export function Contexto({ className }: { className?: string }) {
  return (
    <p className={className}>
      <span data-testid="stack">{process.env.ARANDANO_STACK ?? 'desconocido'}</span>
      {' · '}
      <span data-testid="sha">{process.env.GIT_SHA ?? 'dev'}</span>
    </p>
  )
}
