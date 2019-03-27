// for angular dependencies use:
// yarn add @angular/common @angular/compiler @angular/core @angular/forms
// @angular/http @angular/platform-browser
// @angular/platform-browser-dynamic @angular/router core-js rxjs source-map-support zone.js
// const AngularCompilerPlugin = require('@ngtools/webpack').AngularCompilerPlugin;
// const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    // target: 'web',
    devtool: 'inline-source-map',
    // entry: './src/renderer/index.ts',
    module: {
        rules: [
            // {
            //     test: /\.js$/,
            //     // exclude: /node_modules/,
            //     use: {
            //         loader: 'babel-loader',
            //         options: {
            //             presets: ['es2017']
            //         }
            //     }
            // },
            // {
            //     test: /\.js$/,
            //     exclude: /node_modules/,
            //     use: {
            //         loader: 'babel-loader',
            //         options: {
            //             presets: ['es2017']
            //         }
            //     }
            // },
            {
                test: /\.ts$/,
                loader: 'string-replace-loader',
                options: {
                    multiple: [
                        {
                            search: '{%VERSION%}',
                            replace: process.env.NODE_ENV_VER || "-master",
                        },
                        {
                            search: '{%HOST_URL%}',
                            replace: process.env.NODE_ENV_HOST_URL || "https://app.rooster-x.com/",
                        }
                    ]
                }
            },
            // Images
            // {
            //     test: /\.(?:ico|gif|png|jpg|jpeg|webp)$/,
            //     loader: 'url-loader'
            // },
            // {
            //     test: /\.ts$/,
            //     loader: 'string-replace-loader',
            //     options: {
            //         search: '{%VERSION%}',
            //         replace: process.env.npm_package_version,
            //     }
            // },
            // {
            //     test: /\.ts$/,
            //     enforce: 'pre',
            //     loader: 'tslint-loader',
            //     options: {
            //         project: "./tsconfig.json",
            //         config: "./tslint.json"
            //     }
            // },

            // {
            //     test: /\.ts$/,
            //     loaders: ['@ngtools/webpack'],
            //     exclude: [/\.(spec|e2e)\.ts$/]
            // },
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "ts-loader",
                    },
                    {
                        loader: "angular2-template-loader"
                    }
                ]
            },
            {
                test: /\.(html)$/,
                use: {
                    loader: "html-loader",
                    options: {
                        // angular 2 templates break if these are omitted
                        removeAttributeQuotes: false,
                        keepClosingSlash: true,
                        caseSensitive: true,
                        conservativeCollapse: true,
                    }
                }
            }
            // {
            //     test: /\.(html|css)$/,
            //     loader: 'raw-loader',
            //     exclude: /\.async\.(html|css)$/
            // },
            // /* Async loading. */
            // {
            //     test: /\.async\.(html|css)$/,
            //     loaders: ['file?name=[name].[hash].[ext]', 'extract']
            // }
        ]
    },
    plugins: [
        // new HtmlWebpackPlugin({
        //     title: "Rooster-X",
        //     template: "src/renderer/index.html",
        //     hash: true
        // })
        // new AngularCompilerPlugin({
        //     //tsConfigPath: 'src/renderer/tsconfig.json',
        //     tsConfigPath: 'tsconfig.json',
        //     entryModule: 'src/renderer/app/app.module#AppModule',
        //     sourceMap: true
        // })
    ],
};
