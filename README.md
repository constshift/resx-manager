# RESX Translation Manager

Manage .resx localization files in one place, quickly detect missing translations, and batch-translate missing values directly from VS Code.

## What This Extension Does

RESX Translation Manager opens a dedicated webview where you can:

- Scan a workspace folder for .resx files
- Group translation files by base name (for example: Resources.resx, Resources.de.resx, Resources.fr.resx)
- View and edit keys across default and localized files in a single table
- Add, rename, and delete keys across all language files in a group
- Highlight missing default values and missing translations
- Batch translate missing values with Azure Translator or Google Translate

## Command

Open Command Palette and run:

- RESX Translation Manager - Open Translation Scanner

## Quick Start

1. Open your project folder in VS Code.
2. Run RESX Translation Manager - Open Translation Scanner.
3. In Folder, enter a relative path (for example: src/translations) or click the folder picker.
4. Click Scan.
5. Select a file group from the left sidebar.
6. Edit values inline, or use Add Key / delete actions as needed.
7. Click Batch Translate to fill missing language values.

## File Naming and Grouping

The scanner groups files by base name and folder.

Examples:

- Resources.resx -> default language file
- Resources.de.resx -> German
- Resources.de-DE.resx -> German (Germany)

Each group is shown once in the sidebar, and all files in that group are edited together.

## Editing Behavior

- Name column: renames the key in every file of the group
- Value column: updates the default .resx file
- Comment column: updates the default .resx file comment
- Language columns: update each language-specific .resx file
- Add Key: inserts the key in all files in the group
- Delete key action: removes the key from all files in the group

Validation and safety checks:

- Duplicate key names are blocked (case-insensitive)
- Paths are restricted to the current workspace
- Scan path is saved to workspace settings for next session

## Batch Translation

Use the Batch Translate button to translate missing values only.

Supported providers:

- Azure Translator
- Google Translate (untested)

Credential sources (priority order):

1. Values entered in the batch-translate modal
2. Environment variables

Environment variables:

- AZURE_TRANSLATE_KEY
- AZURE_TRANSLATE_REGION
- GOOGLE_TRANSLATE_API_KEY

Notes:

- Only keys with a non-empty default value are eligible for translation.
- Language codes are normalized to their primary language for provider requests (for example, de-DE -> de).

## Extension Setting

This extension contributes:

- resx-translation-manager.scanFolderPath: Default relative folder path used by the translation scanner.

## Requirements

- VS Code 1.110.0 or newer
- A workspace folder open in VS Code
- .resx files in your repository
- Optional: Azure Translator or Google Translate credentials for batch translation

## Known Limitations

- Translation provider calls are made sequentially.
- Batch translation updates value fields only (not comments).
- Lacking support for translation sources

## Release Notes

### 0.0.1

Initial preview release.
