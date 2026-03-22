import * as vscode from 'vscode';
import { CONFIG_SCAN_FOLDER_KEY, CONFIG_SECTION } from '../constants';

export function getSavedScanFolderPath(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<string>(CONFIG_SCAN_FOLDER_KEY, '');
}

export async function saveScanFolderPath(folderPath: string): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	try {
		await config.update(CONFIG_SCAN_FOLDER_KEY, folderPath, vscode.ConfigurationTarget.Workspace);
	} catch {
		// Non-blocking: scan should continue even if settings persistence fails.
	}
}
