import * as vscode from 'vscode';
import { COMMAND_OPEN_SCANNER } from './constants';
import { openTranslationScannerPanel } from './webview';

/**
 * Extension activation - called when the command is first executed
 */
export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand(COMMAND_OPEN_SCANNER, openTranslationScannerPanel);
	context.subscriptions.push(disposable);
}

/**
 * Extension deactivation - cleanup happens here
 */
export function deactivate() {}
