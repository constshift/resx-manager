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

const EXCLUDE_GLOB = '**/node_modules/**';

type WorkspaceContext = {
	rootUri: vscode.Uri;
	rootPath: string;
};

function getWorkspaceContext(): WorkspaceContext | null {
	const rootUri = getWorkspaceRoot();
	if (!rootUri) {
		return null;
	}

	return {
		rootUri,
		rootPath: rootUri.fsPath
	};
}

function getWorkspaceFilePath(workspaceRootPath: string, relativeFilePath: string): string | null {
	// Resolve against workspace root and hard-stop any path traversal attempts.
	const absolutePath = path.resolve(workspaceRootPath, relativeFilePath);
	if (!isPathInsideWorkspace(workspaceRootPath, absolutePath)) {
		return null;
	}

	return absolutePath;
}

function getWorkspaceFilePaths(workspaceRootPath: string, relativeFilePaths: string[]): string[] {
	return relativeFilePaths
		.map((relativeFilePath) => getWorkspaceFilePath(workspaceRootPath, relativeFilePath))
		.filter((absolutePath): absolutePath is string => !!absolutePath);
}

async function sendFileContentError(panel: vscode.WebviewPanel, error: string): Promise<void> {
	await panel.webview.postMessage({
		command: 'fileContent',
		error
	} as FileContentMessage);
}

async function sendSaveCellResult(panel: vscode.WebviewPanel, payload: { error?: string; keyName?: string }): Promise<void> {
	await panel.webview.postMessage({
		command: 'saveCellResult',
		...payload
	} as SaveCellResultMessage);
}

async function sendKeyMutationResult(
	panel: vscode.WebviewPanel,
	action: 'add' | 'delete',
	payload: { error?: string; keyName?: string }
): Promise<void> {
	await panel.webview.postMessage({
		command: 'keyMutationResult',
		action,
		...payload
	} as KeyMutationResultMessage);
}

async function findDuplicateKeyName(
	absFilePaths: string[],
	targetKeyName: string,
	ignoredKeyName?: string
): Promise<boolean> {
	// Duplicate checks are case-insensitive to match user expectations in the UI.
	const targetKeyLower = targetKeyName.toLocaleLowerCase();
	const ignoredKeyLower = ignoredKeyName?.toLocaleLowerCase();

	for (const filePath of absFilePaths) {
		const entries = await parseResxFile(filePath);
		const duplicateExists = Array.from(entries.keys()).some((existingKey) => {
			const existingLower = existingKey.toLocaleLowerCase();
			if (ignoredKeyLower && existingLower === ignoredKeyLower) {
				return false;
			}
			return existingLower === targetKeyLower;
		});

		if (duplicateExists) {
			return true;
		}
	}

	return false;
}

export async function handleOpenFileGroupRequest(panel: vscode.WebviewPanel, message: OpenFileGroupMessage): Promise<void> {
	try {
		const workspace = getWorkspaceContext();
		if (!workspace) {
			await sendFileContentError(panel, 'No workspace open.');
			return;
		}

		const translationPattern = new vscode.RelativePattern(workspace.rootUri, TRANSLATION_FILE_PATTERN);
		const translationFiles = await vscode.workspace.findFiles(translationPattern, EXCLUDE_GLOB);
		const matchedFiles = translationFiles.filter((file) => {
			const relativePath = path.relative(workspace.rootPath, file.fsPath).replace(/\\/g, '/');
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
			path.relative(workspace.rootPath, file.fsPath).replace(/\\/g, '/')
		);

		const { languages, keys } = await parseFileGroup(workspace.rootPath, relativeFiles);
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
	const workspace = getWorkspaceContext();
	if (!workspace) {
		await sendSaveCellResult(panel, { error: 'No workspace open.' });
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
				const filePaths = getWorkspaceFilePaths(workspace.rootPath, message.allFilePaths);
				const duplicateExists = await findDuplicateKeyName(filePaths, newKeyName, oldKeyName);
				if (duplicateExists) {
					throw new Error(`Key "${newKeyName}" already exists.`);
				}
			}

			const filePaths = getWorkspaceFilePaths(workspace.rootPath, message.allFilePaths);
			for (const filePath of filePaths) {
				await renameResxEntryName(filePath, oldKeyName, newKeyName);
			}
		} else {
			if (!message.filePath) {
				throw new Error('No source file provided for save.');
			}

			const filePath = getWorkspaceFilePath(workspace.rootPath, message.filePath);
			if (!filePath) {
				throw new Error('Target file is outside workspace.');
			}

			const targetField = message.field === 'comment' ? 'comment' : 'value';
			await updateResxEntryField(filePath, message.keyName, targetField, message.value);
		}

		await sendSaveCellResult(panel, { keyName: message.value.trim() });
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown save error';
		await sendSaveCellResult(panel, {
			error: errorMessage,
			keyName: message.keyName
		});
	}
}

export async function handleAddKeyRequest(panel: vscode.WebviewPanel, message: AddKeyMessage): Promise<void> {
	const workspace = getWorkspaceContext();
	if (!workspace) {
		await sendKeyMutationResult(panel, 'add', { error: 'No workspace open.' });
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

		const filePaths = getWorkspaceFilePaths(workspace.rootPath, message.allFilePaths);
		const duplicateExists = await findDuplicateKeyName(filePaths, keyName);
		if (duplicateExists) {
			throw new Error(`Key "${keyName}" already exists.`);
		}

		for (const relativeFilePath of message.allFilePaths) {
			const filePath = getWorkspaceFilePath(workspace.rootPath, relativeFilePath);
			if (!filePath) {
				continue;
			}
			const isDefaultFile = parseFileName(relativeFilePath).languageCode === null;
			await addResxEntry(filePath, keyName, isDefaultFile ? keyName : '');
		}

		await sendKeyMutationResult(panel, 'add', { keyName });
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown add key error';
		await sendKeyMutationResult(panel, 'add', {
			error: errorMessage,
			keyName: message.keyName
		});
	}
}

export async function handleDeleteKeyRequest(panel: vscode.WebviewPanel, message: DeleteKeyMessage): Promise<void> {
	const workspace = getWorkspaceContext();
	if (!workspace) {
		await sendKeyMutationResult(panel, 'delete', { error: 'No workspace open.' });
		return;
	}

	try {
		if (!message.keyName.trim()) {
			throw new Error('Key name cannot be empty.');
		}

		if (!message.allFilePaths || message.allFilePaths.length === 0) {
			throw new Error('No source files available for deleting key.');
		}

		const keyName = message.keyName.trim();
		const filePaths = getWorkspaceFilePaths(workspace.rootPath, message.allFilePaths);
		for (const filePath of filePaths) {
			await deleteResxEntry(filePath, message.keyName.trim());
		}

		await sendKeyMutationResult(panel, 'delete', { keyName });
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown delete key error';
		await sendKeyMutationResult(panel, 'delete', {
			error: errorMessage,
			keyName: message.keyName
		});
	}
}
