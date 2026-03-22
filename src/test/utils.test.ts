import * as assert from 'assert';
import { groupFilesByBaseName, parseFileName } from '../utils';

suite('Utils Test Suite', () => {
	test('parseFileName extracts neutral file', () => {
		const parsed = parseFileName('Resources.resx');
		assert.deepStrictEqual(parsed, {
			baseName: 'Resources',
			languageCode: null
		});
	});

	test('parseFileName extracts language suffix', () => {
		const parsed = parseFileName('Resources.de-DE.resx');
		assert.deepStrictEqual(parsed, {
			baseName: 'Resources',
			languageCode: 'de-DE'
		});
	});

	test('parseFileName keeps dotted base names', () => {
		const parsed = parseFileName('App.Texts.Shared.en.resx');
		assert.deepStrictEqual(parsed, {
			baseName: 'App.Texts.Shared',
			languageCode: 'en'
		});
	});

	test('groupFilesByBaseName groups by folder and base name', () => {
		const grouped = groupFilesByBaseName([
			'i18n/Resources.resx',
			'i18n/Resources.fr.resx',
			'i18n/Resources.de-DE.resx',
			'admin/Resources.resx'
		]);

		assert.strictEqual(grouped.length, 2);

		assert.deepStrictEqual(grouped[0], {
			baseName: 'Resources',
			folderPath: 'admin',
			languages: [],
			files: ['admin/Resources.resx']
		});

		assert.deepStrictEqual(grouped[1], {
			baseName: 'Resources',
			folderPath: 'i18n',
			languages: ['de-DE', 'fr'],
			files: ['i18n/Resources.de-DE.resx', 'i18n/Resources.fr.resx', 'i18n/Resources.resx']
		});
	});
});