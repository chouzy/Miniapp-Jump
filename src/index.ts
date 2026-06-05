import * as path from 'path';
import * as vscode from 'vscode';
import { JsFileIndex, parseJsFile } from './jsParser';
import { WxssFileIndex, parseWxssFile } from './wxssParser';

type Cached<T> = {
  version: number | undefined;
  value: T;
};

interface PathAlias {
  pattern: string;
  targets: string[];
  basePath: string;
}

export class MiniappIndex {
  private readonly jsCache = new Map<string, Cached<JsFileIndex>>();
  private readonly wxssCache = new Map<string, Cached<WxssFileIndex>>();
  private readonly aliasCache = new Map<string, PathAlias[]>();

  clear(): void {
    this.jsCache.clear();
    this.wxssCache.clear();
    this.aliasCache.clear();
  }

  invalidate(uri: vscode.Uri): void {
    this.jsCache.delete(uri.toString());
    this.wxssCache.delete(uri.toString());
  }

  async getJs(uri: vscode.Uri, document?: vscode.TextDocument): Promise<JsFileIndex | undefined> {
    const textDocument = document ?? vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
    const version = textDocument?.version;
    const key = uri.toString();
    const cached = this.jsCache.get(key);
    if (cached && cached.version === version) {
      return cached.value;
    }

    const text = textDocument?.getText() ?? await this.readText(uri);
    if (text === undefined) {
      return undefined;
    }

    const value = parseJsFile(text, uri);
    this.jsCache.set(key, { version, value });
    return value;
  }

  async getWxss(uri: vscode.Uri, document?: vscode.TextDocument): Promise<WxssFileIndex | undefined> {
    const textDocument = document ?? vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
    const version = textDocument?.version;
    const key = uri.toString();
    const cached = this.wxssCache.get(key);
    if (cached && cached.version === version) {
      return cached.value;
    }

    const text = textDocument?.getText() ?? await this.readText(uri);
    if (text === undefined) {
      return undefined;
    }

    const value = parseWxssFile(text, uri);
    this.wxssCache.set(key, { version, value });
    return value;
  }

  async resolveModule(fromUri: vscode.Uri, spec: string, extension: '.js' | '.wxss'): Promise<vscode.Uri | undefined> {
    if (!spec) {
      return undefined;
    }

    const rawPaths = await this.resolveRawModulePaths(fromUri, spec);
    for (const rawPath of rawPaths) {
      const resolved = await this.resolveWithExtension(rawPath, extension);
      if (resolved) {
        return resolved;
      }
    }

    return undefined;
  }

  private async resolveRawModulePaths(fromUri: vscode.Uri, spec: string): Promise<string[]> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fromUri);
    const rootPath = workspaceFolder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (spec.startsWith('.')) {
      return [path.resolve(path.dirname(fromUri.fsPath), spec)];
    }
    if (spec.startsWith('/') && rootPath) {
      return [path.join(rootPath, spec.slice(1))];
    }
    if (!rootPath) {
      return [];
    }

    const aliases = await this.getAliases(rootPath);
    const resolved: string[] = [];
    for (const alias of aliases) {
      const paths = expandAlias(spec, alias);
      resolved.push(...paths);
    }
    return resolved;
  }

  private async resolveWithExtension(rawPath: string, extension: '.js' | '.wxss'): Promise<vscode.Uri | undefined> {
    const candidates = [
      rawPath,
      `${rawPath}${extension}`,
      path.join(rawPath, `index${extension}`)
    ];

    for (const candidate of candidates) {
      const uri = vscode.Uri.file(candidate);
      if (await this.exists(uri)) {
        return uri;
      }
    }
    return undefined;
  }

  private async getAliases(rootPath: string): Promise<PathAlias[]> {
    const cached = this.aliasCache.get(rootPath);
    if (cached) {
      return cached;
    }

    const aliases: PathAlias[] = [];
    aliases.push(...await this.readCompilerAliases(rootPath, 'jsconfig.json'));
    aliases.push(...await this.readCompilerAliases(rootPath, 'tsconfig.json'));
    aliases.push(...await this.readAppAliases(rootPath));
    this.aliasCache.set(rootPath, aliases);
    return aliases;
  }

  private async readCompilerAliases(rootPath: string, fileName: string): Promise<PathAlias[]> {
    const config = await this.readJson(vscode.Uri.file(path.join(rootPath, fileName)));
    const compilerOptions = config?.compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== 'object') {
      return [];
    }

    const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.';
    const basePath = path.resolve(rootPath, baseUrl);
    const paths = compilerOptions.paths;
    if (!paths || typeof paths !== 'object') {
      return [];
    }

    const aliases: PathAlias[] = [];
    for (const [pattern, rawTargets] of Object.entries(paths)) {
      if (!Array.isArray(rawTargets)) {
        continue;
      }
      const targets = rawTargets.filter((target): target is string => typeof target === 'string');
      if (targets.length > 0) {
        aliases.push({ pattern, targets, basePath });
      }
    }
    return aliases;
  }

  private async readAppAliases(rootPath: string): Promise<PathAlias[]> {
    const appConfig = await this.readJson(vscode.Uri.file(path.join(rootPath, 'app.json')));
    const resolveAlias = appConfig?.resolveAlias;
    if (!resolveAlias || typeof resolveAlias !== 'object') {
      return [];
    }

    const aliases: PathAlias[] = [];
    for (const [pattern, target] of Object.entries(resolveAlias)) {
      if (typeof target === 'string') {
        aliases.push({ pattern, targets: [target], basePath: rootPath });
      }
    }
    return aliases;
  }

  companionUri(uri: vscode.Uri, extension: '.js' | '.wxss' | '.wxml'): vscode.Uri {
    const parsed = path.parse(uri.fsPath);
    return vscode.Uri.file(path.join(parsed.dir, `${parsed.name}${extension}`));
  }

  async findClassDefinitions(uri: vscode.Uri, className: string, seen = new Set<string>()): Promise<vscode.Location[]> {
    const key = uri.toString();
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);

    const wxss = await this.getWxss(uri);
    if (!wxss) {
      return [];
    }

    const locations = [...(wxss.classes.get(className) ?? [])];
    for (const spec of wxss.imports) {
      const imported = await this.resolveModule(uri, spec, '.wxss');
      if (imported) {
        locations.push(...await this.findClassDefinitions(imported, className, seen));
      }
    }
    return locations;
  }

  private async readText(uri: vscode.Uri): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  private async readJson(uri: vscode.Uri): Promise<any | undefined> {
    const text = await this.readText(uri);
    if (text === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }
}

function expandAlias(spec: string, alias: PathAlias): string[] {
  const patternStar = alias.pattern.indexOf('*');
  if (patternStar === -1) {
    if (spec !== alias.pattern) {
      return [];
    }
    return alias.targets.map((target) => path.resolve(alias.basePath, target));
  }

  const prefix = alias.pattern.slice(0, patternStar);
  const suffix = alias.pattern.slice(patternStar + 1);
  if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) {
    return [];
  }

  const matched = spec.slice(prefix.length, spec.length - suffix.length);
  return alias.targets.map((target) => path.resolve(alias.basePath, target.replace('*', matched)));
}
