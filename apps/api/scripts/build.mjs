// Gera dist/server.js com esbuild. Dependências npm ficam externas (instaladas em produção);
// o pacote @reformar/shared e o client Prisma gerado são embutidos no bundle.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {})
  .filter((d) => d !== '@reformar/shared')
  .flatMap((d) => [d, `${d}/*`]);

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.js',
  sourcemap: true,
  external,
  banner: {
    // Compatibilidade para dependências CommonJS dentro do bundle ESM.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
