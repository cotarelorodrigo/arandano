import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Necesario para la imagen Docker: genera .next/standalone con un
  // server.js autocontenido y sólo las dependencias que se usan.
  output: 'standalone',
  experimental: {
    // Habilita forbidden() de next/navigation, que es lo que permite responder
    // 403 desde un componente de servidor. Un tenant suspendido tiene que
    // recibir 403 y no 404: el 404 le dice que su negocio no existe, el 403 le
    // dice que hay que pagar. Confusión cara, y un llamado de soporte asustado.
    authInterrupts: true,
  },
}

export default nextConfig
