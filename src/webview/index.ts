/**
 * Webview UI and logic for the translation scanner
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	TRANSLATION_FILE_PATTERN,
	WEBVIEW_PANEL_ID,
	WEBVIEW_PANEL_TITLE,
	CONFIG_SECTION,
	CONFIG_SCAN_FOLDER_KEY
} from '../constants';
import {
	ScanMessage,
	OpenFileGroupMessage,
	SaveCellMessage,
	AddKeyMessage,
	DeleteKeyMessage,
	PickFolderMessage,
	ScanResultMessage,
	FileLanguageGroup,
	FileContentMessage,
	SaveCellResultMessage,
	KeyMutationResultMessage
} from '../types';
import {
	getWorkspaceRoot,
	isPathInsideWorkspace,
	groupFilesByBaseName,
	parseFileGroup,
	parseFileName,
	parseResxFile,
	updateResxEntryField,
	renameResxEntryName,
	addResxEntry,
	deleteResxEntry
} from '../utils';

let translationScannerPanel: vscode.WebviewPanel | undefined;

/**
 * Creates and opens the translation scanner webview panel
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
 * Sets up the message listener for webview communication
 */
function setupWebviewMessageListener(panel: vscode.WebviewPanel): void {
	panel.webview.onDidReceiveMessage(async (message: ScanMessage | OpenFileGroupMessage | SaveCellMessage | AddKeyMessage | DeleteKeyMessage | PickFolderMessage) => {
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
	await saveScanFolderPath(normalizedInput);
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

		// Find the file group in the current scan results by matching folder + basename.
		// Limit lookup to configured translation file formats, then filter by group identity.
		const translationPattern = new vscode.RelativePattern(workspaceRoot, TRANSLATION_FILE_PATTERN);
		const translationFiles = await vscode.workspace.findFiles(translationPattern, '**/node_modules/**');
		const matchedFiles = translationFiles.filter((file) => {
			const relativePath = path.relative(workspaceRoot.fsPath, file.fsPath).replace(/\\/g, '/');
			const parsed = parseFileName(relativePath);
			const relativeFolderPath = path.posix.dirname(relativePath);
			const normalizedFolderPath = relativeFolderPath === '.' ? '' : relativeFolderPath;
			return parsed.baseName === message.baseName && normalizedFolderPath === message.folderPath;
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
		const defaultFilePath = relativeFiles.find((file) => parseFileName(file).languageCode === null);
		const languageFilePaths: Record<string, string> = {};
		for (const file of relativeFiles) {
			const { languageCode } = parseFileName(file);
			if (languageCode && !languageFilePaths[languageCode]) {
				languageFilePaths[languageCode] = file;
			}
		}

		// Send the parsed content back
		await panel.webview.postMessage({
			command: 'fileContent',
			error: undefined,
			baseName: message.baseName,
			languages,
			keys,
			defaultFilePath,
			languageFilePaths,
			allFilePaths: relativeFiles
		} as FileContentMessage);
	} catch (error) {
		const errorMsg = error instanceof Error ? error.message : 'Unknown error';
		await sendFileContentError(panel, 'Failed to read file group: ' + errorMsg);
	}
}

async function handleSaveCellRequest(panel: vscode.WebviewPanel, message: SaveCellMessage): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		await panel.webview.postMessage({
			command: 'saveCellResult',
			error: 'No workspace open.'
		} as SaveCellResultMessage);
		return;
	}

	try {
		if (message.field === 'name') {
			if (!message.allFilePaths || message.allFilePaths.length === 0) {
				throw new Error('No files available for key rename.');
			}

			const oldKeyName = message.keyName.trim();
			const newKeyName = message.value.trim();
			if (!newKeyName) {
				throw new Error('Key name cannot be empty.');
			}

			if (oldKeyName !== newKeyName) {
				const newKeyNameLower = newKeyName.toLocaleLowerCase();
				const oldKeyNameLower = oldKeyName.toLocaleLowerCase();
				for (const relativeFilePath of message.allFilePaths) {
					const filePath = path.resolve(workspaceRoot.fsPath, relativeFilePath);
					if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
						continue;
					}

					const entries = await parseResxFile(filePath);
					const duplicateExists = Array.from(entries.keys()).some((existingKey) => {
						const existingLower = existingKey.toLocaleLowerCase();
						if (existingLower === oldKeyNameLower) {
							return false;
						}
						return existingLower === newKeyNameLower;
					});

					if (duplicateExists) {
						throw new Error(`Key "${newKeyName}" already exists.`);
					}
				}
			}

			for (const relativeFilePath of message.allFilePaths) {
				const filePath = path.resolve(workspaceRoot.fsPath, relativeFilePath);
				if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
					continue;
				}
				await renameResxEntryName(filePath, oldKeyName, newKeyName);
			}
		} else {
			if (!message.filePath) {
				throw new Error('No source file provided for save.');
			}

			const filePath = path.resolve(workspaceRoot.fsPath, message.filePath);
			if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
				throw new Error('Target file is outside workspace.');
			}

			const targetField = message.field === 'comment' ? 'comment' : 'value';
			await updateResxEntryField(filePath, message.keyName, targetField, message.value);
		}

		await panel.webview.postMessage({
			command: 'saveCellResult',
			keyName: message.value.trim()
		} as SaveCellResultMessage);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown save error';
		await panel.webview.postMessage({
			command: 'saveCellResult',
			error: errorMessage,
			keyName: message.keyName
		} as SaveCellResultMessage);
	}
}

async function handleAddKeyRequest(panel: vscode.WebviewPanel, message: AddKeyMessage): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		await panel.webview.postMessage({
			command: 'keyMutationResult',
			action: 'add',
			error: 'No workspace open.'
		} as KeyMutationResultMessage);
		return;
	}

	try {
		const keyName = message.keyName.trim();
		const keyNameLower = keyName.toLocaleLowerCase();
		if (!keyName) {
			throw new Error('Key name cannot be empty.');
		}

		if (!message.allFilePaths || message.allFilePaths.length === 0) {
			throw new Error('No source files available for adding key.');
		}

		for (const relativeFilePath of message.allFilePaths) {
			const filePath = path.resolve(workspaceRoot.fsPath, relativeFilePath);
			if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
				continue;
			}

			const entries = await parseResxFile(filePath);
			const duplicateExists = Array.from(entries.keys()).some((existingKey) => existingKey.toLocaleLowerCase() === keyNameLower);
			if (duplicateExists) {
				throw new Error(`Key "${keyName}" already exists.`);
			}
		}

		for (const relativeFilePath of message.allFilePaths) {
			const filePath = path.resolve(workspaceRoot.fsPath, relativeFilePath);
			if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
				continue;
			}
			await addResxEntry(filePath, keyName);
		}

		await panel.webview.postMessage({
			command: 'keyMutationResult',
			action: 'add',
			keyName
		} as KeyMutationResultMessage);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown add key error';
		await panel.webview.postMessage({
			command: 'keyMutationResult',
			action: 'add',
			error: errorMessage,
			keyName: message.keyName
		} as KeyMutationResultMessage);
	}
}

async function handleDeleteKeyRequest(panel: vscode.WebviewPanel, message: DeleteKeyMessage): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();
	if (!workspaceRoot) {
		await panel.webview.postMessage({
			command: 'keyMutationResult',
			action: 'delete',
			error: 'No workspace open.'
		} as KeyMutationResultMessage);
		return;
	}

	try {
		if (!message.keyName.trim()) {
			throw new Error('Key name cannot be empty.');
		}

		if (!message.allFilePaths || message.allFilePaths.length === 0) {
			throw new Error('No source files available for deleting key.');
		}

		for (const relativeFilePath of message.allFilePaths) {
			const filePath = path.resolve(workspaceRoot.fsPath, relativeFilePath);
			if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
				continue;
			}
			await deleteResxEntry(filePath, message.keyName.trim());
		}

		await panel.webview.postMessage({
			command: 'keyMutationResult',
			action: 'delete',
			keyName: message.keyName.trim()
		} as KeyMutationResultMessage);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown delete key error';
		await panel.webview.postMessage({
			command: 'keyMutationResult',
			action: 'delete',
			error: errorMessage,
			keyName: message.keyName
		} as KeyMutationResultMessage);
	}
}

/**
 * Handles the folder picker request from the webview
 */
async function handlePickFolderRequest(panel: vscode.WebviewPanel): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();

	if (!workspaceRoot) {
		return;
	}

	const selectedFolders = await vscode.window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		defaultUri: workspaceRoot
	});

	if (selectedFolders && selectedFolders.length > 0) {
		const selectedPath = path.relative(workspaceRoot.fsPath, selectedFolders[0].fsPath).replace(/\\/g, '/');
		await panel.webview.postMessage({
			command: 'folderPath',
			path: selectedPath
		});
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
async function getScannerWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
	const webviewRoot = vscode.Uri.joinPath(extensionUri, 'media', 'webview');
	const htmlTemplatePath = vscode.Uri.joinPath(webviewRoot, 'index.html');
	const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'styles.css')).toString();
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js')).toString();
	const savedFolderPath = escapeHtmlAttribute(getSavedScanFolderPath());
	const htmlTemplate = await fs.readFile(htmlTemplatePath.fsPath, 'utf8');

	return htmlTemplate
		.replaceAll('{{cspSource}}', webview.cspSource)
		.replaceAll('{{savedFolderPath}}', savedFolderPath)
		.replaceAll('{{stylesheetUri}}', stylesheetUri)
		.replaceAll('{{scriptUri}}', scriptUri);
}

function getSavedScanFolderPath(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<string>(CONFIG_SCAN_FOLDER_KEY, '');
}

async function saveScanFolderPath(folderPath: string): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	try {
		await config.update(CONFIG_SCAN_FOLDER_KEY, folderPath, vscode.ConfigurationTarget.Workspace);
	} catch {
		// Non-blocking: scan should continue even if settings persistence fails.
	}
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
