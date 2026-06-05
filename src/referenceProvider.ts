import * as path from 'path';
import * as ts from 'typescript';
import * as vscode from 'vscode';
import { MiniappIndex } from './index';

interface ReferenceTarget {
  uri: vscode.Uri;
  name: string;
  isBehaviorFile: boolean;
  declaration?: vscode.Location;
}

export class MiniappReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly index: MiniappIndex) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.Location[] | undefined> {
    if (path.extname(document.uri.fsPath) !== '.js') {
      return undefined;
    }

    const target = await this.resolveTarget(document, position);
    if (!target) {
      return undefined;
    }

    const references: vscode.Location[] = [];

    const jsFiles = await vscode.workspace.findFiles(
      '**/*.js',
      '{**/node_modules/**,**/miniprogram_npm/**,**/.vscode-test/**,**/out/**}'
    );

    for (const jsUri of jsFiles) {
      const js = await this.index.getJs(jsUri);
      if (!js) {
        continue;
      }

      if (target.uri.toString() === jsUri.toString()) {
        const text = await this.getText(jsUri);
        if (text) {
          references.push(...findThisReferences(text, jsUri, target.name));
        }
        continue;
      }

      if (target.isBehaviorFile) {
        const matchesBehavior = await this.referencesBehavior(jsUri, js.behaviorSpecs, target.uri);
        if (matchesBehavior) {
          const text = await this.getText(jsUri);
          if (text) {
            references.push(...findThisReferences(text, jsUri, target.name));
            const companion = this.index.companionUri(jsUri, '.wxml');
            const wxmlText = await this.getText(companion);
            if (wxmlText) {
              references.push(...findWxmlEventReferences(wxmlText, companion, target.name));
            }
          }
        }
        continue;
      }
    }

    if (!target.isBehaviorFile) {
      const companion = this.index.companionUri(target.uri, '.wxml');
      const wxmlText = await this.getText(companion);
      if (wxmlText) {
        references.push(...findWxmlEventReferences(wxmlText, companion, target.name));
      }
    }

    return uniqueLocations(references);
  }

  private async resolveTarget(document: vscode.TextDocument, position: vscode.Position): Promise<ReferenceTarget | undefined> {
    const js = await this.index.getJs(document.uri, document);
    if (!js) {
      return undefined;
    }

    const wordRange = document.getWordRangeAtPosition(position, /[$A-Z_a-z][$\w]*/);
    if (!wordRange) {
      return undefined;
    }

    const name = document.getText(wordRange);
    const declarations = js.localMethods.get(name);
    if (!declarations || declarations.length === 0) {
      return undefined;
    }

    return {
      uri: document.uri,
      name,
      isBehaviorFile: js.isBehaviorFile,
      declaration: declarations[0]
    };
  }

  private async referencesBehavior(fromUri: vscode.Uri, behaviorSpecs: string[], targetUri: vscode.Uri): Promise<boolean> {
    for (const spec of behaviorSpecs) {
      const resolved = await this.index.resolveModule(fromUri, spec, '.js');
      if (resolved && resolved.toString() === targetUri.toString()) {
        return true;
      }
    }
    return false;
  }

  private async getText(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }
}

function findThisReferences(text: string, uri: vscode.Uri, name: string): vscode.Location[] {
  const sourceFile = ts.createSourceFile(uri.fsPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const locations: vscode.Location[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ThisKeyword &&
      node.name.text === name
    ) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.name.getEnd());
      locations.push(new vscode.Location(uri, new vscode.Range(start.line, start.character, end.line, end.character)));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return locations;
}

function findWxmlEventReferences(text: string, uri: vscode.Uri, name: string): vscode.Location[] {
  const locations: vscode.Location[] = [];
  const pattern = /([:@\w-]+)\s*=\s*(['"])([\s\S]*?)\2/g;

  for (const match of text.matchAll(pattern)) {
    const attrName = match[1];
    const value = match[3];
    if (!isEventAttribute(attrName) || value !== name) {
      continue;
    }

    const full = match[0];
    const quoteIndex = full.indexOf(match[2]);
    const valueStart = (match.index ?? 0) + quoteIndex + 1;
    const start = offsetToPosition(text, valueStart);
    const end = new vscode.Position(start.line, start.character + value.length);
    locations.push(new vscode.Location(uri, new vscode.Range(start, end)));
  }

  return locations;
}

function isEventAttribute(name: string): boolean {
  return /^(?:(?:capture-)?(?:bind|catch)|mut-bind)(?::|[A-Za-z0-9_-])/.test(name);
}

function offsetToPosition(text: string, offset: number): vscode.Position {
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}

function uniqueLocations(locations: vscode.Location[]): vscode.Location[] {
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
