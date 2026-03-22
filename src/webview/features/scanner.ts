import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TRANSLATION_FILE_PATTERN } from '../../constants';
import { FileLanguageGroup, ScanMessage, ScanResultMessage } from '../../types';
import { getWorkspaceRoot, groupFilesByBaseName, isPathInsideWorkspace } from '../../utils';
import { saveScanFolderPath } from '../settings';

export async function handleScanRequest(panel: vscode.WebviewPanel, message: ScanMessage): Promise<void> {
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

export async function sendScanResult(panel: vscode.WebviewPanel, error: string, _files: string[]): Promise<void> {
	await panel.webview.postMessage({
		command: 'scanResult',
		error,
		groupedFiles: [],
		totalFiles: 0
	} as ScanResultMessage);
}

export async function sendScanResultWithFiles(
	panel: vscode.WebviewPanel,
	files: string[],
	folder: string
): Promise<void> {
	const groupedFiles: FileLanguageGroup[] = groupFilesByBaseName(files);

	await panel.webview.postMessage({
		command: 'scanResult',
		error: null,
		groupedFiles,
		totalFiles: files.length,
		folder: folder || '.'
	} as ScanResultMessage);
}

export async function handlePickFolderRequest(panel: vscode.WebviewPanel): Promise<void> {
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
