/**
 * Webview UI and logic for the translation scanner
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TRANSLATION_FILE_PATTERN, WEBVIEW_PANEL_ID, WEBVIEW_PANEL_TITLE } from './constants';
import { ScanMessage, OpenFileGroupMessage, ScanResultMessage, FileLanguageGroup, FileContentMessage } from './types';
import { getWorkspaceRoot, isPathInsideWorkspace, groupFilesByBaseName, parseFileGroup, parseFileName } from './utils';

let translationScannerPanel: vscode.WebviewPanel | undefined;

/**
 * Creates and opens the translation scanner webview panel
 */
export function openTranslationScannerPanel(): void {
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
			retainContextWhenHidden: true
		}
	);

	translationScannerPanel = panel;
	panel.onDidDispose(() => {
		translationScannerPanel = undefined;
	});

	panel.webview.html = getScannerWebviewHtml();
	setupWebviewMessageListener(panel);
}

/**
 * Sets up the message listener for webview communication
 */
function setupWebviewMessageListener(panel: vscode.WebviewPanel): void {
	panel.webview.onDidReceiveMessage(async (message: ScanMessage | OpenFileGroupMessage) => {
		if (message.command === 'scan') {
			await handleScanRequest(panel, message as ScanMessage);
		} else if (message.command === 'openFileGroup') {
			await handleOpenFileGroupRequest(panel, message as OpenFileGroupMessage);
		}
	});
}

/**
 * Handles the scan request from the webview
 */
async function handleScanRequest(panel: vscode.WebviewPanel, message: ScanMessage): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();

	if (!workspaceRoot) {
		await sendScanResult(panel, 'Open a workspace folder before scanning translation files.', []);
		return;
	}

	const folderInput = message.folderPath.trim();
	const normalizedInput = folderInput.replace(/\\/g, '/');
	const folderAbsolutePath = path.resolve(workspaceRoot.fsPath, normalizedInput || '.');

	if (!isPathInsideWorkspace(workspaceRoot.fsPath, folderAbsolutePath)) {
		await sendScanResult(panel, 'Please enter a folder path inside the current workspace.', []);
		return;
	}

	try {
		const folderStats = await fs.stat(folderAbsolutePath);
		if (!folderStats.isDirectory()) {
			await sendScanResult(panel, 'The provided path is not a folder.', []);
			return;
		}

		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folderAbsolutePath, TRANSLATION_FILE_PATTERN),
			'**/node_modules/**'
		);

		const relativeFiles = files
			.map((file) => path.relative(workspaceRoot.fsPath, file.fsPath).replace(/\\/g, '/'))
			.sort((a, b) => a.localeCompare(b));

		await sendScanResultWithFiles(panel, relativeFiles, normalizedInput);
	} catch {
		await sendScanResult(panel, 'Could not access that folder. Verify the path and try again.', []);
	}
}

/**
 * Sends a scan result message back to the webview
 */
async function sendScanResult(panel: vscode.WebviewPanel, error: string, _files: string[]): Promise<void> {
	await panel.webview.postMessage({
		command: 'scanResult',
		error,
		groupedFiles: [],
		totalFiles: 0
	} as ScanResultMessage);
}

/**
 * Sends a successful scan result with grouped files to the webview
 */
async function sendScanResultWithFiles(
	panel: vscode.WebviewPanel,
	files: string[],
	folder: string
): Promise<void> {
	const groupedFiles = groupFilesByBaseName(files);

	await panel.webview.postMessage({
		command: 'scanResult',
		error: null,
		groupedFiles,
		totalFiles: files.length,
		folder: folder || '.'
	} as ScanResultMessage);
}

/**
 * Handles opening a file group and reading all its variants
 */
async function handleOpenFileGroupRequest(panel: vscode.WebviewPanel, message: OpenFileGroupMessage): Promise<void> {
	try {
		const workspaceRoot = getWorkspaceRoot();
		if (!workspaceRoot) {
			await sendFileContentError(panel, 'No workspace open.');
			return;
		}

		// Find the file group in the current scan results by matching the basename
		// Limit lookup to configured translation file formats, then filter by base name.
		const translationPattern = new vscode.RelativePattern(workspaceRoot, TRANSLATION_FILE_PATTERN);
		const translationFiles = await vscode.workspace.findFiles(translationPattern, '**/node_modules/**');
		const matchedFiles = translationFiles.filter((file) => {
			const relativePath = path.relative(workspaceRoot.fsPath, file.fsPath).replace(/\\/g, '/');
			return parseFileName(relativePath).baseName === message.baseName;
		});

		if (matchedFiles.length === 0) {
			await sendFileContentError(panel, 'No files found for: ' + message.baseName);
			return;
		}

		// Convert back to relative paths
		const relativeFiles = matchedFiles.map((file) =>
			path.relative(workspaceRoot.fsPath, file.fsPath).replace(/\\/g, '/')
		);

		// Parse all files in the group
		const { languages, keys } = await parseFileGroup(workspaceRoot.fsPath, relativeFiles);

		// Send the parsed content back
		await panel.webview.postMessage({
			command: 'fileContent',
			error: undefined,
			baseName: message.baseName,
			languages,
			keys
		} as FileContentMessage);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		await sendFileContentError(panel, 'Failed to read file group: ' + errorMsg);
	}
}

/**
 * Sends a file content error message to the webview
 */
async function sendFileContentError(panel: vscode.WebviewPanel, error: string): Promise<void> {
	await panel.webview.postMessage({
		command: 'fileContent',
		error
	} as FileContentMessage);
}

/**
 * Generates the HTML content for the scanner webview
 */
function getScannerWebviewHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Translation Scanner</title>
	<style>
		* {
			box-sizing: border-box;
		}
		body {
			font-family: var(--vscode-font-family);
			margin: 0;
			padding: 0;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
			display: flex;
			flex-direction: column;
			height: 100vh;
		}
		.header {
			padding: 12px 16px;
			border-bottom: 1px solid var(--vscode-input-border);
			flex-shrink: 0;
		}
		.scan-input-group {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		label {
			font-weight: 600;
		}
		input {
			flex: 1;
			max-width: 300px;
			padding: 8px;
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
		}
		button {
			padding: 8px 12px;
			border: none;
			border-radius: 4px;
			cursor: pointer;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			white-space: nowrap;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.status {
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			margin-top: 4px;
			min-height: 16px;
		}
		.status.error {
			color: var(--vscode-errorForeground);
		}
		.content {
			flex: 1;
			display: flex;
			overflow: hidden;
		}
		.sidebar {
			width: 250px;
			border-right: 1px solid var(--vscode-input-border);
			overflow-y: auto;
			padding: 8px 0;
			flex-shrink: 0;
		}
		.base-name-item {
			padding: 8px 12px;
			cursor: pointer;
			user-select: none;
			border-left: 3px solid transparent;
			font-weight: 500;
		}
		.base-name-item:hover {
			background-color: rgba(255, 255, 255, 0.08);
		}
		.base-name-item.active {
			background-color: var(--vscode-inputOption-activeBackground);
			color: var(--vscode-foreground);
			border-left-color: var(--vscode-inputOption-activeBorder);
		}
		.language-codes {
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			padding: 0 12px 4px 12px;
		}
		.language-badge {
			display: inline-block;
			background-color: var(--vscode-inputOption-activeBorder);
			color: var(--vscode-editor-background);
			padding: 1px 4px;
			border-radius: 2px;
			margin-right: 3px;
			font-size: 10px;
		}
		.main {
			flex: 1;
			display: flex;
			flex-direction: column;
			padding: 12px 16px;
			overflow: hidden;
		}
		.editor-title {
			font-weight: 600;
			padding-bottom: 8px;
			border-bottom: 1px solid var(--vscode-input-border);
			margin-bottom: 8px;
			min-height: 24px;
		}
		.table-container {
			flex: 1;
			overflow: auto;
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
		}
		table {
			width: 100%;
			border-collapse: collapse;
			font-size: 12px;
		}
		thead {
			position: sticky;
			top: 0;
			background-color: var(--vscode-input-background);
			color: var(--vscode-foreground);
		}
		th {
			padding: 8px;
			text-align: left;
			border-bottom: 1px solid var(--vscode-input-border);
			font-weight: 600;
			border-right: 1px solid var(--vscode-input-border);
		}
		th:last-child {
			border-right: none;
		}
		td {
			padding: 8px;
			border-bottom: 1px solid rgba(255, 255, 255, 0.1);
			border-right: 1px solid rgba(255, 255, 255, 0.05);
			word-break: break-word;
		}
		td:last-child {
			border-right: none;
		}
		tr:hover {
			background-color: rgba(255, 255, 255, 0.05);
		}
		.no-file-selected {
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100%;
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<div class="header">
		<div class="scan-input-group">
			<label for="folderPath">Folder:</label>
			<input id="folderPath" type="text" placeholder="e.g. src/translations" />
			<button id="scanButton" type="button">Scan</button>
		</div>
		<div id="status" class="status"></div>
	</div>

	<div class="content">
		<div class="sidebar" id="sidebar">
			<div id="fileList"></div>
		</div>
		<div class="main">
			<div class="editor-title" id="editorTitle">Select a translation file to view</div>
			<div id="tableContainer" class="table-container">
				<div class="no-file-selected">No file selected</div>
			</div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();
		const folderInput = document.getElementById('folderPath');
		const scanButton = document.getElementById('scanButton');
		const status = document.getElementById('status');
		const fileList = document.getElementById('fileList');
		const editorTitle = document.getElementById('editorTitle');
		const tableContainer = document.getElementById('tableContainer');

		let fileGroups = [];

		scanButton.addEventListener('click', () => {
			status.textContent = 'Scanning...';
			status.classList.remove('error');
			fileList.innerHTML = '';
			tableContainer.innerHTML = '<div class="no-file-selected">No file selected</div>';
			editorTitle.textContent = 'Select a translation file to view';
			vscode.postMessage({
				command: 'scan',
				folderPath: folderInput.value
			});
		});

		function displayFileGroups(groups) {
			fileGroups = groups;
			fileList.innerHTML = '';

			for (const group of groups) {
				// Create a container for the base name
				const groupContainer = document.createElement('div');

				// Create clickable base name item
				const baseNameItem = document.createElement('div');
				baseNameItem.className = 'base-name-item';
				baseNameItem.textContent = group.baseName;
				baseNameItem.addEventListener('click', () => {
					document.querySelectorAll('.base-name-item').forEach(item => item.classList.remove('active'));
					baseNameItem.classList.add('active');
					vscode.postMessage({
						command: 'openFileGroup',
						baseName: group.baseName
					});
				});
				groupContainer.appendChild(baseNameItem);

				fileList.appendChild(groupContainer);
			}
		}

		function displayFileContent(baseName, languages, keys) {
			editorTitle.textContent = baseName;
			
			if (!keys || keys.length === 0) {
				tableContainer.innerHTML = '<div class="no-file-selected">No translation keys found</div>';
				return;
			}

			const table = document.createElement('table');
			const thead = document.createElement('thead');
			const headerRow = document.createElement('tr');

			const nameHeader = document.createElement('th');
			nameHeader.textContent = 'Name';
			headerRow.appendChild(nameHeader);

			const valueHeader = document.createElement('th');
			valueHeader.textContent = 'Value';
			headerRow.appendChild(valueHeader);

			const commentHeader = document.createElement('th');
			commentHeader.textContent = 'Comment';
			headerRow.appendChild(commentHeader);

			// Language column headers
			for (const lang of languages) {
				const langHeader = document.createElement('th');
				langHeader.textContent = lang;
				headerRow.appendChild(langHeader);
			}

			thead.appendChild(headerRow);
			table.appendChild(thead);

			const tbody = document.createElement('tbody');
			for (const row of keys) {
				const tr = document.createElement('tr');

				const nameCell = document.createElement('td');
				nameCell.textContent = row.name;
				nameCell.style.fontWeight = '500';
				tr.appendChild(nameCell);

				const defaultValueCell = document.createElement('td');
				defaultValueCell.textContent = row.value || '';
				tr.appendChild(defaultValueCell);

				const commentCell = document.createElement('td');
				commentCell.textContent = row.comment || '';
				tr.appendChild(commentCell);

				// Language value cells
				for (const lang of languages) {
					const valueCell = document.createElement('td');
					valueCell.textContent = row[lang] || '';
					tr.appendChild(valueCell);
				}

				tbody.appendChild(tr);
			}

			table.appendChild(tbody);
			tableContainer.innerHTML = '';
			tableContainer.appendChild(table);
		}

		window.addEventListener('message', (event) => {
			const message = event.data;

			if (message.command === 'scanResult') {
				if (message.error) {
					status.textContent = message.error;
					status.classList.add('error');
					fileList.innerHTML = '';
					return;
				}

				status.classList.remove('error');
				status.textContent = 'Found ' + message.totalFiles + ' file(s) in ' + message.folder;
				displayFileGroups(message.groupedFiles || []);
			} else if (message.command === 'fileContent') {
				if (message.error) {
					tableContainer.innerHTML = '<div class="no-file-selected">Error: ' + message.error + '</div>';
					return;
				}

				displayFileContent(message.baseName, message.languages, message.keys);
			}
		});
	</script>
</body>
</html>`;
}
