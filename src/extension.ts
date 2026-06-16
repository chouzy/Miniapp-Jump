import * as vscode from 'vscode';
import { MiniappDefinitionProvider } from './definitionProvider';
import { MiniappIndex } from './index';
import { MiniappReferenceProvider } from './referenceProvider';

export function activate(context: vscode.ExtensionContext): void {
  const index = new MiniappIndex();
  const provider = new MiniappDefinitionProvider(index);
  const referenceProvider = new MiniappReferenceProvider(index);

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'wxml' },
        { scheme: 'file', pattern: '**/*.wxml' },
        { scheme: 'file', language: 'wxss' }
      ],
      provider
    ),
    vscode.languages.registerReferenceProvider(
      { scheme: 'file', language: 'javascript' },
      referenceProvider
    ),
    vscode.commands.registerCommand('miniappJump.rebuildIndex', () => {
      index.clear();
      vscode.window.showInformationMessage('Miniapp Jump index rebuilt.');
    }),
    vscode.commands.registerCommand('miniappJump.showDebugInfo', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Miniapp Jump: no active editor.');
        return;
      }

      vscode.window.showInformationMessage((await provider.debugInfo(editor.document, editor.selection.active)).join(' '));
    }),
    vscode.commands.registerCommand('miniappJump.findReferences', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('Miniapp Jump: no active editor.');
        return;
      }

      const position = editor.selection.active;
      const references = await referenceProvider.findReferences(editor.document, position);
      if (!references) {
        await vscode.commands.executeCommand('editor.action.referenceSearch.trigger');
        return;
      }
      if (references.length === 0) {
        vscode.window.showInformationMessage('Miniapp Jump: no references found.');
        return;
      }

      await vscode.commands.executeCommand(
        'editor.action.showReferences',
        editor.document.uri,
        position,
        references
      );
    }),
    vscode.workspace.onDidChangeTextDocument((event) => index.invalidate(event.document.uri)),
    vscode.workspace.onDidSaveTextDocument((document) => index.invalidate(document.uri)),
    createWatcher('**/*.js', index),
    createWatcher('**/*.wxml', index),
    createWatcher('**/*.wxss', index)
  );
}

export function deactivate(): void {}

function createWatcher(pattern: string, index: MiniappIndex): vscode.FileSystemWatcher {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidChange((uri) => index.invalidate(uri));
  watcher.onDidCreate((uri) => index.invalidate(uri));
  watcher.onDidDelete((uri) => index.invalidate(uri));
  return watcher;
}
