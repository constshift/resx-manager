/**
 * Webview entrypoint and message routing for the translation scanner.
 */

import * as vscode from 'vscode';
import { WEBVIEW_PANEL_ID, WEBVIEW_PANEL_TITLE } from '../constants';
import {
	AddKeyMessage,
	BatchTranslateMessage,
	DeleteKeyMessage,
	OpenFileGroupMessage,
	PickFolderMessage,
	SaveCellMessage,
	ScanMessage
} from '../types';
import {
	handleAddKeyRequest,
	handleDeleteKeyRequest,
	handleOpenFileGroupRequest,
	handleSaveCellRequest
} from './features/file-view';
import { handlePickFolderRequest, handleScanRequest } from './features/scanner';
import { handleBatchTranslateRequest } from './features/translation';
import { getScannerWebviewHtml } from './template';

let translationScannerPanel: vscode.WebviewPanel | undefined;

/**
 * Creates and opens the translation scanner webview panel.
 */
export async function openTranslationScannerPanel(context: vscode.ExtensionContext): Promise<void> {
	if (translationScannerPanel) {
		translationScannerPanel.reveal(vscode.ViewColumn.One);
		return;
	}

	const panel = vscode.window.createWebviewPanel(
		WEBVIEW_PANEL_ID,
		WEBVIEW_PANEL_TITLE,
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media', 'webview')]
		}
	);

	translationScannerPanel = panel;
	panel.onDidDispose(() => {
		translationScannerPanel = undefined;
	});

	panel.onDidChangeViewState(async (event) => {
		if (!event.webviewPanel.visible) {
			return;
		}

		await event.webviewPanel.webview.postMessage({
			command: 'panelVisible'
		});
	});

	panel.webview.html = await getScannerWebviewHtml(panel.webview, context.extensionUri);
	setupWebviewMessageListener(panel);
}

/**
 * Sets up the message listener for webview communication.
 */
function setupWebviewMessageListener(panel: vscode.WebviewPanel): void {
	panel.webview.onDidReceiveMessage(
		async (
			message:
				| ScanMessage
				| OpenFileGroupMessage
				| SaveCellMessage
				| AddKeyMessage
				| DeleteKeyMessage
				| PickFolderMessage
				| BatchTranslateMessage
		) => {
			if (message.command === 'scan') {
				await handleScanRequest(panel, message as ScanMessage);
			} else if (message.command === 'openFileGroup') {
				await handleOpenFileGroupRequest(panel, message as OpenFileGroupMessage);
			} else if (message.command === 'saveCell') {
				await handleSaveCellRequest(panel, message as SaveCellMessage);
			} else if (message.command === 'addKey') {
				await handleAddKeyRequest(panel, message as AddKeyMessage);
			} else if (message.command === 'deleteKey') {
				await handleDeleteKeyRequest(panel, message as DeleteKeyMessage);
			} else if (message.command === 'pickFolder') {
				await handlePickFolderRequest(panel);
			} else if (message.command === 'batchTranslate') {
				await handleBatchTranslateRequest(panel, message as BatchTranslateMessage);
			}
		}
	);
}
