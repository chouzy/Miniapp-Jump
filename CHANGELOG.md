# Changelog

## 0.0.2

- 修复引用展示中的重复项和方法自身混入问题。
- 增强 CommonJS 导出、路径别名和行为方法的解析稳定性。
- 新增方法引用查找能力，支持页面方法与 behavior 方法的常见引用场景。

## 0.0.1

- 初始化微信小程序 VS Code 扩展工程。
- 支持 `.js`、`.wxml`、`.wxss` 的跳转能力。
- 支持页面、组件、`App`、`Behavior` 的方法定位。
- 支持 `this.xxx`、`import` / `require`、`behavior` 引用、WXML 事件、WXSS class 跳转。
- 支持 `jsconfig.json` / `tsconfig.json` 的路径别名，以及 `app.json` 的 `resolveAlias`。
- 支持查找方法引用，并覆盖页面方法与 behavior 方法的常见引用场景。
- 修复重复定义展示、CommonJS 导出解析、以及部分引用结果混入自身声明的问题。
