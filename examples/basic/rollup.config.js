import path from 'path';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import importCss from 'rollup-plugin-import-css';
import htmlTemplate from 'rollup-plugin-generate-html-template';
import fs from 'fs';
import { fileURLToPath } from 'url';

const basicDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(basicDir, 'dist');

export default [
  {
    input: path.join(basicDir, 'script.js'),
    output: {
      //file: path.join(outDir, 'bundle.js'),
      dir: outDir,
      entryFileNames: 'script-[hash].js',
      chunkFileNames: '[name]-[hash].[format].js',
      assetFileNames: '[name]-[hash].[format].[ext]',
      format: 'es',
      sourcemap: true,
    },
    plugins: [
      resolve(),
      importCss(),
      terser(),
      {
        name: 'copy-basic-styles',
        generateBundle() {
          const src = path.join(basicDir, 'styles.css');
          const dest = path.join(outDir, 'styles.css');
          if (fs.existsSync(src)) {
            fs.mkdirSync(outDir, { recursive: true });
            fs.copyFileSync(src, dest);
          }
        },
      },
      htmlTemplate({
        template: path.join(basicDir, 'index.html'),
        target: path.join(outDir, 'index.html'),
      }),
    ],
  },
];
