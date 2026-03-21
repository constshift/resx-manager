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
	const groups = new Map<string, { languages: Set<string>; files: string[] }>();

	for (const filePath of filePaths) {
		const { baseName, languageCode } = parseFileName(filePath);
		const key = baseName;

		if (!groups.has(key)) {
			groups.set(key, { languages: new Set(), files: [] });
		}

		const group = groups.get(key)!;
		if (languageCode) {
			group.languages.add(languageCode);
		}
		group.files.push(filePath);
	}

	// Convert to array format, sorting by base name
	return Array.from(groups.entries())
		.map(([baseName, { languages, files }]) => ({
			baseName,
			languages: Array.from(languages).sort(),
			files: files.sort()
		}))
		.sort((a, b) => a.baseName.localeCompare(b.baseName));
}

/**
 * Parses a .resx file and extracts data entries with name, value, and comment.
 */
export async function parseResxFile(filePath: string): Promise<Map<string, ResxEntry>> {
	const fileUri = vscode.Uri.file(filePath);
	const content = await vscode.workspace.fs.readFile(fileUri);
	const text = stripXmlComments(new TextDecoder().decode(content));

	const entries = new Map<string, ResxEntry>();

	// Match each <data ...>...</data> block, then extract name/value/comment from the block.
	const dataRegex = /<data\b([^>]*)>([\s\S]*?)<\/data>/g;
	let match;

	while ((match = dataRegex.exec(text)) !== null) {
		const attributes = match[1];
		const dataContent = match[2];

		const nameMatch = attributes.match(/\bname\s*=\s*"([^"]+)"/i);
		if (!nameMatch) {
			continue;
		}

		const name = decodeXmlEntities(nameMatch[1]);

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

/**
 * Parses all files in a group and merges them into rows by key.
 * Returns array of objects where each row has: key, and then values for each language.
 */
export async function parseFileGroup(
	workspaceRootPath: string,
	files: string[]
): Promise<{ languages: string[]; keys: TranslationKeyRow[] }> {
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
