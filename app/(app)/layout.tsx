import { exigirSesion } from '@/lib/auth/sesion'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-medium">{sesion.tenant.nombre}</span>
        <span className="text-sm text-muted-foreground">
          {sesion.usuario.nombre} · {sesion.usuario.rol === 'DUENO' ? 'Dueño' : 'Empleado'}
        </span>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
