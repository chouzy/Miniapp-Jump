import * as vscode from 'vscode';
import * as ts from 'typescript';

export interface ImportedSymbol {
  source: string;
  imported: string;
}

export interface JsFileIndex {
  uri: vscode.Uri;
  localMethods: Map<string, vscode.Location[]>;
  exports: Map<string, vscode.Location[]>;
  exportedObjectMembers: Map<string, Map<string, vscode.Location[]>>;
  identifierModules: Map<string, string>;
  namedImports: Map<string, ImportedSymbol>;
  behaviorSpecs: string[];
  isBehaviorFile: boolean;
}

function functionValue(expression: ts.Expression): boolean {
  if (ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) {
    return true;
  }

  // MobX 的 action(...) 会返回传入的函数，Store 方法的定义仍应定位到属性名。
  return ts.isCallExpression(expression) && expression.arguments.some(
    (argument) => ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)
  );
}

function objectLiteralFromInitializer(initializer: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer;
  }

  // 支持 observable({...}) 一类以对象字面量作为首个参数的 Store 工厂。
  if (ts.isCallExpression(initializer) && ts.isObjectLiteralExpression(initializer.arguments[0])) {
    return initializer.arguments[0];
  }

  return undefined;
}

function addLocation(target: Map<string, vscode.Location[]>, name: string | undefined, location: vscode.Location): void {
  if (!name) {
    return;
  }
  const existing = target.get(name);
  if (existing) {
    existing.push(location);
  } else {
    target.set(name, [location]);
  }
}

function nameText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function locationForNode(sourceFile: ts.SourceFile, uri: vscode.Uri, node: ts.Node): vscode.Location {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return new vscode.Location(
    uri,
    new vscode.Range(start.line, start.character, end.line, end.character)
  );
}

function collectFunctionProperties(
  sourceFile: ts.SourceFile,
  uri: vscode.Uri,
  objectLiteral: ts.ObjectLiteralExpression,
  target: Map<string, vscode.Location[]>
): void {
  for (const property of objectLiteral.properties) {
    if (ts.isMethodDeclaration(property)) {
      addLocation(target, nameText(property.name), locationForNode(sourceFile, uri, property.name));
    }

    if (
      ts.isPropertyAssignment(property) &&
      functionValue(property.initializer)
    ) {
      addLocation(target, nameText(property.name), locationForNode(sourceFile, uri, property.name));
    }
  }
}

function collectObjectExportProperties(
  sourceFile: ts.SourceFile,
  uri: vscode.Uri,
  objectLiteral: ts.ObjectLiteralExpression,
  localDeclarations: Map<string, vscode.Location>,
  target: Map<string, vscode.Location[]>
): void {
  for (const property of objectLiteral.properties) {
    if (ts.isMethodDeclaration(property)) {
      addLocation(target, nameText(property.name), locationForNode(sourceFile, uri, property.name));
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      addLocation(
        target,
        property.name.text,
        localDeclarations.get(property.name.text) ?? locationForNode(sourceFile, uri, property.name)
      );
      continue;
    }

    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const exportedName = nameText(property.name);
    if (!exportedName) {
      continue;
    }

    if (functionValue(property.initializer)) {
      addLocation(target, exportedName, locationForNode(sourceFile, uri, property.name));
      continue;
    }

    if (ts.isIdentifier(property.initializer)) {
      addLocation(
        target,
        exportedName,
        localDeclarations.get(property.initializer.text) ?? locationForNode(sourceFile, uri, property.name)
      );
    }
  }
}

function propertyObject(objectLiteral: ts.ObjectLiteralExpression, propertyName: string): ts.ObjectLiteralExpression | undefined {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || nameText(property.name) !== propertyName) {
      continue;
    }
    if (ts.isObjectLiteralExpression(property.initializer)) {
      return property.initializer;
    }
  }
  return undefined;
}

function requireSource(expression: ts.Expression): string | undefined {
  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'require' &&
    expression.arguments.length === 1 &&
    ts.isStringLiteralLike(expression.arguments[0])
  ) {
    return expression.arguments[0].text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return requireSource(expression.expression);
  }

  return undefined;
}

function collectBehaviors(
  objectLiteral: ts.ObjectLiteralExpression,
  identifierModules: Map<string, string>,
  behaviorSpecs: string[]
): void {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || nameText(property.name) !== 'behaviors') {
      continue;
    }
    if (!ts.isArrayLiteralExpression(property.initializer)) {
      continue;
    }
    for (const element of property.initializer.elements) {
      const directRequire = requireSource(element);
      if (directRequire) {
        behaviorSpecs.push(directRequire);
        continue;
      }
      if (ts.isIdentifier(element)) {
        const source = identifierModules.get(element.text);
        if (source) {
          behaviorSpecs.push(source);
        }
      }
      if (ts.isPropertyAccessExpression(element) && ts.isIdentifier(element.expression)) {
        const source = identifierModules.get(element.expression.text);
        if (source) {
          behaviorSpecs.push(source);
        }
      }
    }
  }
}

function collectMiniappMethods(
  sourceFile: ts.SourceFile,
  uri: vscode.Uri,
  objectLiteral: ts.ObjectLiteralExpression,
  calleeName: string,
  localMethods: Map<string, vscode.Location[]>
): void {
  if (calleeName === 'App' || calleeName === 'Page') {
    collectFunctionProperties(sourceFile, uri, objectLiteral, localMethods);
    const methods = propertyObject(objectLiteral, 'methods');
    if (methods) {
      collectFunctionProperties(sourceFile, uri, methods, localMethods);
    }
    return;
  }

  if (calleeName === 'Component' || calleeName === 'Behavior') {
    const methods = propertyObject(objectLiteral, 'methods');
    if (methods) {
      collectFunctionProperties(sourceFile, uri, methods, localMethods);
    }
    if (calleeName === 'Behavior') {
      collectFunctionProperties(sourceFile, uri, objectLiteral, localMethods);
    }
  }
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

export function parseJsFile(text: string, uri: vscode.Uri): JsFileIndex {
  const sourceFile = ts.createSourceFile(uri.fsPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const localMethods = new Map<string, vscode.Location[]>();
  const exportsMap = new Map<string, vscode.Location[]>();
  const exportedObjectMembers = new Map<string, Map<string, vscode.Location[]>>();
  const identifierModules = new Map<string, string>();
  const namedImports = new Map<string, ImportedSymbol>();
  const localDeclarations = new Map<string, vscode.Location>();
  const objectDeclarations = new Map<string, ts.ObjectLiteralExpression>();
  const exportSpecifiers: Array<{ local: string; exported: string; node: ts.Node }> = [];
  const behaviorSpecs: string[] = [];
  let isBehaviorFile = false;

  function addLocalDeclaration(name: string | undefined, node: ts.Node): void {
    if (name) {
      localDeclarations.set(name, locationForNode(sourceFile, uri, node));
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && node.importClause) {
      const source = node.moduleSpecifier.text;
      if (node.importClause.name) {
        identifierModules.set(node.importClause.name.text, source);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        identifierModules.set(bindings.name.text, source);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          namedImports.set(element.name.text, {
            source,
            imported: (element.propertyName ?? element.name).text
          });
        }
      }
    }

    if (ts.isVariableDeclaration(node)) {
      const source = node.initializer ? requireSource(node.initializer) : undefined;
      if (source && ts.isIdentifier(node.name)) {
        identifierModules.set(node.name.text, source);
      }
      if (source && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const imported = nameText(element.propertyName ?? element.name);
          const local = nameText(element.name);
          if (imported && local) {
            namedImports.set(local, { source, imported });
          }
        }
      }

      if (
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))
      ) {
        addLocalDeclaration(node.name.text, node.name);
      }

      if (ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        objectDeclarations.set(node.name.text, node.initializer);
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      addLocalDeclaration(node.name.text, node.name);
      if (hasExportModifier(node)) {
        addLocation(exportsMap, node.name.text, locationForNode(sourceFile, uri, node.name));
      }
    }

    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isFunctionExpression(declaration.initializer) || ts.isArrowFunction(declaration.initializer))
        ) {
          addLocation(exportsMap, declaration.name.text, locationForNode(sourceFile, uri, declaration.name));
        }

        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          const objectLiteral = objectLiteralFromInitializer(declaration.initializer);
          if (objectLiteral) {
            const members = new Map<string, vscode.Location[]>();
            collectFunctionProperties(sourceFile, uri, objectLiteral, members);
            exportedObjectMembers.set(declaration.name.text, members);
          }
        }
      }
    }

    if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        exportSpecifiers.push({
          local: (element.propertyName ?? element.name).text,
          exported: element.name.text,
          node: element.name
        });
      }
    }

    if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression)) {
      collectObjectExportProperties(sourceFile, uri, node.expression, localDeclarations, exportsMap);
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (
        ts.isPropertyAccessExpression(node.left) &&
        node.left.expression.getText(sourceFile) === 'exports' &&
        (ts.isFunctionExpression(node.right) || ts.isArrowFunction(node.right))
      ) {
        addLocation(exportsMap, node.left.name.text, locationForNode(sourceFile, uri, node.left.name));
      }

      if (
        ts.isPropertyAccessExpression(node.left) &&
        ts.isPropertyAccessExpression(node.left.expression) &&
        node.left.expression.getText(sourceFile) === 'module.exports' &&
        (ts.isFunctionExpression(node.right) || ts.isArrowFunction(node.right))
      ) {
        addLocation(exportsMap, node.left.name.text, locationForNode(sourceFile, uri, node.left.name));
      }

      if (node.left.getText(sourceFile) === 'module.exports' && ts.isObjectLiteralExpression(node.right)) {
        collectObjectExportProperties(sourceFile, uri, node.right, localDeclarations, exportsMap);
      }

      if (node.left.getText(sourceFile) === 'module.exports' && ts.isIdentifier(node.right)) {
        const exportedObject = objectDeclarations.get(node.right.text);
        if (exportedObject) {
          collectObjectExportProperties(sourceFile, uri, exportedObject, localDeclarations, exportsMap);
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['App', 'Page', 'Component', 'Behavior'].includes(node.expression.text) &&
      node.arguments.length > 0
    ) {
      if (node.expression.text === 'Behavior') {
        isBehaviorFile = true;
      }
      const config = ts.isObjectLiteralExpression(node.arguments[0])
        ? node.arguments[0]
        : ts.isIdentifier(node.arguments[0])
          ? objectDeclarations.get(node.arguments[0].text)
          : undefined;
      if (config) {
        collectMiniappMethods(sourceFile, uri, config, node.expression.text, localMethods);
        collectBehaviors(config, identifierModules, behaviorSpecs);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  for (const item of exportSpecifiers) {
    addLocation(exportsMap, item.exported, localDeclarations.get(item.local) ?? locationForNode(sourceFile, uri, item.node));
  }

  return {
    uri,
    localMethods,
    exports: exportsMap,
    exportedObjectMembers,
    identifierModules,
    namedImports,
    behaviorSpecs,
    isBehaviorFile
  };
}
