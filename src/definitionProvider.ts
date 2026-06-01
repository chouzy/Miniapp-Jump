import * as path from 'path';
import * as vscode from 'vscode';
import { MiniappIndex } from './index';

interface WxmlAttribute {
  name: string;
  value: string;
  valueStart: number;
  valueEnd: number;
}

export class MiniappDefinitionProvider implements vscode.DefinitionProvider {
  private suppressBuiltinProbe = false;

  constructor(private readonly index: MiniappIndex) {}

  async debugInfo(document: vscode.TextDocument, position: vscode.Position): Promise<string[]> {
    const definitions = await this.provideDefinition(
      document,
      position,
      new vscode.CancellationTokenSource().token
    );
    const locations = (Array.isArray(definitions) ? definitions : definitions ? [definitions] : []) as Array<vscode.Location | vscode.LocationLink>;
    const wordRange = document.getWordRangeAtPosition(position, /[$A-Z_a-z][\w$-]*/);
    const word = wordRange ? document.getText(wordRange) : '';
    const lines = [
      'Miniapp Jump active.',
      `language=${document.languageId}`,
      `file=${document.uri.fsPath}`,
      `word=${word || '<none>'}`,
      `definitions=${locations.length}`
    ];

    if (path.extname(document.uri.fsPath) === '.js') {
      const jsWordRange = document.getWordRangeAtPosition(position, /[$A-Z_a-z][$\w]*/);
      const js = await this.index.getJs(document.uri, document);
      lines.push(
        `isThisAccess=${jsWordRange ? this.hasPrefix(document, jsWordRange.start, /this\s*\.\s*$/) : false}`,
        `objectBeforeDot=${jsWordRange ? this.objectBeforeDot(document, jsWordRange.start) ?? '<none>' : '<none>'}`,
        `localMethods=${js ? [...js.localMethods.keys()].join(',') || '<none>' : '<parse failed>'}`,
        `behaviors=${js ? js.behaviorSpecs.join(',') || '<none>' : '<parse failed>'}`,
        `namedImports=${js ? [...js.namedImports.keys()].join(',') || '<none>' : '<parse failed>'}`,
        `moduleObjects=${js ? [...js.identifierModules.keys()].join(',') || '<none>' : '<parse failed>'}`
      );
    }

    if (path.extname(document.uri.fsPath) === '.wxml') {
      const attr = attributeAt(document.getText(), document.offsetAt(position));
      lines.push(
        `attribute=${attr ? attr.name : '<none>'}`,
        `attributeValue=${attr ? attr.value : '<none>'}`
      );
    }

    const first = locations[0];
    const firstUri = first && ('uri' in first ? first.uri.fsPath : first.targetUri.fsPath);
    if (firstUri) {
      lines.push(`first=${firstUri}`);
    }
    return lines;
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Definition | undefined> {
    if (this.suppressBuiltinProbe) {
      return undefined;
    }

    const extension = path.extname(document.uri.fsPath);
    if (extension === '.js') {
      return uniqueLocations(await this.provideJsDefinition(document, position));
    }
    if (extension === '.wxml') {
      return uniqueLocations(await this.provideWxmlDefinition(document, position));
    }
    return undefined;
  }

  private async provideJsDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position, /[$A-Z_a-z][$\w]*/);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const js = await this.index.getJs(document.uri, document);
    if (!js) {
      return undefined;
    }

    if (this.hasPrefix(document, wordRange.start, /this\s*\.\s*$/)) {
      const local = js.localMethods.get(word) ?? [];
      if (local.length > 0) {
        if (await this.builtinAlreadyProvides(document, wordRange.start, local)) {
          return undefined;
        }
        return local;
      }
      if (this.config('enableBehaviorJump')) {
        const behaviorDefinitions = await this.findBehaviorMethodDefinitions(document.uri, js.behaviorSpecs, word);
        return behaviorDefinitions.length > 0 ? behaviorDefinitions : undefined;
      }
      return undefined;
    }

    const namedImport = js.namedImports.get(word);
    if (namedImport) {
      const definitions = await this.findModuleDefinitions(document.uri, namedImport.source, namedImport.imported);
      if (await this.builtinAlreadyProvides(document, wordRange.start, definitions)) {
        return undefined;
      }
      return definitions.length > 0 ? definitions : undefined;
    }

    const objectName = this.objectBeforeDot(document, wordRange.start);
    if (objectName && objectName !== 'this') {
      const source = js.identifierModules.get(objectName);
      if (source) {
        const definitions = await this.findModuleDefinitions(document.uri, source, word);
        if (await this.builtinAlreadyProvides(document, wordRange.start, definitions)) {
          return undefined;
        }
        return definitions.length > 0 ? definitions : undefined;
      }
    }

    return undefined;
  }

  private async provideWxmlDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    const wordRange = document.getWordRangeAtPosition(position, /[$A-Z_a-z][\w$-]*/);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);
    const offset = document.offsetAt(position);
    const attr = attributeAt(document.getText(), offset);
    if (!attr) {
      return undefined;
    }

    if (this.config('enableWxmlEventJump') && isEventAttribute(attr.name) && isJsIdentifier(word)) {
      const jsUri = this.index.companionUri(document.uri, '.js');
      const js = await this.index.getJs(jsUri);
      if (!js) {
        return undefined;
      }
      const local = js.localMethods.get(word) ?? [];
      if (local.length > 0) {
        return local;
      }
      if (this.config('enableBehaviorJump')) {
        const behaviorDefinitions = await this.findBehaviorMethodDefinitions(jsUri, js.behaviorSpecs, word);
        return behaviorDefinitions.length > 0 ? behaviorDefinitions : undefined;
      }
      return undefined;
    }

    if (
      this.config('enableWxmlClassJump') &&
      attr.name === 'class' &&
      isClassName(word) &&
      isStaticClassAtOffset(attr.value, offset - attr.valueStart)
    ) {
      const wxssUri = this.index.companionUri(document.uri, '.wxss');
      const definitions = await this.index.findClassDefinitions(wxssUri, word);
      return definitions.length > 0 ? definitions : undefined;
    }

    return undefined;
  }

  private async findBehaviorMethodDefinitions(fromUri: vscode.Uri, behaviorSpecs: string[], methodName: string): Promise<vscode.Location[]> {
    const definitions: vscode.Location[] = [];
    for (const spec of behaviorSpecs) {
      const uri = await this.index.resolveModule(fromUri, spec, '.js');
      if (!uri) {
        continue;
      }
      const behavior = await this.index.getJs(uri);
      definitions.push(...(behavior?.localMethods.get(methodName) ?? []));
      definitions.push(...(behavior?.exports.get(methodName) ?? []));
    }
    return definitions;
  }

  private async findModuleDefinitions(fromUri: vscode.Uri, spec: string, exportName: string): Promise<vscode.Location[]> {
    const uri = await this.index.resolveModule(fromUri, spec, '.js');
    if (!uri) {
      return [];
    }
    const imported = await this.index.getJs(uri);
    if (!imported) {
      return [];
    }
    return [
      ...(imported.exports.get(exportName) ?? []),
      ...(imported.localMethods.get(exportName) ?? [])
    ];
  }

  private hasPrefix(document: vscode.TextDocument, position: vscode.Position, pattern: RegExp): boolean {
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    return pattern.test(prefix);
  }

  private objectBeforeDot(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    return prefix.match(/([$A-Z_a-z][$\w]*)\s*\.\s*$/)?.[1];
  }

  private config(key: 'enableWxmlEventJump' | 'enableWxmlClassJump' | 'enableBehaviorJump'): boolean {
    return vscode.workspace.getConfiguration('miniappJump').get<boolean>(key, true);
  }

  private async builtinAlreadyProvides(
    document: vscode.TextDocument,
    position: vscode.Position,
    localLocations: vscode.Location[]
  ): Promise<boolean> {
    if (this.suppressBuiltinProbe) {
      return false;
    }

    this.suppressBuiltinProbe = true;
    try {
      const definitions = await withTimeout(
        vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
          'vscode.executeDefinitionProvider',
          document.uri,
          position
        ),
        800
      );
      return (definitions ?? []).some((definition) => {
        const location = toLocation(definition);
        return localLocations.some((local) => sameLocation(local, location));
      });
    } catch {
      return false;
    } finally {
      this.suppressBuiltinProbe = false;
    }
  }
}

function attributeAt(text: string, offset: number): WxmlAttribute | undefined {
  const pattern = /([:@\w-]+)\s*=\s*(['"])([\s\S]*?)\2/g;
  for (const match of text.matchAll(pattern)) {
    const full = match[0];
    const quoteIndex = full.indexOf(match[2]);
    const valueStart = (match.index ?? 0) + quoteIndex + 1;
    const valueEnd = valueStart + match[3].length;
    if (offset >= valueStart && offset <= valueEnd) {
      return {
        name: match[1],
        value: match[3],
        valueStart,
        valueEnd
      };
    }
  }
  return undefined;
}

function isEventAttribute(name: string): boolean {
  return /^(?:(?:capture-)?(?:bind|catch)|mut-bind)(?::|[A-Za-z0-9_-])/.test(name);
}

function isJsIdentifier(text: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(text);
}

function isClassName(text: string): boolean {
  return /^[_a-zA-Z-][\w-]*$/.test(text);
}

function isStaticClassAtOffset(value: string, offset: number): boolean {
  const moustachePattern = /\{\{[\s\S]*?\}\}/g;
  for (const match of value.matchAll(moustachePattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (offset < start || offset > end) {
      continue;
    }
    const quoted = /(['"])(.*?)\1/g;
    for (const quotedMatch of match[0].matchAll(quoted)) {
      const quoteStart = start + (quotedMatch.index ?? 0) + 1;
      const quoteEnd = quoteStart + quotedMatch[2].length;
      if (offset >= quoteStart && offset <= quoteEnd) {
        return true;
      }
    }
    return false;
  }
  return true;
}

function uniqueLocations(locations: vscode.Location[] | undefined): vscode.Location[] | undefined {
  if (!locations || locations.length <= 1) {
    return locations;
  }

  const seen = new Set<string>();
  const unique: vscode.Location[] = [];
  for (const location of locations) {
    const key = [
      location.uri.toString(),
      location.range.start.line,
      location.range.start.character,
      location.range.end.line,
      location.range.end.character
    ].join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(location);
  }
  return unique;
}

function toLocation(location: vscode.Location | vscode.LocationLink): vscode.Location {
  return 'uri' in location
    ? location
    : new vscode.Location(location.targetUri, location.targetSelectionRange ?? location.targetRange);
}

function sameLocation(left: vscode.Location, right: vscode.Location): boolean {
  return left.uri.toString() === right.uri.toString() &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character;
}

function withTimeout<T>(promise: Thenable<T>, timeoutMs: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}
