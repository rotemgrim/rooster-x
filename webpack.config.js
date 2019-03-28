const path = require('path');
const nodeExternals = require('webpack-node-externals');

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
                    /node_modules/,
                    // path.resolve(__dirname, "src/ui")
                ]
            },
            {
                test: /\.(html)$/,
                use:  "html-loader"
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.html']
    },
};

module.exports = [
    Object.assign({}, common_config, {
        target: 'electron-main',
        externals: [nodeExternals()], // in order to ignore all modules in node_modules folder
        entry: {
            main: './src/main/index.ts',
        },
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'dist/main')
        },
    }),
    Object.assign({}, common_config, {
        target: 'electron-renderer',
        entry: {
            renderer: './src/renderer/index.ts',
        },
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'dist/renderer')
        },
    })
];
