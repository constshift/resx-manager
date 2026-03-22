(function () {
	function createTranslationFeature(options) {
		const {
			vscode,
			statusElement,
			showLoadingOverlay,
			hideLoadingOverlay,
			getCurrentState,
			openFileGroup,
			reloadSelectedGroup
		} = options;

		const batchTranslateButton = document.getElementById('batchTranslateButton');
		const batchTranslateModal = document.getElementById('batchTranslateModal');
		const batchTranslateModalError = document.getElementById('batchTranslateModalError');
		const closeModalButton = document.getElementById('closeModalButton');
		const cancelTranslateButton = document.getElementById('cancelTranslateButton');
		const startTranslateButton = document.getElementById('startTranslateButton');
		const tableHead = document.getElementById('batchTranslateTableHead');
		const tableBody = document.getElementById('batchTranslateTableBody');
		const translationServiceSelect = document.getElementById('translationServiceSelect');
		const translationConfigFields = document.getElementById('translationConfigFields');

		let openAfterReload = false;
		let translationConfig = {
			service: 'azure-translator',
			azureKey: localStorage.getItem('resx-azure-translate-key') || '',
			azureRegion: localStorage.getItem('resx-azure-translate-region') || '',
			googleApiKey: localStorage.getItem('resx-google-translate-key') || ''
		};

		function setModalError(message) {
			if (message) {
				batchTranslateModalError.textContent = message;
				batchTranslateModalError.style.display = 'block';
			} else {
				batchTranslateModalError.textContent = '';
				batchTranslateModalError.style.display = 'none';
			}
		}

		function setStatus(message, isError) {
			statusElement.textContent = message;
			if (isError) {
				statusElement.classList.add('error');
			} else {
				statusElement.classList.remove('error');
			}
		}

		function closeBatchTranslateModal() {
			batchTranslateModal.style.display = 'none';
			tableHead.innerHTML = '';
			tableBody.innerHTML = '';
			batchTranslateModalError.style.display = 'none';
			batchTranslateModalError.textContent = '';
		}

		function renderConfigFields() {
			translationConfigFields.innerHTML = '';

			if (translationConfig.service === 'azure-translator') {
				const keyGroup = document.createElement('div');
				keyGroup.className = 'config-field-group';

				const keyLabel = document.createElement('label');
				keyLabel.textContent = 'API Key:';
				keyLabel.htmlFor = 'azureKeyInput';
				keyGroup.appendChild(keyLabel);

				const keyInput = document.createElement('input');
				keyInput.id = 'azureKeyInput';
				keyInput.type = 'password';
				keyInput.placeholder = 'Enter Azure Translate API key';
				keyInput.value = translationConfig.azureKey;
				keyInput.addEventListener('change', (e) => {
					translationConfig.azureKey = e.target.value;
				});
				keyGroup.appendChild(keyInput);

				translationConfigFields.appendChild(keyGroup);

				const regionGroup = document.createElement('div');
				regionGroup.className = 'config-field-group';

				const regionLabel = document.createElement('label');
				regionLabel.textContent = 'Region:';
				regionLabel.htmlFor = 'azureRegionInput';
				regionGroup.appendChild(regionLabel);

				const regionInput = document.createElement('input');
				regionInput.id = 'azureRegionInput';
				regionInput.type = 'text';
				regionInput.placeholder = 'e.g., eastus';
				regionInput.value = translationConfig.azureRegion;
				regionInput.addEventListener('change', (e) => {
					translationConfig.azureRegion = e.target.value;
				});
				regionGroup.appendChild(regionInput);

				translationConfigFields.appendChild(regionGroup);
			} else if (translationConfig.service === 'google-translate') {
				const keyGroup = document.createElement('div');
				keyGroup.className = 'config-field-group';

				const keyLabel = document.createElement('label');
				keyLabel.textContent = 'Google API Key:';
				keyLabel.htmlFor = 'googleApiKeyInput';
				keyGroup.appendChild(keyLabel);

				const keyInput = document.createElement('input');
				keyInput.id = 'googleApiKeyInput';
				keyInput.type = 'password';
				keyInput.placeholder = 'Enter Google Translate API key';
				keyInput.value = translationConfig.googleApiKey;
				keyInput.addEventListener('change', (e) => {
					translationConfig.googleApiKey = e.target.value;
				});
				keyGroup.appendChild(keyInput);

				translationConfigFields.appendChild(keyGroup);
			}
		}

		function updateLanguageSelectAllCheckbox(lang, checkbox) {
			let targetCheckbox = checkbox;
			if (!targetCheckbox) {
				targetCheckbox = tableHead.querySelector('input[title="Select all keys for ' + lang + '"]');
			}
			if (!targetCheckbox) {
				return;
			}

			const langCheckboxes = tableBody.querySelectorAll('input[data-language="' + lang + '"]');
			const allChecked = Array.from(langCheckboxes).every((cb) => cb.checked);
			const someChecked = Array.from(langCheckboxes).some((cb) => cb.checked);
			targetCheckbox.checked = allChecked;
			targetCheckbox.indeterminate = someChecked && !allChecked;
		}

		function populateBatchTranslateTable(missingKeys, currentLanguages) {
			tableHead.innerHTML = '';
			tableBody.innerHTML = '';

			const keysWithDefaults = missingKeys.filter((key) => key.value);
			if (keysWithDefaults.length === 0) {
				tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 6px;">No keys with default values found</td></tr>';
				return;
			}

			const headerRow = document.createElement('tr');
			const keyHeader = document.createElement('th');
			keyHeader.className = 'batch-key-column';
			keyHeader.textContent = 'Key';
			keyHeader.style.textAlign = 'left';
			headerRow.appendChild(keyHeader);

			const langSelectAllCheckboxes = {};
			for (const lang of currentLanguages) {
				const th = document.createElement('th');
				th.className = 'batch-lang-header';

				const div = document.createElement('div');
				div.className = 'batch-lang-header-content';
				div.style.display = 'flex';
				div.style.flexDirection = 'column';
				div.style.alignItems = 'center';
				div.style.gap = '1px';

				const label = document.createElement('label');
				label.textContent = lang.toUpperCase();
				label.title = lang;
				label.style.fontSize = '10px';
				label.style.fontWeight = '600';
				label.style.display = 'block';
				label.style.whiteSpace = 'nowrap';
				label.style.textAlign = 'center';

				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.title = 'Select all keys for ' + lang;
				checkbox.style.cursor = 'pointer';
				langSelectAllCheckboxes[lang] = checkbox;

				div.appendChild(label);
				div.appendChild(checkbox);
				th.appendChild(div);
				headerRow.appendChild(th);
			}

			tableHead.appendChild(headerRow);

			for (const key of keysWithDefaults) {
				const row = document.createElement('tr');
				const keyCell = document.createElement('td');
				keyCell.className = 'batch-key-cell';
				keyCell.title = key.name;
				keyCell.style.textAlign = 'left';
				keyCell.style.fontWeight = '500';
				keyCell.style.padding = '0 1px';

				const keyText = document.createElement('span');
				keyText.className = 'batch-key-text';
				keyText.textContent = key.name;
				keyCell.appendChild(keyText);
				row.appendChild(keyCell);

				for (const lang of currentLanguages) {
					const cell = document.createElement('td');
					cell.className = 'batch-lang-cell';

					const checkbox = document.createElement('input');
					checkbox.type = 'checkbox';
					checkbox.className = 'batch-translate-checkbox';
					checkbox.dataset.keyName = key.name;
					checkbox.dataset.language = lang;
					checkbox.checked = !key[lang];
					checkbox.style.cursor = 'pointer';
					checkbox.addEventListener('change', () => {
						updateLanguageSelectAllCheckbox(lang);
					});

					cell.appendChild(checkbox);
					row.appendChild(cell);
				}

				tableBody.appendChild(row);
			}
	}

	function saveTranslationConfig() {
		localStorage.setItem('resx-azure-translate-key', translationConfig.azureKey);
		localStorage.setItem('resx-azure-translate-region', translationConfig.azureRegion);
		localStorage.setItem('resx-google-translate-key', translationConfig.googleApiKey);
	}

	function requestBatchTranslate() {
		const checkedBoxes = tableBody.querySelectorAll('input[type="checkbox"]:checked');
		const selections = {};
		for (const checkbox of checkedBoxes) {
			const keyName = checkbox.dataset.keyName;
			const language = checkbox.dataset.language;
			if (!selections[language]) {
				selections[language] = [];
			}
			selections[language].push(keyName);
		}

		const selectedLanguages = Object.keys(selections);
		if (selectedLanguages.length === 0) {
			setStatus('Please select at least one key-language combination to translate.', true);
			return;
		}

		if (translationConfig.service === 'azure-translator') {
			if (!translationConfig.azureKey || !translationConfig.azureRegion) {
				setStatus('Please configure Azure Translator credentials.', true);
				return;
			}
		} else if (translationConfig.service === 'google-translate') {
			if (!translationConfig.googleApiKey) {
				setStatus('Please configure Google Translate API key.', true);
				return;
			}
		}

		saveTranslationConfig();

		const { keys, sourceFiles } = getCurrentState();
		const translationsPerLanguage = {};
		for (const lang of selectedLanguages) {
			const keysForLang = selections[lang];
			const keysToTranslate = keys.filter((key) => keysForLang.includes(key.name));
			translationsPerLanguage[lang] = {
				keys: keysForLang,
				defaultValues: keysToTranslate.map((key) => key.value || ''),
				filePath: sourceFiles.languageFilePaths[lang]
			};
		}

		setStatus('Translating...', false);
		showLoadingOverlay();
		setModalError('');

		vscode.postMessage({
			command: 'batchTranslate',
			translationsPerLanguage,
			translationConfig: {
				service: translationConfig.service,
				azureKey: translationConfig.azureKey,
				azureRegion: translationConfig.azureRegion,
				googleApiKey: translationConfig.googleApiKey
			}
		});
	}

	function doOpenBatchTranslateModal() {
		renderConfigFields();
		const { keys, sourceFiles } = getCurrentState();
		const languages = Object.keys(sourceFiles.languageFilePaths).filter((lang) => lang !== 'default');
		const missingKeys = keys.filter((key) => {
			for (const lang of languages) {
				if (!key[lang]) {
					return true;
				}
			}
			return false;
		});

		if (missingKeys.length === 0) {
			setStatus('No missing translations found.', true);
			hideLoadingOverlay();
			return;
		}

		populateBatchTranslateTable(missingKeys, languages);
		batchTranslateModal.style.display = 'flex';
		hideLoadingOverlay();
	}

	function requestOpenModalWithRefresh() {
		const { selectedGroup } = getCurrentState();
		if (!selectedGroup) {
			setStatus('No file selected.', true);
			return;
		}

		setStatus('Loading...', false);
		showLoadingOverlay();
		openAfterReload = true;
		openFileGroup(selectedGroup);
	}

	translationServiceSelect.addEventListener('change', (e) => {
		translationConfig.service = e.target.value;
		renderConfigFields();
	});

	batchTranslateButton.addEventListener('click', requestOpenModalWithRefresh);
		closeModalButton.addEventListener('click', closeBatchTranslateModal);
		cancelTranslateButton.addEventListener('click', closeBatchTranslateModal);
		startTranslateButton.addEventListener('click', requestBatchTranslate);
		batchTranslateModal.addEventListener('click', (event) => {
			if (event.target === batchTranslateModal || event.target.classList.contains('modal-overlay')) {
				closeBatchTranslateModal();
			}
		});

		renderConfigFields();

		return {
			updateAvailability: (languages, keys) => {
				batchTranslateButton.style.display = languages && keys && keys.length > 0 ? 'block' : 'none';
			},
			onFileContentLoaded: () => {
				if (openAfterReload) {
					openAfterReload = false;
					doOpenBatchTranslateModal();
				}
			},
			handleBatchTranslateResult: (message) => {
				hideLoadingOverlay();
				if (message.error) {
					const errorMessage = typeof message.error === 'object' ? JSON.stringify(message.error, null, 2) : String(message.error);
					setModalError(errorMessage);
					return;
				}
				setStatus('Translations completed successfully', false);
				closeBatchTranslateModal();
				reloadSelectedGroup();
			}
		};
	}

	window.createTranslationFeature = createTranslationFeature;
})();
