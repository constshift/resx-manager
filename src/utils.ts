/**
 * Utility functions for workspace and file operations
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { FileLanguageGroup, TranslationKeyRow } from './types';

type ResxEntry = {
	name: string;
	value: string;
	comment: string;
};

type ResxDataBlock = {
	originalBlock: string;
	attributes: string;
	dataContent: string;
	name: string;
};

type ResxDataBlockMatch = ResxDataBlock & {
	startIndex: number;
	endIndex: number;
};

const DATA_BLOCK_REGEX = /<data\b([^>]*)>([\s\S]*?)<\/data>/g;
const DATA_BLOCK_WITH_TRAILING_SPACE_REGEX = /<data\b([^>]*)>([\s\S]*?)<\/data>\s*/g;
const ROOT_CLOSE_REGEX = /\s*<\/root>\s*$/i;
const RESX_TAG_INDENT_REGEX = /\n([ \t]*)<(?:value|comment)\b/i;

function toWorkspaceFileUri(filePath: string): vscode.Uri {
	return vscode.Uri.file(filePath);
}

async function readWorkspaceFileText(filePath: string): Promise<string> {
	const content = await vscode.workspace.fs.readFile(toWorkspaceFileUri(filePath));
	return new TextDecoder().decode(content);
}

async function writeWorkspaceFileText(filePath: string, text: string): Promise<void> {
	await vscode.workspace.fs.writeFile(toWorkspaceFileUri(filePath), new TextEncoder().encode(text));
}

function extractResxDataBlocks(xmlText: string): ResxDataBlock[] {
	return getResxDataBlockMatches(xmlText).map((block) => ({
		originalBlock: block.originalBlock,
		attributes: block.attributes,
		dataContent: block.dataContent,
		name: block.name
	}));
}

function getResxDataBlockMatches(xmlText: string, includeTrailingWhitespace = false): ResxDataBlockMatch[] {
	const regex = includeTrailingWhitespace ? DATA_BLOCK_WITH_TRAILING_SPACE_REGEX : DATA_BLOCK_REGEX;
	const matcher = new RegExp(regex.source, 'g');
	const matches: ResxDataBlockMatch[] = [];

	for (const match of xmlText.matchAll(matcher)) {
		const attributes = match[1] ?? '';
		const dataContent = match[2] ?? '';
		const nameMatch = attributes.match(/\bname\s*=\s*"([^"]+)"/i);
		if (!nameMatch) {
			continue;
		}

		const startIndex = match.index ?? 0;
		const originalBlock = match[0];
		matches.push({
			originalBlock,
			attributes,
			dataContent,
			name: decodeXmlEntities(nameMatch[1]),
			startIndex,
			endIndex: startIndex + originalBlock.length
		});
	}

	return matches;
}

function decodeXmlEntities(input: string): string {
	return input
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&#x([\da-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&');
}

function stripXmlTags(input: string): string {
	return input.replace(/<[^>]+>/g, '');
}

function stripXmlComments(input: string): string {
	return input.replace(/<!--[\s\S]*?-->/g, '');
}

function encodeXmlEntities(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function upsertResxChildTag(content: string, tagName: 'value' | 'comment', rawValue: string): string {
	const escapedValue = encodeXmlEntities(rawValue);
	const tagRegex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
	const selfClosingRegex = new RegExp(`<${tagName}\\s*\\/\\s*>`, 'i');

	if (tagRegex.test(content)) {
		return content.replace(tagRegex, `<${tagName}>${escapedValue}</${tagName}>`);
	}

	if (selfClosingRegex.test(content)) {
		return content.replace(selfClosingRegex, `<${tagName}>${escapedValue}</${tagName}>`);
	}

	const indentMatch = content.match(RESX_TAG_INDENT_REGEX);
	const indent = indentMatch?.[1] ?? '    ';
	if (content.includes('\n')) {
		return content.replace(/(\s*)$/, `\n${indent}<${tagName}>${escapedValue}</${tagName}>$1`);
	}

	return `${content}<${tagName}>${escapedValue}</${tagName}>`;
}

function updateDataBlockByName(
	xmlText: string,
	targetName: string,
	transformer: (attributes: string, dataContent: string) => { attributes: string; dataContent: string }
): string {
	const targetBlock = getResxDataBlockMatches(xmlText).find((block) => block.name === targetName);
	if (!targetBlock) {
		return xmlText;
	}

	const transformed = transformer(targetBlock.attributes, targetBlock.dataContent);
	const newBlock = `<data${transformed.attributes}>${transformed.dataContent}</data>`;

	return xmlText.slice(0, targetBlock.startIndex) + newBlock + xmlText.slice(targetBlock.endIndex);
}

/**
 * Gets the root URI of the first workspace folder
 */
export function getWorkspaceRoot(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Validates that a given path is within the workspace boundaries.
 * Prevents directory traversal attacks or accessing files outside the workspace.
 */
export function isPathInsideWorkspace(workspaceRootPath: string, targetPath: string): boolean {
	const relativePath = path.relative(workspaceRootPath, targetPath);
	return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

/**
 * Parses a filename to extract base name and language code.
 * For example: "Resources.de-DE.resx" => { baseName: "Resources", languageCode: "de-DE" }
 *              "Resources.resx" => { baseName: "Resources", languageCode: null }
 */
export function parseFileName(filePath: string): { baseName: string; languageCode: string | null } {
	const fileName = path.basename(filePath);
	const ext = path.extname(fileName); // e.g., ".resx"
	const nameWithoutExt = fileName.slice(0, -ext.length); // e.g., "Resources.de-DE"

	const parts = nameWithoutExt.split('.');
	
	// If there's only one part, there's no language code
	if (parts.length === 1) {
		return { baseName: nameWithoutExt, languageCode: null };
	}

	// Check if the last part looks like a language code (contains letters and hyphens)
	const lastPart = parts[parts.length - 1];
	if (/^[a-z]{2,}(-[A-Z]{2})?$/i.test(lastPart)) {
		const baseName = parts.slice(0, -1).join('.');
		return { baseName, languageCode: lastPart };
	}

	return { baseName: nameWithoutExt, languageCode: null };
}

/**
 * Groups files by base name, extracting language codes.
 * Returns array of groups with base names and their associated language codes.
 */
export function groupFilesByBaseName(filePaths: string[]): FileLanguageGroup[] {
	const groups = new Map<string, { baseName: string; folderPath: string; languages: Set<string>; files: string[] }>();

	for (const filePath of filePaths) {
		const { baseName, languageCode } = parseFileName(filePath);
		const folderPath = path.posix.dirname(filePath);
		const normalizedFolderPath = folderPath === '.' ? '' : folderPath;
		const key = `${normalizedFolderPath}::${baseName}`;

		if (!groups.has(key)) {
			groups.set(key, { baseName, folderPath: normalizedFolderPath, languages: new Set(), files: [] });
		}

		const group = groups.get(key)!;
		if (languageCode) {
			group.languages.add(languageCode);
		}
		group.files.push(filePath);
	}

	// Convert to array format, sorting by base name
	return Array.from(groups.values())
		.map(({ baseName, folderPath, languages, files }) => ({
			baseName,
			folderPath,
			languages: Array.from(languages).sort(),
			files: files.sort()
		}))
		.sort((a, b) => {
			const byName = a.baseName.localeCompare(b.baseName);
			if (byName !== 0) {
				return byName;
			}
			return a.folderPath.localeCompare(b.folderPath);
		});
}

/**
 * Parses a .resx file and extracts data entries with name, value, and comment.
 */
export async function parseResxFile(filePath: string): Promise<Map<string, ResxEntry>> {
	const text = stripXmlComments(await readWorkspaceFileText(filePath));

	const entries = new Map<string, ResxEntry>();

	for (const dataBlock of extractResxDataBlocks(text)) {
		const { dataContent, name } = dataBlock;

		const valueMatch = dataContent.match(/<value(?:\s[^>]*)?>([\s\S]*?)<\/value>/i);
		const commentMatch = dataContent.match(/<comment(?:\s[^>]*)?>([\s\S]*?)<\/comment>/i);
		const commentSelfClosingMatch = dataContent.match(/<comment\s*\/\s*>/i);

		let value = '';
		if (valueMatch) {
			value = decodeXmlEntities(valueMatch[1]);
		} else {
			// Some RESX entries store direct text in <data> without a nested <value> element.
			value = decodeXmlEntities(stripXmlTags(dataContent).trim());
		}

		let comment = '';
		if (commentMatch) {
			comment = decodeXmlEntities(commentMatch[1]);
		} else if (commentSelfClosingMatch) {
			comment = '';
		}

		entries.set(name, {
			name,
			value,
			comment
		});
	}

	return entries;
}

export async function updateResxEntryField(
	filePath: string,
	keyName: string,
	field: 'value' | 'comment',
	newValue: string
): Promise<void> {
	const text = await readWorkspaceFileText(filePath);

	const updatedText = updateDataBlockByName(text, keyName, (attributes, dataContent) => ({
		attributes,
		dataContent: upsertResxChildTag(dataContent, field, newValue)
	}));

	if (updatedText === text) {
		throw new Error(`Could not find RESX entry with name "${keyName}" in ${filePath}`);
	}

	await writeWorkspaceFileText(filePath, updatedText);
}

export async function renameResxEntryName(filePath: string, oldKeyName: string, newKeyName: string): Promise<boolean> {
	const text = await readWorkspaceFileText(filePath);

	const updatedText = updateDataBlockByName(text, oldKeyName, (attributes, dataContent) => {
		const escapedName = encodeXmlEntities(newKeyName);
		const updatedAttributes = attributes.replace(/(\bname\s*=\s*")[^"]*(")/i, `$1${escapedName}$2`);
		return {
			attributes: updatedAttributes,
			dataContent
		};
	});

	if (updatedText === text) {
		return false;
	}

	await writeWorkspaceFileText(filePath, updatedText);
	return true;
}

export async function addResxEntry(filePath: string, keyName: string, initialValue = ''): Promise<boolean> {
	const existingEntries = await parseResxFile(filePath);
	if (existingEntries.has(keyName)) {
		return false;
	}

	const text = await readWorkspaceFileText(filePath);

	const escapedName = encodeXmlEntities(keyName);
	const escapedInitialValue = encodeXmlEntities(initialValue);
	const newEntry = [
		'  <data name="' + escapedName + '" xml:space="preserve">',
		'    <value>' + escapedInitialValue + '</value>',
		'    <comment></comment>',
		'  </data>'
	].join('\n');

	if (!ROOT_CLOSE_REGEX.test(text)) {
		throw new Error(`Could not find </root> in ${filePath}`);
	}

	const updatedText = text.replace(ROOT_CLOSE_REGEX, `\n${newEntry}\n</root>\n`);
	await writeWorkspaceFileText(filePath, updatedText);
	return true;
}

export async function deleteResxEntry(filePath: string, keyName: string): Promise<boolean> {
	const text = await readWorkspaceFileText(filePath);
	const targetBlock = getResxDataBlockMatches(text, true).find((block) => block.name === keyName);

	if (!targetBlock) {
		return false;
	}

	let updatedText = text.slice(0, targetBlock.startIndex) + text.slice(targetBlock.endIndex);

	updatedText = updatedText.replace(/\n{3,}/g, '\n\n');
	await writeWorkspaceFileText(filePath, updatedText);
	return true;
}

/**
 * Parses all files in a group and merges them into rows by key.
 * Returns array of objects where each row has: key, and then values for each language.
 */
export async function parseFileGroup(
	workspaceRootPath: string,
	files: string[]
): Promise<{ languages: string[]; keys: TranslationKeyRow[] }> {
	// Keep these maps separate so we can merge sparse language files predictably.
	const baseValues = new Map<string, string>();
	const comments = new Map<string, string>();
	const languageValueMaps = new Map<string, Map<string, string>>();

	// Parse all files and split default (base) values from language-specific values.
	for (const filePath of files) {
		const fullPath = path.resolve(workspaceRootPath, filePath);
		const { languageCode } = parseFileName(filePath);
		const entries = await parseResxFile(fullPath);

		if (!languageCode) {
			for (const [name, entry] of entries.entries()) {
				baseValues.set(name, entry.value);
				if (entry.comment) {
					comments.set(name, entry.comment);
				}
			}
			continue;
		}

		if (!languageValueMaps.has(languageCode)) {
			languageValueMaps.set(languageCode, new Map<string, string>());
		}

		const languageMap = languageValueMaps.get(languageCode)!;
		for (const [name, entry] of entries.entries()) {
			languageMap.set(name, entry.value);
		}
	}

	// Get all unique names across base and all language files.
	const allNames = new Set<string>(baseValues.keys());
	for (const languageMap of languageValueMaps.values()) {
		for (const name of languageMap.keys()) {
			allNames.add(name);
		}
	}

	const languages = Array.from(languageValueMaps.keys()).sort((a, b) => a.localeCompare(b));

	// Build rows with fixed columns (name/value/comment) + language columns.
	const rows: TranslationKeyRow[] = [];
	for (const name of Array.from(allNames).sort()) {
		const row: TranslationKeyRow = {
			name,
			value: baseValues.get(name) ?? '',
			comment: comments.get(name) ?? ''
		};

		for (const lang of languages) {
			const languageMap = languageValueMaps.get(lang);
			row[lang] = languageMap?.get(name) ?? '';
		}

		rows.push(row);
	}

	return { languages, keys: rows };
}
