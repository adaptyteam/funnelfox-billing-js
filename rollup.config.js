import { nodeResolve } from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import html from 'rollup-plugin-html';
import postcss from 'rollup-plugin-import-css';
import { cpSync } from 'node:fs';
import path from 'node:path';

const packageJson = {
  name: '@funnelfox/billing',
  version: '0.1.0',
};

const banner = `/**
 * ${packageJson.name} v${packageJson.version}
 * JavaScript SDK for Funnelfox billing with Primer integration
 * 
 * @author Funnelfox
 * @license MIT
 */`;

const primerCheckoutModule = path.resolve(
  'src/utils/primer-checkout-module.ts'
);

// The UMD build runs without a bundler, so it imports primer-js from files shipped next to the SDK script.
function umdPrimerCheckoutSource() {
  return {
    name: 'umd-primer-checkout-source',
    async resolveId(source, importer, options) {
      if (!source.endsWith('/primer-checkout-module')) {
        return null;
      }
      const resolved = await this.resolve(source + '.ts', importer, {
        ...options,
        skipSelf: true,
      });
      if (resolved?.id !== primerCheckoutModule) {
        return null;
      }
      return primerCheckoutModule.replace(/\.ts$/, '.umd.ts');
    },
  };
}

function copyPrimerCheckout() {
  const source = path.resolve('node_modules/@primer-io/primer-js');
  return {
    name: 'copy-primer-checkout',
    writeBundle() {
      const target = path.resolve('dist/primer-js');
      cpSync(
        path.join(source, 'dist/primer-loader.js'),
        path.join(target, 'primer-loader.js')
      );
      cpSync(path.join(source, 'dist/chunks'), path.join(target, 'chunks'), {
        recursive: true,
      });
      cpSync(path.join(source, 'LICENSE.md'), path.join(target, 'LICENSE.md'));
    },
  };
}

const commonConfig = {
  input: 'src/index.ts',
  external: ['@primer-io/checkout-web', '@primer-io/primer-js'],
  plugins: [
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: false,
      declaration: false,
      noEmitOnError: false,
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),
    babel({
      babelHelpers: 'bundled',
      exclude: 'node_modules/**',
      presets: [
        [
          '@babel/preset-env',
          {
            targets: {
              browsers: ['> 1%', 'last 2 versions', 'not dead'],
            },
            modules: false,
          },
        ],
      ],
    }),
    html(),
    postcss({
      inject: true,
    }),
  ],
};

export default [
  // UMD build for browser usage
  {
    ...commonConfig,
    plugins: [
      umdPrimerCheckoutSource(),
      ...commonConfig.plugins,
      copyPrimerCheckout(),
    ],
    output: {
      file: 'dist/funnelfox-billing.js',
      format: 'umd',
      name: 'FunnelfoxSDK',
      inlineDynamicImports: true,
      banner,
      globals: {
        '@primer-io/checkout-web': 'Primer',
      },
    },
  },

  // UMD minified build
  {
    ...commonConfig,
    output: {
      file: 'dist/funnelfox-billing.min.js',
      format: 'umd',
      name: 'FunnelfoxSDK',
      inlineDynamicImports: true,
      banner,
      globals: {
        '@primer-io/checkout-web': 'Primer',
      },
    },
    plugins: [
      umdPrimerCheckoutSource(),
      ...commonConfig.plugins,
      terser({
        format: {
          comments: /^!/,
        },
      }),
    ],
  },

  // ES Module build
  {
    ...commonConfig,
    output: {
      format: 'es',
      dir: 'dist',
      entryFileNames: 'funnelfox-billing.esm.js',
      chunkFileNames: 'chunk-[name].[format].js',
      assetFileNames: 'chunk-[name].[format].[ext]',
      banner,
    },
  },

  // CommonJS build
  {
    ...commonConfig,
    output: {
      format: 'cjs',
      dir: 'dist',
      entryFileNames: 'funnelfox-billing.cjs.js',
      chunkFileNames: 'chunk-[name].[format].js',
      assetFileNames: 'chunk-[name].[format].[ext]',
      banner,
      exports: 'auto',
    },
  },
];
