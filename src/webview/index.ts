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
type WebviewInboundMessage =
	| ScanMessage
	| OpenFileGroupMessage
	| SaveCellMessage
	| AddKeyMessage
	| DeleteKeyMessage
	| PickFolderMessage
	| BatchTranslateMessage;

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
		async (message: WebviewInboundMessage) => {
			switch (message.command) {
				case 'scan':
					await handleScanRequest(panel, message);
					return;
				case 'openFileGroup':
					await handleOpenFileGroupRequest(panel, message);
					return;
				case 'saveCell':
					await handleSaveCellRequest(panel, message);
					return;
				case 'addKey':
					await handleAddKeyRequest(panel, message);
					return;
				case 'deleteKey':
					await handleDeleteKeyRequest(panel, message);
					return;
				case 'pickFolder':
					await handlePickFolderRequest(panel);
					return;
				case 'batchTranslate':
					await handleBatchTranslateRequest(panel, message);
					return;
				default:
					return;
			}
		}
	);
}
