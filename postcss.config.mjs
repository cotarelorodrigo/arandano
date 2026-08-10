// Tailwind v4 se conecta por PostCSS y ya no necesita tailwind.config.js: la
// configuración del tema vive en el CSS, en app/globals.css.
const config = { plugins: { '@tailwindcss/postcss': {} } }
export default config
