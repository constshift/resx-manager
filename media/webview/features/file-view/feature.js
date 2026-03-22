(function () {
	function createFileViewFeature(options) {
		const {
			vscode,
			editorTitle,
			newKeyInput,
			addKeyButton,
			tableContainer,
			statusElement,
			showLoadingOverlay
		} = options;

		let currentSourceFiles = {
			defaultFilePath: undefined,
			languageFilePaths: {},
			allFilePaths: []
		};
		let currentLanguages = [];
		let currentKeys = [];

		function setStatus(message, isError) {
			statusElement.textContent = message;
			if (isError) {
				statusElement.classList.add('error');
			} else {
				statusElement.classList.remove('error');
			}
		}

		function clearSelectionView() {
			tableContainer.innerHTML = '<div class="no-file-selected">No file selected</div>';
			editorTitle.textContent = 'Select a translation file to view';
		}

		function displayFileContent(baseName, languages, keys) {
			editorTitle.textContent = baseName;
			currentLanguages = languages;
			currentKeys = keys;

			if (!keys || keys.length === 0) {
				tableContainer.innerHTML = '<div class="no-file-selected">No translation keys found</div>';
				return;
			}

			const table = document.createElement('table');
			const thead = document.createElement('thead');
			const headerRow = document.createElement('tr');

			const actionsHeader = document.createElement('th');
			actionsHeader.className = 'actions-column';
			actionsHeader.textContent = 'Actions';
			headerRow.appendChild(actionsHeader);

			const nameHeader = document.createElement('th');
			nameHeader.className = 'name-column';
			nameHeader.textContent = 'Name';
			headerRow.appendChild(nameHeader);

			const valueHeader = document.createElement('th');
			valueHeader.textContent = 'Value';
			headerRow.appendChild(valueHeader);

			const commentHeader = document.createElement('th');
			commentHeader.textContent = 'Comment';
			headerRow.appendChild(commentHeader);

			for (const lang of languages) {
				const langHeader = document.createElement('th');
				langHeader.textContent = lang;
				headerRow.appendChild(langHeader);
			}

			thead.appendChild(headerRow);
			table.appendChild(thead);

			const tbody = document.createElement('tbody');
			for (const row of keys) {
				const tr = document.createElement('tr');
				tr.dataset.keyName = row.name;

				const actionsCell = document.createElement('td');
				actionsCell.className = 'actions-column';
				actionsCell.contentEditable = 'false';
				const deleteButton = document.createElement('button');
				deleteButton.type = 'button';
				deleteButton.className = 'delete-key-button';
				deleteButton.title = 'Delete key';
				deleteButton.setAttribute('aria-label', 'Delete key');
				deleteButton.addEventListener('click', () => {
					if (!currentSourceFiles.allFilePaths || currentSourceFiles.allFilePaths.length === 0) {
						setStatus('Open a file group before deleting a key.', true);
						return;
					}

					setStatus('Deleting key...', false);
					vscode.postMessage({
						command: 'deleteKey',
						keyName: row.name,
						allFilePaths: currentSourceFiles.allFilePaths
					});
					showLoadingOverlay();
				});
				actionsCell.appendChild(deleteButton);
				tr.appendChild(actionsCell);

				const nameCell = document.createElement('td');
				nameCell.className = 'name-column';
				nameCell.textContent = row.name;
				nameCell.title = row.name;
				nameCell.style.fontWeight = '500';
				nameCell.contentEditable = 'true';
				nameCell.dataset.field = 'name';
				nameCell.dataset.originalValue = row.name;
				tr.appendChild(nameCell);

				const defaultValueCell = document.createElement('td');
				defaultValueCell.textContent = row.value || '';
				defaultValueCell.contentEditable = 'true';
				defaultValueCell.dataset.field = 'value';
				defaultValueCell.dataset.originalValue = row.value || '';
				if (!row.value) {
					defaultValueCell.classList.add('missing-default-value');
				}
				tr.appendChild(defaultValueCell);

				const commentCell = document.createElement('td');
				commentCell.textContent = row.comment || '';
				commentCell.contentEditable = 'true';
				commentCell.dataset.field = 'comment';
				commentCell.dataset.originalValue = row.comment || '';
				tr.appendChild(commentCell);

				const missingLanguages = [];
				for (const lang of languages) {
					const valueCell = document.createElement('td');
					valueCell.textContent = row[lang] || '';
					valueCell.contentEditable = 'true';
					valueCell.dataset.field = 'language';
					valueCell.dataset.lang = lang;
					valueCell.dataset.originalValue = row[lang] || '';
					if (!row[lang]) {
						valueCell.classList.add('missing-translation');
						missingLanguages.push(lang);
					}
					tr.appendChild(valueCell);
				}

				if (missingLanguages.length > 0) {
					nameCell.classList.add('has-missing-translations');
					const tooltipText = row.name + '\n\nMissing translations:\n' + missingLanguages.join(', ');
					nameCell.title = tooltipText;
					nameCell.dataset.tooltip = tooltipText;
				}

				tbody.appendChild(tr);
			}

			table.appendChild(tbody);
			tableContainer.innerHTML = '';
			tableContainer.appendChild(table);

			for (const editableCell of table.querySelectorAll('td[contenteditable="true"]')) {
				editableCell.addEventListener('blur', () => {
					const field = editableCell.dataset.field;
					const originalValue = editableCell.dataset.originalValue || '';
					const rawValue = editableCell.textContent || '';
					const newValue = field === 'name' ? rawValue.trim() : rawValue;
					if (newValue === originalValue) {
						return;
					}

					const rowElement = editableCell.parentElement;
					const keyName = (rowElement && rowElement.dataset.keyName) || '';
					if (!keyName || !field) {
						return;
					}

					if (field === 'name') {
						if (!newValue) {
							setStatus('Key name cannot be empty.', true);
							editableCell.textContent = originalValue;
							return;
						}

						const duplicateNameExists = Array.from(table.querySelectorAll('tbody tr')).some(
							(trElement) =>
								trElement !== rowElement &&
								(trElement.dataset.keyName || '').toLocaleLowerCase() === newValue.toLocaleLowerCase()
						);
						if (duplicateNameExists) {
							setStatus('Duplicate key names are not allowed.', true);
							editableCell.textContent = originalValue;
							return;
						}
					}

					const payload = {
						command: 'saveCell',
						field,
						keyName,
						value: newValue
					};

					if (field === 'value' || field === 'comment') {
						payload.filePath = currentSourceFiles.defaultFilePath;
					}

					if (field === 'language') {
						const lang = editableCell.dataset.lang;
						payload.filePath = currentSourceFiles.languageFilePaths[lang] || undefined;
					}

					if (field === 'name') {
						payload.allFilePaths = currentSourceFiles.allFilePaths;
					}

					vscode.postMessage(payload);
					editableCell.dataset.originalValue = newValue;

					if (field === 'name' && rowElement) {
						rowElement.dataset.keyName = newValue;
					}

					if (field === 'language') {
						if (!newValue) {
							editableCell.classList.add('missing-translation');
						} else {
							editableCell.classList.remove('missing-translation');
						}

						if (rowElement) {
							const nameCell = rowElement.querySelector('.name-column');
							const missingCells = rowElement.querySelectorAll('td.missing-translation[data-field="language"]');
							const missingLangs = Array.from(missingCells).map((cell) => cell.dataset.lang);

							if (missingLangs.length > 0) {
								nameCell.classList.add('has-missing-translations');
								const keyNameText = nameCell.textContent || '';
								const tooltipText = keyNameText + '\n\nMissing translations:\n' + missingLangs.join(', ');
								nameCell.title = tooltipText;
								nameCell.dataset.tooltip = tooltipText;
							} else {
								nameCell.classList.remove('has-missing-translations');
								nameCell.title = nameCell.textContent || '';
								nameCell.dataset.tooltip = '';
							}
						}
					}

					if (field === 'value') {
						if (!newValue) {
							editableCell.classList.add('missing-default-value');
						} else {
							editableCell.classList.remove('missing-default-value');
						}
					}

					showLoadingOverlay();
				});
			}
		}

		function handleFileContent(message) {
			if (message.error) {
				tableContainer.innerHTML = '<div class="no-file-selected">Error: ' + message.error + '</div>';
				return;
			}

			currentSourceFiles = {
				defaultFilePath: message.defaultFilePath,
				languageFilePaths: message.languageFilePaths || {},
				allFilePaths: message.allFilePaths || []
			};

			displayFileContent(message.baseName, message.languages, message.keys);
		}

		addKeyButton.addEventListener('click', () => {
			const keyName = (newKeyInput.value || '').trim();
			if (!keyName) {
				setStatus('Enter a key name first.', true);
				return;
			}

			const existingKeyNames = Array.from(tableContainer.querySelectorAll('tbody tr'))
				.map((trElement) => (trElement.dataset.keyName || '').toLocaleLowerCase())
				.filter(Boolean);
			if (existingKeyNames.includes(keyName.toLocaleLowerCase())) {
				setStatus('Duplicate key names are not allowed.', true);
				return;
			}

			if (!currentSourceFiles.allFilePaths || currentSourceFiles.allFilePaths.length === 0) {
				setStatus('Open a file group before adding a key.', true);
				return;
			}

			setStatus('Adding key...', false);
			showLoadingOverlay();
			vscode.postMessage({
				command: 'addKey',
				keyName,
				allFilePaths: currentSourceFiles.allFilePaths
			});
		});

		return {
			handleFileContent,
			clearSelectionView,
			getState: () => ({
				keys: currentKeys,
				languages: currentLanguages,
				sourceFiles: currentSourceFiles
			}),
			clearNewKeyInput: () => {
				newKeyInput.value = '';
			}
		};
	}

	window.createFileViewFeature = createFileViewFeature;
})();
