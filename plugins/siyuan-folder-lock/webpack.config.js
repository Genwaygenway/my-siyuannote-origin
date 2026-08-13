const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const ZipPlugin = require("zip-webpack-plugin");

module.exports = (env, argv) => {
    const production = argv.mode === "production";
    const plugins = [
        new MiniCssExtractPlugin({
            filename: production ? "dist/index.css" : "index.css",
        }),
    ];
    if (production) {
        plugins.push(
            new CopyPlugin({
                patterns: [
                    {from: "icon.png", to: "dist/"},
                    {from: "preview.png", to: "dist/"},
                    {from: "README*.md", to: "dist/"},
                    {from: "LICENSE", to: "dist/"},
                    {from: "plugin.json", to: "dist/"},
                    {from: "i18n", to: "dist/i18n"},
                ],
            }),
            new ZipPlugin({
                filename: "package.zip",
                include: [/dist/],
                pathMapper: (assetPath) => assetPath.replace("dist/", ""),
            }),
        );
    }
    return {
        mode: argv.mode || "development",
        entry: "./src/index.ts",
        output: {
            path: path.resolve(__dirname, "./"),
            filename: production ? "dist/index.js" : "index.js",
            libraryTarget: "commonjs2",
            libraryExport: "default",
            clean: false,
        },
        resolve: {
            extensions: [".ts", ".js"],
        },
        externals: {
            siyuan: "commonjs2 siyuan",
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: "ts-loader",
                        options: {
                            transpileOnly: !production,
                        },
                    },
                    exclude: /node_modules/,
                },
                {
                    test: /\.css$/,
                    use: [MiniCssExtractPlugin.loader, "css-loader"],
                },
            ],
        },
        plugins,
        optimization: {
            minimize: production,
        },
    };
};
