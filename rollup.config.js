import { nodeResolve } from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import html from 'rollup-plugin-html';
import postcss from 'rollup-plugin-import-css';

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

const commonConfig = {
  input: 'src/index.ts',
  external: ['@primer-io/checkout-web'],
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
