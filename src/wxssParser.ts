import * as vscode from 'vscode';

export interface WxssFileIndex {
  uri: vscode.Uri;
  classes: Map<string, vscode.Location[]>;
  imports: string[];
}

function addLocation(target: Map<string, vscode.Location[]>, name: string, location: vscode.Location): void {
  const existing = target.get(name);
  if (existing) {
    existing.push(location);
  } else {
    target.set(name, [location]);
  }
}

export function parseWxssFile(text: string, uri: vscode.Uri): WxssFileIndex {
  const classes = new Map<string, vscode.Location[]>();
  const imports: string[] = [];

  const importPattern = /@import\s+(?:url\()?['"]([^'"]+\.wxss|[^'"]+)['"]\)?\s*;/g;
  for (const match of text.matchAll(importPattern)) {
    imports.push(match[1]);
  }

  for (const selector of selectors(text)) {
    const classPattern = /\.([_a-zA-Z-][\w-]*)/g;
    for (const match of selector.text.matchAll(classPattern)) {
      const dotOffset = selector.start + (match.index ?? 0);
      if (isEscaped(text, dotOffset)) {
        continue;
      }
      const className = match[1];
      const start = offsetToPosition(text, dotOffset + 1);
      const end = new vscode.Position(start.line, start.character + className.length);
      addLocation(classes, className, new vscode.Location(uri, new vscode.Range(start, end)));
    }
  }

  return { uri, classes, imports };
}

function selectors(text: string): Array<{ text: string; start: number }> {
  const result: Array<{ text: string; start: number }> = [];
  let start = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '}') {
      start = index + 1;
      continue;
    }
    if (char === ';') {
      start = index + 1;
      continue;
    }
    if (char !== '{') {
      continue;
    }

    const selector = text.slice(start, index);
    const trimmedStart = selector.search(/\S/);
    if (trimmedStart !== -1 && !selector.trimStart().startsWith('@')) {
      result.push({ text: selector.slice(trimmedStart), start: start + trimmedStart });
    }
    start = index + 1;
  }

  return result;
}

function isEscaped(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function offsetToPosition(text: string, offset: number): vscode.Position {
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}
