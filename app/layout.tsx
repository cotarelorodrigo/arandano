import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Archivo, de Omnibus-Type (Buenos Aires). La cara de display, y la única
 * fuente propia del proyecto.
 *
 * POR QUÉ EXISTE, cuando docs/sistema-de-diseno.md eligió la pila del sistema
 * a conciencia: esa decisión sigue en pie para toda la aplicación —cero bytes
 * en las pantallas que se miran ocho horas— y esta fuente no la toca. Entra en
 * un solo lugar, el nombre del local en la pantalla de login, que es el único
 * momento de marca que tiene el producto: lo que sigue después es una
 * herramienta. El eje de ancho (`wdth`) es el motivo de la elección — un local
 * argentino tiene el nombre pintado en el frente, y la versión expandida es lo
 * que se parece a eso y no a un título de aplicación.
 *
 * EL COSTO, escrito para que se pueda revisar: 90 KB de woff2, sólo el subset
 * latin (cubre el español entero, ñ y acentos incluidos; un nombre con un
 * carácter fuera de U+0000–00FF cae en la pila del sistema para ese glifo, que
 * es una degradación aceptable). Se sirve desde el propio dominio —nada de
 * fonts.gstatic.com en runtime—, con `display: swap`, y `next/font/local` le
 * pone el preload. La descarga ocurre en el login, no en el punto de venta.
 *
 * `declarations` con `font-stretch` no es opcional: sin ese descriptor el eje
 * de ancho no se activa y `font-stretch: 112%` en la pantalla no hace nada.
 */
const archivo = localFont({
  src: "./fuentes/archivo-latin-var.woff2",
  variable: "--font-archivo",
  display: "swap",
  weight: "100 900",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

export const metadata: Metadata = {
  title: "Arándano",
  description: "Plataforma de gestión para negocios argentinos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
