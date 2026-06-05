# Miniapp Jump

一个用于微信小程序源码的 VS Code 跳转插件，支持在 `JS / WXML / WXSS` 文件之间进行定义跳转与引用查找。

## 功能

- 支持页面、组件、`App`、`Behavior` 中的方法跳转。
- 支持 `this.xxx` 跳转到当前页面或 `Behavior` 中的方法定义。
- 支持 `import` / `require` 的显式引用跳转。
- 支持 WXML 中事件方法跳转到对应 JS 方法。
- 支持 WXML 中 class 名跳转到对应 WXSS 选择器。
- 支持查找方法引用，覆盖页面方法和 `Behavior` 方法的常见场景。
- 支持 `jsconfig.json` / `tsconfig.json` 的路径别名，以及 `app.json` 的 `resolveAlias`。

## 安装

1. 克隆或下载本仓库。
2. 在根目录执行：

```sh
npm install
npm run compile
```

3. 使用 VS Code 打开该目录。
4. 按 `F5` 启动 `Run Extension` 调试实例。

## 打包扩展

如果你想把这个项目打包成可安装的 `.vsix` 文件，可以使用 `@vscode/vsce`：

```sh
vsce package
```

打包完成后，会在当前目录生成 `.vsix` 文件。你可以在 VS Code 中通过“扩展”面板里的“从 VSIX 安装”进行安装。

## 使用

### 跳转定义

- 在 JavaScript 中将光标放到方法名上，使用 `Cmd/Ctrl + 点击` 或 `F12`。
- 在 WXML 中点击事件方法名，可以跳到对应 JS 方法。
- 在 WXML 中点击 class 名，可以跳到对应 WXSS 规则。

### 查找引用

- 在 JavaScript 方法定义上使用 `Shift + F12` 或右键 `Find All References`。
- 插件会优先返回小程序相关引用，例如页面方法、`Behavior` 方法和 WXML 事件绑定。

## 配置

在 VS Code 设置中可调整以下选项：

- `miniappJump.enableWxmlEventJump`：启用或禁用 WXML 事件方法跳转。
- `miniappJump.enableWxmlClassJump`：启用或禁用 WXML class 到 WXSS 的跳转。
- `miniappJump.enableBehaviorJump`：启用或禁用从页面方法回跳到 `Behavior` 方法。

## 命令

- `Miniapp Jump: Rebuild Index`
- `Miniapp Jump: Show Debug Info`

## 开发

```sh
npm install
npm run compile
npm test
```

### 测试

项目包含 VS Code 扩展测试，执行 `npm test` 会编译并启动测试宿主。

## 开源协议

本项目采用 MIT 开源协议。你可以自由使用、修改和分发本项目代码，但需要保留原始版权声明和许可证文本。

## AI 辅助开发说明

本项目在开发过程中使用了 AI 工具辅助完成部分代码编写、文档整理和测试用例补充。最终实现、功能取舍和问题修复由人工确认并完成。
