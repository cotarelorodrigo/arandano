// La página que Next renderiza cuando un componente de servidor llama a
// forbidden(). Antes del ciclo de permisos por usuario la alcanzaba sólo un
// tenant suspendido (app/page.tsx, app/login/page.tsx), y el copy afirmaba
// justamente eso. Desde ese ciclo la alcanzan además once guardas de permiso
// y siete server actions (`exigirPermiso`, en lib/permisos/guarda.ts) y las
// rutas que exigen dueño (`exigirDuenio`, en lib/auth/sesion.ts) — un
// EMPLEADO sin ARTICULOS_CREAR que entra a /inventario/nuevo termina acá
// también. El copy no puede afirmar ninguna causa puntual: tiene que quedar
// cierto para las dos a la vez, sin mentirle a nadie sobre por qué está viendo
// esto.
export default function Forbidden() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem' }}>
      <h1>No podés hacer esto</h1>
      <p>
        Tu usuario no tiene el permiso necesario para esta acción, o hay un problema con
        la cuenta del local que impide continuar. Hablá con el dueño del local para
        resolverlo.
      </p>
    </main>
  )
}
