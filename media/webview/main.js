const vscode = acquireVsCodeApi();
const folderInput = document.getElementById('folderPath');
const folderPickerButton = document.getElementById('folderPickerButton');
const scanButton = document.getElementById('scanButton');
const status = document.getElementById('status');
const fileList = document.getElementById('fileList');
const editorTitle = document.getElementById('editorTitle');
const newKeyInput = document.getElementById('newKeyInput');
const addKeyButton = document.getElementById('addKeyButton');
const tableContainer = document.getElementById('tableContainer');
const loadingOverlay = document.getElementById('loadingOverlay');

function showLoadingOverlay() {
	loadingOverlay.classList.add('active');
}

function hideLoadingOverlay() {
	loadingOverlay.classList.remove('active');
}

let fileGroups = [];
let hasScannedAtLeastOnce = false;
let currentSelectedGroup = null;
let shouldRestoreSelectionAfterScan = false;
let currentSourceFiles = {
	defaultFilePath: undefined,
	languageFilePaths: {},
	allFilePaths: []
};
let currentLanguages = [];
let currentKeys = [];

const translationFeature = window.createTranslationFeature({
	vscode,
	statusElement: status,
	showLoadingOverlay,
	hideLoadingOverlay,
	getCurrentState: () => ({
		keys: currentKeys,
		languages: currentLanguages,
		selectedGroup: currentSelectedGroup,
		sourceFiles: currentSourceFiles
	}),
	openFileGroup: (group) => {
		vscode.postMessage({
			command: 'openFileGroup',
			baseName: group.baseName,
			folderPath: group.folderPath
		});
	},
	reloadSelectedGroup
});

function requestScan(resetView) {
	status.textContent = resetView ? 'Scanning...' : 'Refreshing...';
	status.classList.remove('error');
	showLoadingOverlay();

	if (resetView) {
		currentSelectedGroup = null;
		shouldRestoreSelectionAfterScan = false;
		fileList.innerHTML = '';
		tableContainer.innerHTML = '<div class="no-file-selected">No file selected</div>';
		editorTitle.textContent = 'Select a translation file to view';
	} else {
		shouldRestoreSelectionAfterScan = !!currentSelectedGroup;
	}

	vscode.postMessage({
		command: 'scan',
		folderPath: folderInput.value
	});
}

function reloadSelectedGroup() {
	if (!currentSelectedGroup) {
		requestScan(false);
		return;
	}

	vscode.postMessage({
		command: 'openFileGroup',
		baseName: currentSelectedGroup.baseName,
		folderPath: currentSelectedGroup.folderPath
	});
}

scanButton.addEventListener('click', () => {
	requestScan(true);
});

folderPickerButton.addEventListener('click', () => {
	vscode.postMessage({
		command: 'pickFolder'
	});
});

addKeyButton.addEventListener('click', () => {
	const keyName = (newKeyInput.value || '').trim();
	if (!keyName) {
		status.textContent = 'Enter a key name first.';
		status.classList.add('error');
		return;
	}

	const existingKeyNames = Array.from(tableContainer.querySelectorAll('tbody tr'))
		.map((trElement) => (trElement.dataset.keyName || '').toLocaleLowerCase())
		.filter(Boolean);
	if (existingKeyNames.includes(keyName.toLocaleLowerCase())) {
		status.textContent = 'Duplicate key names are not allowed.';
		status.classList.add('error');
		return;
	}

	if (!currentSourceFiles.allFilePaths || currentSourceFiles.allFilePaths.length === 0) {
		status.textContent = 'Open a file group before adding a key.';
		status.classList.add('error');
		return;
	}

	status.classList.remove('error');
	status.textContent = 'Adding key...';
	showLoadingOverlay();
	vscode.postMessage({
		command: 'addKey',
		keyName,
		allFilePaths: currentSourceFiles.allFilePaths
	});
});

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState !== 'visible') {
		return;
	}

	if (!hasScannedAtLeastOnce) {
		return;
	}

	requestScan(false);
});

const searchInput = document.getElementById('searchInput');
const clearSearchButton = document.getElementById('clearSearchButton');
let allFileGroups = [];

function filterAndDisplayGroups() {
	const searchTerm = searchInput.value.toLowerCase();
	const filtered = allFileGroups.filter((group) =>
		group.baseName.toLowerCase().includes(searchTerm)
	);
	renderGroups(filtered);
}

searchInput.addEventListener('input', filterAndDisplayGroups);

clearSearchButton.addEventListener('click', () => {
	searchInput.value = '';
	filterAndDisplayGroups();
	searchInput.focus();
});

// Auto-scan on load if a folder path is saved
if (folderInput.value) {
	requestScan(true);
}

function displayFileGroups(groups) {
	allFileGroups = groups;
	searchInput.value = '';
	renderGroups(groups);
}

function renderGroups(groups) {
	fileList.innerHTML = '';

	for (const group of groups) {
		const groupContainer = document.createElement('div');
		groupContainer.className = 'group-item';
		groupContainer.title = `${group.baseName} - ${group.folderPath || '.'}`;

		const baseNameItem = document.createElement('div');
		baseNameItem.className = 'base-name-item';
		baseNameItem.textContent = group.baseName;
		if (
			currentSelectedGroup &&
			currentSelectedGroup.baseName === group.baseName &&
			currentSelectedGroup.folderPath === group.folderPath
		) {
			groupContainer.classList.add('active');
		}
		groupContainer.addEventListener('click', () => {
			document.querySelectorAll('.base-name-item').forEach((item) => item.classList.remove('active'));
			document.querySelectorAll('.group-item').forEach((item) => item.classList.remove('active'));
			groupContainer.classList.add('active');
			currentSelectedGroup = {
				baseName: group.baseName,
				folderPath: group.folderPath
			};
			shouldRestoreSelectionAfterScan = false;
			vscode.postMessage({
				command: 'openFileGroup',
				baseName: group.baseName,
				folderPath: group.folderPath
			});
		});
		groupContainer.appendChild(baseNameItem);

		const folderPathItem = document.createElement('div');
		folderPathItem.className = 'group-folder-path';
		folderPathItem.textContent = group.folderPath || '.';
		groupContainer.appendChild(folderPathItem);

		fileList.appendChild(groupContainer);
	}

	if (groups.length === 0) {
		const noResults = document.createElement('div');
		noResults.className = 'no-results';
		noResults.textContent = 'No files found';
		fileList.appendChild(noResults);
	}
}

function displayFileContent(baseName, languages, keys) {
	editorTitle.textContent = baseName;
	currentLanguages = languages;
	currentKeys = keys;
	translationFeature.updateAvailability(languages, keys);

	if (!keys || keys.length === 0) {
		translationFeature.updateAvailability([], []);
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
				status.textContent = 'Open a file group before deleting a key.';
				status.classList.add('error');
				return;
			}

			status.classList.remove('error');
			status.textContent = 'Deleting key...';
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
			const tooltipText = `${row.name}\n\nMissing translations:\n${missingLanguages.join(', ')}`;
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
					status.textContent = 'Key name cannot be empty.';
					status.classList.add('error');
					editableCell.textContent = originalValue;
					return;
				}

				const duplicateNameExists = Array.from(table.querySelectorAll('tbody tr')).some(
					(trElement) =>
						trElement !== rowElement &&
						(trElement.dataset.keyName || '').toLocaleLowerCase() === newValue.toLocaleLowerCase()
				);
				if (duplicateNameExists) {
					status.textContent = 'Duplicate key names are not allowed.';
					status.classList.add('error');
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
						const keyName = nameCell.textContent || '';
						const tooltipText = `${keyName}\n\nMissing translations:\n${missingLangs.join(', ')}`;
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

window.addEventListener('message', (event) => {
	const message = event.data;

	if (message.command === 'panelVisible') {
		if (hasScannedAtLeastOnce) {
			requestScan(false);
		}
	} else if (message.command === 'scanResult') {
		hideLoadingOverlay();
		if (message.error) {
			status.textContent = message.error;
			status.classList.add('error');
			fileList.innerHTML = '';
			return;
		}

		hasScannedAtLeastOnce = true;
		status.classList.remove('error');
		status.textContent = 'Found ' + message.totalFiles + ' file(s) in ' + message.folder;
		displayFileGroups(message.groupedFiles || []);

		if (shouldRestoreSelectionAfterScan && currentSelectedGroup) {
			const selectedGroupStillExists = (message.groupedFiles || []).find(
				(group) => group.baseName === currentSelectedGroup.baseName && group.folderPath === currentSelectedGroup.folderPath
			);

			if (selectedGroupStillExists) {
				vscode.postMessage({
					command: 'openFileGroup',
					baseName: currentSelectedGroup.baseName,
					folderPath: currentSelectedGroup.folderPath
				});
			} else {
				currentSelectedGroup = null;
				tableContainer.innerHTML = '<div class="no-file-selected">No file selected</div>';
				editorTitle.textContent = 'Select a translation file to view';
			}

			shouldRestoreSelectionAfterScan = false;
		}
	} else if (message.command === 'fileContent') {
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
		translationFeature.onFileContentLoaded();
	} else if (message.command === 'saveCellResult') {
		hideLoadingOverlay();
		if (message.error) {
			status.textContent = 'Save failed: ' + message.error;
			status.classList.add('error');
			return;
		}

		status.classList.remove('error');
		status.textContent = 'Saved';
	} else if (message.command === 'keyMutationResult') {
		hideLoadingOverlay();
		if (message.error) {
			status.textContent = (message.action === 'add' ? 'Add failed: ' : 'Delete failed: ') + message.error;
			status.classList.add('error');
			return;
		}

		status.classList.remove('error');
		status.textContent = message.action === 'add' ? 'Key added' : 'Key deleted';

		if (message.action === 'add') {
			newKeyInput.value = '';
		}

		reloadSelectedGroup();
	} else if (message.command === 'folderPath') {
		if (message.path) {
			folderInput.value = message.path;
			requestScan(true);
		}
	} else if (message.command === 'batchTranslateResult') {
		translationFeature.handleBatchTranslateResult(message);
	}
});
