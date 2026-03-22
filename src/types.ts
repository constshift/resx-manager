/**
 * Type definitions for the extension
 */

export type ScanMessage = {
	command: 'scan';
	folderPath: string;
};

export type OpenFileGroupMessage = {
	command: 'openFileGroup';
	baseName: string;
	folderPath: string;
};

export type SaveCellMessage = {
	command: 'saveCell';
	field: 'name' | 'value' | 'comment' | 'language';
	keyName: string;
	value: string;
	filePath?: string;
	allFilePaths?: string[];
};

export type AddKeyMessage = {
	command: 'addKey';
	keyName: string;
	allFilePaths: string[];
};

export type DeleteKeyMessage = {
	command: 'deleteKey';
	keyName: string;
	allFilePaths: string[];
};

export type PickFolderMessage = {
	command: 'pickFolder';
};

export type FileLanguageGroup = {
	baseName: string;
	folderPath: string;
	languages: string[];
	files: string[];
};

export type TranslationKeyRow = {
	name: string;
	value: string;
	comment: string;
	[languageCode: string]: string;
};

export type FileContentMessage = {
	command: 'fileContent';
	error?: string;
	baseName?: string;
	languages?: string[];
	keys?: TranslationKeyRow[];
	defaultFilePath?: string;
	languageFilePaths?: Record<string, string>;
	allFilePaths?: string[];
};

export type SaveCellResultMessage = {
	command: 'saveCellResult';
	error?: string;
	keyName?: string;
};

export type KeyMutationResultMessage = {
	command: 'keyMutationResult';
	action: 'add' | 'delete';
	error?: string;
	keyName?: string;
};

export type ScanResultMessage = {
	command: 'scanResult';
	error: string | null;
	groupedFiles?: FileLanguageGroup[];
	totalFiles?: number;
	folder?: string;
};
