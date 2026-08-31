import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Los worktrees viven adentro del repo (.claude/worktrees/<rama>/), así que
    // sin esto `eslint` sin argumentos entra a cada checkout de rama y lintea
    // su `generated/` de Prisma: 588 errores y 9406 warnings que no son del
    // código de nadie. Se descubrió cuando el paso 5/18 del gate voló un deploy
    // a producción corrido desde /root/arandano con una rama en curso — que es
    // el estado NORMAL, porque CLAUDE.md manda trabajar siempre en un worktree
    // aparte. Los ensayos nunca lo vieron: corren desde adentro del worktree,
    // donde este directorio no existe.
    ".claude/**",
    // Mismo caso que la línea de arriba, con otro origen: las skills de
    // herramientas se instalan en .agents/skills/<skill>/ y traen sus propios
    // scripts .js, que no son código de este repo y no siguen su configuración
    // (CommonJS, `require`, sin tipos). Sin esto, `eslint` sin argumentos los
    // levanta y `npm run lint` —el paso 5 del gate— falla con ~95 errores que
    // nadie escribió. Se descubrió al instalar las skills de Kapso y LangChain
    // para el ciclo del bot de WhatsApp.
    ".agents/**",
  ]),
]);

export default eslintConfig;
