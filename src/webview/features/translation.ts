import * as path from 'node:path';
import * as vscode from 'vscode';
import { BatchTranslateMessage, BatchTranslateResultMessage } from '../../types';
import { getWorkspaceRoot, isPathInsideWorkspace, updateResxEntryField } from '../../utils';

export async function handleBatchTranslateRequest(panel: vscode.WebviewPanel, message: BatchTranslateMessage): Promise<void> {
	try {
		const service = message.translationConfig?.service || 'azure-translator';
		const azureKey = message.translationConfig?.azureKey || process.env.AZURE_TRANSLATE_KEY;
		const azureRegion = message.translationConfig?.azureRegion || process.env.AZURE_TRANSLATE_REGION;
		const googleApiKey = message.translationConfig?.googleApiKey || process.env.GOOGLE_TRANSLATE_API_KEY;

		if (service === 'azure-translator' && (!azureKey || !azureRegion)) {
			await panel.webview.postMessage({
				command: 'batchTranslateResult',
				error: 'Azure Translate API credentials not configured. Please enter your API key and region.'
			} as BatchTranslateResultMessage);
			return;
		}

		if (service === 'google-translate' && !googleApiKey) {
			await panel.webview.postMessage({
				command: 'batchTranslateResult',
				error: 'Google Translate API key not configured. Please enter your API key.'
			} as BatchTranslateResultMessage);
			return;
		}

		const workspaceRoot = getWorkspaceRoot();
		if (!workspaceRoot) {
			throw new Error('No workspace open');
		}

		for (const [language, translationData] of Object.entries(message.translationsPerLanguage)) {
			if (!translationData.filePath) {
				continue;
			}

			const filePath = path.resolve(workspaceRoot.fsPath, translationData.filePath);
			if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
				throw new Error(`Translation file path is outside workspace: ${translationData.filePath}`);
			}

			// Extract language code (e.g., "de-DE" -> "de", or "es" -> "es")
			const languageCode = language.split('-')[0].toLowerCase();

			const translatedValues = await translateTexts({
				texts: translationData.defaultValues,
				targetLanguage: languageCode,
				service,
				azureKey,
				azureRegion,
				googleApiKey
			});

			for (let i = 0; i < translationData.keys.length; i++) {
				const keyName = translationData.keys[i];
				const translatedValue = translatedValues[i] || '';
				if (translatedValue) {
					await updateResxEntryField(filePath, keyName, 'value', translatedValue);
				}
			}
		}

		await panel.webview.postMessage({
			command: 'batchTranslateResult'
		} as BatchTranslateResultMessage);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown batch translation error';
		await panel.webview.postMessage({
			command: 'batchTranslateResult',
			error: errorMessage
		} as BatchTranslateResultMessage);
	}
}

type TranslationOptions = {
	texts: string[];
	targetLanguage: string;
	service: string;
	azureKey?: string;
	azureRegion?: string;
	googleApiKey?: string;
};

async function translateTexts(options: TranslationOptions): Promise<string[]> {
	if (options.service === 'google-translate') {
		if (!options.googleApiKey) {
			throw new Error('Google Translate API key not configured.');
		}

		return translateTextsWithGoogle(options.texts, options.targetLanguage, options.googleApiKey);
	}

	if (!options.azureKey || !options.azureRegion) {
		throw new Error('Azure Translate API credentials not configured.');
	}

	return translateTextsWithAzure(options.texts, options.targetLanguage, options.azureKey, options.azureRegion);
}

async function translateTextsWithAzure(texts: string[], targetLanguage: string, apiKey: string, region: string): Promise<string[]> {
	const results: string[] = [];

	for (const text of texts) {
		if (!text) {
			results.push('');
			continue;
		}

		try {
			const response = await fetch(`https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${targetLanguage}`, {
				method: 'POST',
				headers: {
					'Ocp-Apim-Subscription-Key': apiKey,
					'Ocp-Apim-Subscription-Region': region,
					'Content-Type': 'application/json; charset=UTF-8'
				},
				body: JSON.stringify([{ Text: text }])
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(`Azure Translate API error (${response.status}): ${errorBody}`);
			}

			const result = await response.json() as Array<{ translations: Array<{ text: string }> }>;
			if (result[0]?.translations[0]?.text) {
				results.push(result[0].translations[0].text);
			} else {
				throw new Error(`Unexpected Azure response format: ${JSON.stringify(result)}`);
			}
		} catch (error) {
			throw new Error(`Translation failed for text "${text}": ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return results;
}

async function translateTextsWithGoogle(texts: string[], targetLanguage: string, apiKey: string): Promise<string[]> {
	const results: string[] = [];

	for (const text of texts) {
		if (!text) {
			results.push('');
			continue;
		}

		try {
			const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json; charset=UTF-8'
				},
				body: JSON.stringify({
					q: text,
					target: targetLanguage,
					format: 'text'
				})
			});

			if (!response.ok) {
				const errorBody = await response.text();
				throw new Error(`Google Translate API error (${response.status}): ${errorBody}`);
			}

			const result = await response.json() as {
				data?: {
					translations?: Array<{ translatedText?: string }>;
				};
			};

			const translatedText = result.data?.translations?.[0]?.translatedText;
			if (translatedText) {
				results.push(decodeHtmlEntities(translatedText));
			} else {
				throw new Error(`Unexpected Google response format: ${JSON.stringify(result)}`);
			}
		} catch (error) {
			throw new Error(`Translation failed for text "${text}": ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	return results;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}
