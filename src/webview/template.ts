import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { getSavedScanFolderPath } from './settings';

export async function getScannerWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
	const webviewRoot = vscode.Uri.joinPath(extensionUri, 'media', 'webview');
	const htmlTemplatePath = vscode.Uri.joinPath(webviewRoot, 'index.html');
	const scannerHeaderTemplatePath = vscode.Uri.joinPath(webviewRoot, 'features', 'scanner', 'header-controls.html');
	const scannerSidebarTemplatePath = vscode.Uri.joinPath(webviewRoot, 'features', 'scanner', 'sidebar.html');
	const fileViewContentTemplatePath = vscode.Uri.joinPath(webviewRoot, 'features', 'file-view', 'content.html');
	const translationButtonTemplatePath = vscode.Uri.joinPath(webviewRoot, 'features', 'translation', 'button.html');
	const translationModalTemplatePath = vscode.Uri.joinPath(webviewRoot, 'features', 'translation', 'modal.html');
	const stylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'styles.css')).toString();
	const scannerStylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'features', 'scanner', 'styles.css')).toString();
	const fileViewStylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'features', 'file-view', 'styles.css')).toString();
	const translationStylesheetUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'features', 'translation', 'styles.css')).toString();
	const scannerScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'features', 'scanner', 'feature.js')).toString();
	const fileViewScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'features', 'file-view', 'feature.js')).toString();
	const translationScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'features', 'translation', 'feature.js')).toString();
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js')).toString();
	const savedFolderPath = escapeHtmlAttribute(getSavedScanFolderPath());
	const [
		htmlTemplate,
		scannerHeaderHtml,
		scannerSidebarHtml,
		fileViewContentHtml,
		translationButtonHtml,
		translationModalHtml
	] = await Promise.all([
		fs.readFile(htmlTemplatePath.fsPath, 'utf8'),
		fs.readFile(scannerHeaderTemplatePath.fsPath, 'utf8'),
		fs.readFile(scannerSidebarTemplatePath.fsPath, 'utf8'),
		fs.readFile(fileViewContentTemplatePath.fsPath, 'utf8'),
		fs.readFile(translationButtonTemplatePath.fsPath, 'utf8'),
		fs.readFile(translationModalTemplatePath.fsPath, 'utf8')
	]);

	const fileViewHtml = fileViewContentHtml.replaceAll('{{translationButtonHtml}}', translationButtonHtml);

	return htmlTemplate
		.replaceAll('{{cspSource}}', webview.cspSource)
		.replaceAll('{{scannerHeaderHtml}}', scannerHeaderHtml)
		.replaceAll('{{scannerSidebarHtml}}', scannerSidebarHtml)
		.replaceAll('{{fileViewContentHtml}}', fileViewHtml)
		.replaceAll('{{translationModalHtml}}', translationModalHtml)
		.replaceAll('{{stylesheetUri}}', stylesheetUri)
		.replaceAll('{{scannerStylesheetUri}}', scannerStylesheetUri)
		.replaceAll('{{fileViewStylesheetUri}}', fileViewStylesheetUri)
		.replaceAll('{{translationStylesheetUri}}', translationStylesheetUri)
		.replaceAll('{{scannerScriptUri}}', scannerScriptUri)
		.replaceAll('{{fileViewScriptUri}}', fileViewScriptUri)
		.replaceAll('{{translationScriptUri}}', translationScriptUri)
		.replaceAll('{{savedFolderPath}}', savedFolderPath)
		.replaceAll('{{scriptUri}}', scriptUri);
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}
