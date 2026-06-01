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

  const classPattern = /(^|[,{]\s*)\.([_a-zA-Z-][\w-]*)/gm;
  for (const match of text.matchAll(classPattern)) {
    const className = match[2];
    const startOffset = (match.index ?? 0) + match[1].length + 1;
    const start = offsetToPosition(text, startOffset);
    const end = new vscode.Position(start.line, start.character + className.length);
    addLocation(classes, className, new vscode.Location(uri, new vscode.Range(start, end)));
  }

  return { uri, classes, imports };
}

function offsetToPosition(text: string, offset: number): vscode.Position {
  const prefix = text.slice(0, offset);
  const lines = prefix.split(/\r\n|\r|\n/);
  return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
}
