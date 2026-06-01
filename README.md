# Miniapp Jump

VS Code extension for WeChat Mini Program definition jumps.

## Features

- Jump from `this.xxx` in page/component JavaScript files to local methods.
- Fall back to methods provided by imported `Behavior` files.
- Jump through explicit ESM/CommonJS imports.
- Jump from WXML event handlers to matching JavaScript methods.
- Jump from WXML class names to matching WXSS selectors, including imported WXSS files.

## Development

```sh
npm install
npm run compile
npm test
```

Open this folder in VS Code and use the `Run Extension` launch configuration.
