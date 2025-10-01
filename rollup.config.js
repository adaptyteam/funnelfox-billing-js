import { nodeResolve } from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';

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
  input: 'src/index.js',
  external: ['@primer-io/checkout-web'],
  plugins: [
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
      file: 'dist/funnelfox-billing.esm.js',
      format: 'es',
      banner,
    },
  },

  // CommonJS build
  {
    ...commonConfig,
    output: {
      file: 'dist/funnelfox-billing.cjs.js',
      format: 'cjs',
      banner,
      exports: 'auto',
    },
  },
];
