(function () {
	function createScannerFeature(options) {
		const {
			vscode,
			folderInput,
			scanButton,
			folderPickerButton,
			statusElement,
			fileListElement,
			searchInput,
			clearSearchButton,
			showLoadingOverlay,
			hideLoadingOverlay,
			onClearSelectionView
		} = options;

		let hasScannedAtLeastOnce = false;
		let currentSelectedGroup = null;
		let shouldRestoreSelectionAfterScan = false;
		let allFileGroups = [];

		function setStatus(message, isError) {
			statusElement.textContent = message;
			if (isError) {
				statusElement.classList.add('error');
			} else {
				statusElement.classList.remove('error');
			}
		}

		function requestScan(resetView) {
			setStatus(resetView ? 'Scanning...' : 'Refreshing...', false);
			showLoadingOverlay();

			if (resetView) {
				currentSelectedGroup = null;
				shouldRestoreSelectionAfterScan = false;
				fileListElement.innerHTML = '';
				onClearSelectionView();
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

		function renderGroups(groups) {
			fileListElement.innerHTML = '';

			for (const group of groups) {
				const groupContainer = document.createElement('div');
				groupContainer.className = 'group-item';
				groupContainer.title = group.baseName + ' - ' + (group.folderPath || '.');

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

				fileListElement.appendChild(groupContainer);
			}

			if (groups.length === 0) {
				const noResults = document.createElement('div');
				noResults.className = 'no-results';
				noResults.textContent = 'No files found';
				fileListElement.appendChild(noResults);
			}
		}

		function filterAndDisplayGroups() {
			const searchTerm = searchInput.value.toLowerCase();
			const filtered = allFileGroups.filter((group) => group.baseName.toLowerCase().includes(searchTerm));
			renderGroups(filtered);
		}

		function displayFileGroups(groups) {
			allFileGroups = groups;
			searchInput.value = '';
			renderGroups(groups);
		}

		function handleScanResult(message) {
			hideLoadingOverlay();

			if (message.error) {
				setStatus(message.error, true);
				fileListElement.innerHTML = '';
				return;
			}

			hasScannedAtLeastOnce = true;
			setStatus('Found ' + message.totalFiles + ' file(s) in ' + message.folder, false);
			displayFileGroups(message.groupedFiles || []);

			if (shouldRestoreSelectionAfterScan && currentSelectedGroup) {
				const selectedGroupStillExists = (message.groupedFiles || []).find(
					(group) =>
						group.baseName === currentSelectedGroup.baseName &&
						group.folderPath === currentSelectedGroup.folderPath
				);

				if (selectedGroupStillExists) {
					vscode.postMessage({
						command: 'openFileGroup',
						baseName: currentSelectedGroup.baseName,
						folderPath: currentSelectedGroup.folderPath
					});
				} else {
					currentSelectedGroup = null;
					onClearSelectionView();
				}

				shouldRestoreSelectionAfterScan = false;
			}
		}

		function handlePanelVisible() {
			if (hasScannedAtLeastOnce) {
				requestScan(false);
			}
		}

		function handleFolderPath(path) {
			if (path) {
				folderInput.value = path;
				requestScan(true);
			}
		}

		scanButton.addEventListener('click', () => {
			requestScan(true);
		});

		folderPickerButton.addEventListener('click', () => {
			vscode.postMessage({ command: 'pickFolder' });
		});

		searchInput.addEventListener('input', filterAndDisplayGroups);
		clearSearchButton.addEventListener('click', () => {
			searchInput.value = '';
			filterAndDisplayGroups();
			searchInput.focus();
		});

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible' && hasScannedAtLeastOnce) {
				requestScan(false);
			}
		});

		if (folderInput.value) {
			requestScan(true);
		}

		return {
			handleScanResult,
			handlePanelVisible,
			handleFolderPath,
			reloadSelectedGroup,
			getSelectedGroup: () => currentSelectedGroup
		};
	}

	window.createScannerFeature = createScannerFeature;
})();
