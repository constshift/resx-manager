import * as path from 'node:path';
import * as vscode from 'vscode';
import {
	AddKeyMessage,
	DeleteKeyMessage,
	FileContentMessage,
	KeyMutationResultMessage,
	OpenFileGroupMessage,
	SaveCellMessage,
	SaveCellResultMessage
} from '../../types';
import { TRANSLATION_FILE_PATTERN } from '../../constants';
import {
	addResxEntry,
	deleteResxEntry,
	getWorkspaceRoot,
	isPathInsideWorkspace,
	parseFileGroup,
	parseFileName,
	parseResxFile,
	renameResxEntryName,
	updateResxEntryField
} from '../../utils';

export async function handleOpenFileGroupRequest(panel: vscode.WebviewPanel, message: OpenFileGroupMessage): Promise<void> {
	try {
		const workspaceRoot = getWorkspaceRoot();
		if (!workspaceRoot) {
			await sendFileContentError(panel, 'No workspace open.');
			return;
		}

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

		const relativeFiles = matchedFiles.map((file) =>
			path.relative(workspaceRoot.fsPath, file.fsPath).replace(/\\/g, '/')
		);

		const { languages, keys } = await parseFileGroup(workspaceRoot.fsPath, relativeFiles);
		const defaultFilePath = relativeFiles.find((file) => parseFileName(file).languageCode === null);
		const languageFilePaths: Record<string, string> = {};
		for (const file of relativeFiles) {
			const { languageCode } = parseFileName(file);
			if (languageCode && !languageFilePaths[languageCode]) {
				languageFilePaths[languageCode] = file;
			}
		}

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

export async function handleSaveCellRequest(panel: vscode.WebviewPanel, message: SaveCellMessage): Promise<void> {
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

export async function handleAddKeyRequest(panel: vscode.WebviewPanel, message: AddKeyMessage): Promise<void> {
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
			const isDefaultFile = parseFileName(relativeFilePath).languageCode === null;
			await addResxEntry(filePath, keyName, isDefaultFile ? keyName : '');
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

export async function handleDeleteKeyRequest(panel: vscode.WebviewPanel, message: DeleteKeyMessage): Promise<void> {
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

async function sendFileContentError(panel: vscode.WebviewPanel, error: string): Promise<void> {
	await panel.webview.postMessage({
		command: 'fileContent',
		error
	} as FileContentMessage);
}
