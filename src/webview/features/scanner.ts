import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TRANSLATION_FILE_PATTERN } from '../../constants';
import { FileLanguageGroup, ScanMessage, ScanResultMessage } from '../../types';
import { getWorkspaceRoot, groupFilesByBaseName, isPathInsideWorkspace } from '../../utils';
import { saveScanFolderPath } from '../settings';

const EXCLUDE_GLOB = '**/node_modules/**';

async function sendScanResult(panel: vscode.WebviewPanel, payload: Partial<ScanResultMessage>): Promise<void> {
	// Always send a complete shape so webview rendering logic can stay simple.
	await panel.webview.postMessage({
		command: 'scanResult',
		error: null,
		groupedFiles: [],
		totalFiles: 0,
		...payload
	} as ScanResultMessage);
}

function toRelativeWorkspacePath(workspaceRootPath: string, absoluteFilePath: string): string {
	return path.relative(workspaceRootPath, absoluteFilePath).replace(/\\/g, '/');
}

export async function handleScanRequest(panel: vscode.WebviewPanel, message: ScanMessage): Promise<void> {
	const workspaceRoot = getWorkspaceRoot();

	if (!workspaceRoot) {
		await sendScanResult(panel, { error: 'Open a workspace folder before scanning translation files.' });
		return;
	}

	const folderInput = message.folderPath.trim();
	const normalizedInput = folderInput.replace(/\\/g, '/');
	await saveScanFolderPath(normalizedInput);
	const folderAbsolutePath = path.resolve(workspaceRoot.fsPath, normalizedInput || '.');

	if (!isPathInsideWorkspace(workspaceRoot.fsPath, folderAbsolutePath)) {
		await sendScanResult(panel, { error: 'Please enter a folder path inside the current workspace.' });
		return;
	}

	try {
		const folderStats = await fs.stat(folderAbsolutePath);
		if (!folderStats.isDirectory()) {
			await sendScanResult(panel, { error: 'The provided path is not a folder.' });
			return;
		}

		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folderAbsolutePath, TRANSLATION_FILE_PATTERN),
			EXCLUDE_GLOB
		);

		const relativeFiles = files
			.map((file) => toRelativeWorkspacePath(workspaceRoot.fsPath, file.fsPath))
			.sort((a, b) => a.localeCompare(b));

		await sendScanResultWithFiles(panel, relativeFiles, normalizedInput);
	} catch {
		await sendScanResult(panel, { error: 'Could not access that folder. Verify the path and try again.' });
	}
}

export async function sendScanResultWithFiles(
	panel: vscode.WebviewPanel,
	files: string[],
	folder: string
): Promise<void> {
	const groupedFiles: FileLanguageGroup[] = groupFilesByBaseName(files);

	await sendScanResult(panel, {
		groupedFiles,
		totalFiles: files.length,
		folder: folder || '.'
	});
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
		const selectedPath = toRelativeWorkspacePath(workspaceRoot.fsPath, selectedFolders[0].fsPath);
		await panel.webview.postMessage({
			command: 'folderPath',
			path: selectedPath
		});
	}
}
