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
};

export type FileLanguageGroup = {
	baseName: string;
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
};

export type ScanResultMessage = {
	command: 'scanResult';
	error: string | null;
	groupedFiles?: FileLanguageGroup[];
	totalFiles?: number;
	folder?: string;
};
