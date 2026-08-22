/**
 * Build config for electron renderer process
 */
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import DtsBundleWebpack from 'dts-bundle-webpack';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import path from 'path';
import TerserPlugin from 'terser-webpack-plugin';
import * as TJS from 'typescript-json-schema';
import webpack from 'webpack';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import { merge } from 'webpack-merge';
import checkNodeEnv from '../scripts/check-node-env';
import deleteSourceMaps from '../scripts/delete-source-maps';
import baseConfig, { createTypeScriptRule } from './webpack.config.base';
import webpackPaths from './webpack.paths';

class GenerateJsonSchemaPlugin {
  constructor(
    private options: {
      inFile: string;
      outFile: string;
      type: string;
      workingDirectory: string;
    },
  ) {}

  apply(compiler: any) {
    compiler.hooks.beforeCompile.tap('GenerateJsonSchemaPlugin', () => {
      const { inFile, outFile, type, workingDirectory } = this.options;
      const program = TJS.getProgramFromFiles(
        [inFile],
        {
          strictNullChecks: true,
          skipLibCheck: true,
        },
        workingDirectory,
      );
      const schema = TJS.generateSchema(program, type, {
        required: true,
        noExtraProps: true,
        aliasRef: true,
      });
      const outDir = path.dirname(outFile);
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      writeFileSync(outFile, JSON.stringify(schema, null, 2));
    });
  }
}

class VerifyRendererLazyChunksPlugin {
  private readonly lazyModuleNames = [
    'ModManagerLogs.tsx',
    'ModManagerPlugins.tsx',
    'ModManagerSettings.tsx',
  ];

  apply(compiler: webpack.Compiler) {
    compiler.hooks.compilation.tap(
      'VerifyRendererLazyChunksPlugin',
      (compilation) => {
        if (compilation.compiler !== compiler) return;
        compilation.hooks.afterOptimizeChunks.tap(
          'VerifyRendererLazyChunksPlugin',
          () => {
            for (const lazyModuleName of this.lazyModuleNames) {
              const chunks = new Set<webpack.Chunk>();
              for (const candidate of compilation.modules) {
                const module = candidate as webpack.Module & {
                  resource?: string;
                  rootModule?: { resource?: string };
                };
                const resource = module.resource ?? module.rootModule?.resource;
                if (
                  resource == null ||
                  path.basename(resource) !== lazyModuleName
                ) {
                  continue;
                }
                for (const chunk of compilation.chunkGraph.getModuleChunksIterable(
                  module,
                )) {
                  chunks.add(chunk);
                }
              }
              if (
                chunks.size === 0 ||
                [...chunks].some((chunk) => chunk.canBeInitial())
              ) {
                compilation.errors.push(
                  new webpack.WebpackError(
                    `${lazyModuleName} must be emitted only in an async renderer chunk`,
                  ),
                );
              }
            }
          },
        );
      },
    );
  }
}

checkNodeEnv('production');
deleteSourceMaps();

const devtoolsConfig =
  process.env.DEBUG_PROD === 'true'
    ? {
        devtool: 'source-map',
      }
    : {};

const configuration: webpack.Configuration = {
  ...devtoolsConfig,

  mode: 'production',

  target: ['web', 'electron-renderer'],

  entry: [
    'core-js',
    'regenerator-runtime/runtime',
    path.join(webpackPaths.srcRendererPath, 'index.tsx'),
  ],

  output: {
    path: webpackPaths.distRendererPath,
    publicPath: './',
    filename: 'renderer.js',
    chunkFilename: 'renderer.[name].[contenthash:8].js',
    library: {
      type: 'umd',
    },
  },

  module: {
    rules: [
      {
        test: /\.s?(a|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?(a|c)ss$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'sass-loader'],
        exclude: /\.module\.s?(c|a)ss$/,
      },
      // Fonts
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
      // Images
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
      },
    ],
  },

  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        parallel: true,
      }),
      new CssMinimizerPlugin(),
    ],
  },

  plugins: [
    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      DEBUG_PROD: false,
    }),

    new MiniCssExtractPlugin({
      filename: 'style.css',
    }),

    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
    }),

    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.join(webpackPaths.srcRendererPath, 'index.ejs'),
      minify: {
        collapseWhitespace: true,
        removeAttributeQuotes: true,
        removeComments: true,
      },
      isBrowser: false,
      isDevelopment: process.env.NODE_ENV !== 'production',
    }),

    // Keep the startup bundle honest: these screens are intentionally loaded
    // on first visit and must not regress into the initial renderer chunk.
    new VerifyRendererLazyChunksPlugin(),

    new DtsBundleWebpack({
      name: 'types',
      main: path.join(webpackPaths.srcPath, 'mods/types.d.ts'),
      baseDir: path.join(webpackPaths.releasePath, 'build'),
      verbose: false,
      externals: true,
    }),

    new GenerateJsonSchemaPlugin({
      inFile: path.join(webpackPaths.srcPath, 'bridge/ModConfig.d.ts'),
      outFile: path.join(
        webpackPaths.releasePath,
        'build',
        'config-schema.json',
      ),
      type: 'ModConfig',
      workingDirectory: path.resolve(webpackPaths.rootPath),
    }),
  ],
};

const rendererBaseConfig: webpack.Configuration = {
  ...baseConfig,
  module: {
    ...baseConfig.module,
    rules: [
      createTypeScriptRule(true),
      ...(baseConfig.module?.rules?.slice(1) ?? []),
    ],
  },
};

export default merge(rendererBaseConfig, configuration);
