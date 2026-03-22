import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getSavedScanFolderPath } from './settings';

type AssetBinding = {
	token: string;
	relativePath: string;
};

type HtmlPartial = {
	key: string;
	relativePath: string;
};

const HTML_PARTIALS: HtmlPartial[] = [
	{ key: 'htmlTemplate', relativePath: 'index.html' },
	{ key: 'scannerHeaderHtml', relativePath: 'features/scanner/header-controls.html' },
	{ key: 'scannerSidebarHtml', relativePath: 'features/scanner/sidebar.html' },
	{ key: 'fileViewContentHtml', relativePath: 'features/file-view/content.html' },
	{ key: 'translationButtonHtml', relativePath: 'features/translation/button.html' },
	{ key: 'translationModalHtml', relativePath: 'features/translation/modal.html' }
];

const ASSET_BINDINGS: AssetBinding[] = [
	{ token: 'stylesheetUri', relativePath: 'styles.css' },
	{ token: 'scannerStylesheetUri', relativePath: 'features/scanner/styles.css' },
	{ token: 'fileViewStylesheetUri', relativePath: 'features/file-view/styles.css' },
	{ token: 'translationStylesheetUri', relativePath: 'features/translation/styles.css' },
	{ token: 'scannerScriptUri', relativePath: 'features/scanner/feature.js' },
	{ token: 'fileViewScriptUri', relativePath: 'features/file-view/feature.js' },
	{ token: 'translationScriptUri', relativePath: 'features/translation/feature.js' },
	{ token: 'scriptUri', relativePath: 'main.js' }
];

function webviewAssetUri(webview: vscode.Webview, webviewRoot: vscode.Uri, relativePath: string): string {
	return webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, ...relativePath.split('/'))).toString();
}

async function loadHtmlPartials(webviewRoot: vscode.Uri): Promise<Record<string, string>> {
	const entries = await Promise.all(
		HTML_PARTIALS.map(async (partial) => {
			const filePath = vscode.Uri.joinPath(webviewRoot, ...partial.relativePath.split('/')).fsPath;
			const content = await fs.readFile(filePath, 'utf8');
			return [partial.key, content] as const;
		})
	);

	return Object.fromEntries(entries);
}

export async function getScannerWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
	const webviewRoot = vscode.Uri.joinPath(extensionUri, 'media', 'webview');
	const partials = await loadHtmlPartials(webviewRoot);
	const savedFolderPath = escapeHtmlAttribute(getSavedScanFolderPath());
	const fileViewHtml = partials.fileViewContentHtml.replaceAll('{{translationButtonHtml}}', partials.translationButtonHtml);

	let html = partials.htmlTemplate
		.replaceAll('{{cspSource}}', webview.cspSource)
		.replaceAll('{{scannerHeaderHtml}}', partials.scannerHeaderHtml)
		.replaceAll('{{scannerSidebarHtml}}', partials.scannerSidebarHtml)
		.replaceAll('{{fileViewContentHtml}}', fileViewHtml)
		.replaceAll('{{translationModalHtml}}', partials.translationModalHtml)
		.replaceAll('{{savedFolderPath}}', savedFolderPath);

	for (const binding of ASSET_BINDINGS) {
		// Bind static asset tokens late so HTML partial loading remains independent from URI generation.
		html = html.replaceAll(`{{${binding.token}}}`, webviewAssetUri(webview, webviewRoot, binding.relativePath));
	}

	return html;
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
