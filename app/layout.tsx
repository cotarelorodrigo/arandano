import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NegocioFácil",
  description: "Plataforma de gestión para negocios argentinos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
