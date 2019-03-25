
module.exports = {
    devtool: 'inline-source-map',
    // entry: './src/main/index.ts',
    module: {
        rules: [
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
                            replace: process.env.NODE_ENV_HOST_URL || "http://localhost/",
                        }
                    ]
                }
            }
        ]
    }
};