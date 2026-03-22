import * as path from 'node:path';
import * as vscode from 'vscode';
import { BatchTranslateMessage, BatchTranslateResultMessage } from '../../types';
import { getWorkspaceRoot, isPathInsideWorkspace, updateResxEntryField } from '../../utils';

type TranslationService = 'azure-translator' | 'google-translate';

export async function handleBatchTranslateRequest(panel: vscode.WebviewPanel, message: BatchTranslateMessage): Promise<void> {
	try {
		const service = (message.translationConfig?.service || 'azure-translator') as TranslationService;
		const azureKey = message.translationConfig?.azureKey || process.env.AZURE_TRANSLATE_KEY;
		const azureRegion = message.translationConfig?.azureRegion || process.env.AZURE_TRANSLATE_REGION;
		const googleApiKey = message.translationConfig?.googleApiKey || process.env.GOOGLE_TRANSLATE_API_KEY;

		const credentialsError = getCredentialsError({ service, azureKey, azureRegion, googleApiKey });
		if (credentialsError) {
			await sendBatchTranslateResult(panel, { error: credentialsError });
			return;
		}

		const workspaceRoot = getWorkspaceRoot();
		if (!workspaceRoot) {
			throw new Error('No workspace open');
		}

		// Keep translated rows aligned with source keys by preserving array order.
		for (const [language, translationData] of Object.entries(message.translationsPerLanguage)) {
			if (!translationData.filePath) {
				continue;
			}

			const filePath = path.resolve(workspaceRoot.fsPath, translationData.filePath);
			if (!isPathInsideWorkspace(workspaceRoot.fsPath, filePath)) {
				throw new Error(`Translation file path is outside workspace: ${translationData.filePath}`);
			}

			const languageCode = getPrimaryLanguageCode(language);

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

		await sendBatchTranslateResult(panel, {});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown batch translation error';
		await sendBatchTranslateResult(panel, { error: errorMessage });
	}
}

type TranslationOptions = {
	texts: string[];
	targetLanguage: string;
	service: TranslationService;
	azureKey?: string;
	azureRegion?: string;
	googleApiKey?: string;
};

type TranslationCredentials = {
	service: TranslationService;
	azureKey?: string;
	azureRegion?: string;
	googleApiKey?: string;
};

async function sendBatchTranslateResult(
	panel: vscode.WebviewPanel,
	payload: { error?: string }
): Promise<void> {
	await panel.webview.postMessage({
		command: 'batchTranslateResult',
		...payload
	} as BatchTranslateResultMessage);
}

function getCredentialsError(credentials: TranslationCredentials): string | null {
	if (credentials.service === 'azure-translator' && (!credentials.azureKey || !credentials.azureRegion)) {
		return 'Azure Translate API credentials not configured. Please enter your API key and region.';
	}

	if (credentials.service === 'google-translate' && !credentials.googleApiKey) {
		return 'Google Translate API key not configured. Please enter your API key.';
	}

	return null;
}

function getPrimaryLanguageCode(language: string): string {
	return language.split('-')[0].toLowerCase();
}

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

async function translateEachText(
	texts: string[],
	translateOne: (text: string) => Promise<string>
): Promise<string[]> {
	// Sequential translation preserves key/value order across all providers.
	const results: string[] = [];

	for (const text of texts) {
		if (!text) {
			results.push('');
			continue;
		}

		results.push(await translateOne(text));
	}

	return results;
}

async function translateTextsWithAzure(texts: string[], targetLanguage: string, apiKey: string, region: string): Promise<string[]> {
	return translateEachText(texts, async (text) => {
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
			const translatedText = result[0]?.translations[0]?.text;
			if (!translatedText) {
				throw new Error(`Unexpected Azure response format: ${JSON.stringify(result)}`);
			}

			return translatedText;
		} catch (error) {
			throw new Error(`Translation failed for text "${text}": ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

async function translateTextsWithGoogle(texts: string[], targetLanguage: string, apiKey: string): Promise<string[]> {
	return translateEachText(texts, async (text) => {
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
			if (!translatedText) {
				throw new Error(`Unexpected Google response format: ${JSON.stringify(result)}`);
			}

			return decodeHtmlEntities(translatedText);
		} catch (error) {
			throw new Error(`Translation failed for text "${text}": ${error instanceof Error ? error.message : String(error)}`);
		}
	});
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}
