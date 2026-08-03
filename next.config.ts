import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Necesario para la imagen Docker: genera .next/standalone con un
  // server.js autocontenido y sólo las dependencias que se usan.
  output: 'standalone',
}

export default nextConfig
