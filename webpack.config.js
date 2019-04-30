const path = require('path');
const nodeExternals = require('webpack-node-externals');
const HtmlWebpackPlugin = require("html-webpack-plugin");

console.log(__dirname);
let common_config = {
    node: {
        __dirname: true
    },
    mode: process.env.ENV || 'development',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: ['ts-loader'],
                exclude: [
                    /node_modules/
                ]
            },
            {
                test: /\.scss$/,
                use: [
                    "style-loader", // creates style nodes from JS strings
                    "css-loader", // translates CSS into CommonJS
                    "sass-loader" // compiles Sass to CSS, using Node Sass by default
                ]
            },
            {
                test: /\.(jpe?g|png|gif|svg|ico)$/i,
                loader: 'url-loader',
                query: {
                    // Inline images smaller than 10kb as data URIs
                    // limit: 10000
                }
            },
            {
                test: /\.(html)$/i,
                loader: 'raw-loader',
                exclude: /\.async\.(html|css)$/
            },
            /* Async loading. */
            // {
            //     test: /\.async\.(html|css)$/,
            //     loaders: ['file?name=[name].[hash].[ext]', 'extract']
            // }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js']
    },
};

module.exports = [
    Object.assign({}, common_config, {
        target: 'electron-main',
        externals: [nodeExternals()], // in order to ignore all modules in node_modules folder
        entry: {
            main: './src/main/index.ts',
        },
        devtool: "eval-source-map",
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'build/'),
        }
    }),
    Object.assign({}, common_config, {
        target: 'electron-renderer',
        devtool: "eval-source-map",
        entry: {
            renderer: './src/renderer/index.ts',
        },
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'build/')
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: "./src/renderer/index.html"
            })
        ]
    }),
];
