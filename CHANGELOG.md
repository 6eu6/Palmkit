# Changelog

All notable changes to Palmkit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-07



## What's Changed 🌟

### 🔄 Changes since v0.0.7

### ✨ Features

* restoring project from snapshot on reload ([#444](https://github.com/6eu6/Palmkit/pull/444)) by @thecodacus
* add Claude 3.7 Sonnet model as static list and update API key reference ([#1449](https://github.com/6eu6/Palmkit/pull/1449)) by @BurhanCantCode
* electron desktop app without express server ([#1136](https://github.com/6eu6/Palmkit/pull/1136)) by @Derek-X-Wang
* supabase integration #1542 from xKevIsDev/supabase (1364d4a) by @leex279
* bugfix for : Problem Temporarily Solved, Not Fix: Error building my application #1414 ([#1567](https://github.com/6eu6/Palmkit/pull/1567)) by @Stijnus
* bolt dyi datatab ([#1570](https://github.com/6eu6/Palmkit/pull/1570)) by @Stijnus
* bolt dyi preview final ([#1569](https://github.com/6eu6/Palmkit/pull/1569)) by @Stijnus
* new improvement for the GitHub API Authentication Fix  ([#1537](https://github.com/6eu6/Palmkit/pull/1537)) by @Stijnus
* rework Task Manager Real Data ([#1483](https://github.com/6eu6/Palmkit/pull/1483)) by @Stijnus
* add Vercel integration for project deployment ([#1559](https://github.com/6eu6/Palmkit/pull/1559)) by @xKevIsDev
* bulk delete chats from sidebar ([#1586](https://github.com/6eu6/Palmkit/pull/1586)) by @Stijnus
* consolidate sync & export items into an overflow menu ([#1602](https://github.com/6eu6/Palmkit/pull/1602)) by @kochrt
* update connectiontab and datatab security fix ([#1614](https://github.com/6eu6/Palmkit/pull/1614)) by @Stijnus
* fix for push private repo ([#1618](https://github.com/6eu6/Palmkit/pull/1618)) by @Stijnus
* add expo app creation, enhance ui, and refactor code ([#1651](https://github.com/6eu6/Palmkit/pull/1651)) by @xKevIsDev
* implement a search functionality to search codebase ([#1676](https://github.com/6eu6/Palmkit/pull/1676)) by @xKevIsDev
* lock files ([#1681](https://github.com/6eu6/Palmkit/pull/1681)) by @Stijnus
* github fix and ui improvements ([#1685](https://github.com/6eu6/Palmkit/pull/1685)) by @Stijnus


### 🐛 Bug Fixes

* handle empty content correctly in FilesStore saveFile() ([#1381](https://github.com/6eu6/Palmkit/pull/1381)) by @bizrockman
* OpenAILike api key not showing up ([#1403](https://github.com/6eu6/Palmkit/pull/1403)) by @thecodacus
* git connection fix for starter template ([#1411](https://github.com/6eu6/Palmkit/pull/1411)) by @thecodacus
* support php language in diff view (b018742) by @xKevIsDev
* added a bunch more common languages to diff view (964e197) by @xKevIsDev
* git clone modal to work with non main as default branch ([#1428](https://github.com/6eu6/Palmkit/pull/1428)) by @thecodacus
* git cookies are auto set anytime connects changed or loaded ([#1461](https://github.com/6eu6/Palmkit/pull/1461)) by @thecodacus
* fix git proxy to work with other git provider ([#1466](https://github.com/6eu6/Palmkit/pull/1466)) by @thecodacus
* attachment not getting sent on first message if starter template is turned on ([#1472](https://github.com/6eu6/Palmkit/pull/1472)) by @thecodacus
* settings bugfix error building my application  issue #1414 ([#1436](https://github.com/6eu6/Palmkit/pull/1436)) by @Stijnus
* update stream-text.ts ([#1582](https://github.com/6eu6/Palmkit/pull/1582)) by @Stijnus
* whitelist vue and svelte files ([#1598](https://github.com/6eu6/Palmkit/pull/1598)) by @kochrt
* simplify the SHA-1 hash function in netlify deploy by using the crypto module directly ([#1590](https://github.com/6eu6/Palmkit/pull/1590)) by @xKevIsDev
* fix load server build problem by fix dep version ([#1625](https://github.com/6eu6/Palmkit/pull/1625)) by @Derek-X-Wang
* optimize file watch paths for preview updates and fix npm crashes ([#1644](https://github.com/6eu6/Palmkit/pull/1644)) by @xKevIsDev
* make diff button consistent with other toolbar buttons ([#1601](https://github.com/6eu6/Palmkit/pull/1601)) by @kochrt
* invalid line number error in search functionality ([#1682](https://github.com/6eu6/Palmkit/pull/1682)) by @Stijnus
* fix icon classes for consistency and clarity #release:major (870828d) by @xKevIsDev
* fix icon classes for consistency and clarity #release:major (6e9a1b6) by @xKevIsDev
* icon classes to existing icons #release:major (e9df523) by @xKevIsDev
* revert back to previous commit (553fa5d) by @xKevIsDev


### 📚 Documentation

* docs README.md changes (Webcontainer liicensing for commercial, other small things) (88901f3) by @leex279


### ♻️ Code Refactoring

* remove success toast and prioritize public domain URL ([#1613](https://github.com/6eu6/Palmkit/pull/1613)) by @xKevIsDev
* optimize error handling and npm install performance ([#1688](https://github.com/6eu6/Palmkit/pull/1688)) by @xKevIsDev


### ⚙️ CI

* updated target for docker build ([#1451](https://github.com/6eu6/Palmkit/pull/1451)) by @thecodacus
* give electron action permission ([#1549](https://github.com/6eu6/Palmkit/pull/1549)) by @Derek-X-Wang
* only draft release for branch build ([#1577](https://github.com/6eu6/Palmkit/pull/1577)) by @Derek-X-Wang
* remove macOS code signing credentials from workflow ([#1677](https://github.com/6eu6/Palmkit/pull/1677)) by @xKevIsDev
* add Electron build process to release workflow (73442dd) by @xKevIsDev
* reorder steps and add env vars for Electron build #release:major (a76013f) by @xKevIsDev


### 🔍 Other Changes

* Delete wrangler.toml (60b6f47) by @leex279
* Delete .tool-versions (2780b2e) by @leex279
* Revert "Delete wrangler.toml" (8d1f138) by @thecodacus
* Merge branch 'docker-fix' (5528306) by @thecodacus
* fix icon classes for consistency and clarity #release:major" (4354ad4) by @xKevIsDev
* fix icon classes for consistency and clarity #release:major" (5630be7) by @xKevIsDev


## ✨ First-time Contributors

A huge thank you to our amazing new contributors! Your first contribution marks the start of an exciting journey! 🌟

* 🌟 [@BurhanCantCode](https://github.com/BurhanCantCode)
* 🌟 [@Derek-X-Wang](https://github.com/Derek-X-Wang)
* 🌟 [@bizrockman](https://github.com/bizrockman)

## 📈 Stats

**Full Changelog**: [`v0.0.7..v1.0.0`](https://github.com/6eu6/Palmkit/compare/v0.0.7...v1.0.0)

### File and Folder Locking Feature

## Overview

This implementation adds persistent file and folder locking functionality to the BoltDIY project. When a file or folder is locked, it cannot be modified by either the user or the AI until it is unlocked. All locks are scoped to the current chat/project to prevent locks from one project affecting files with matching names in other projects.

## New Files

### 1. `app/components/chat/LockAlert.tsx`

- A dedicated alert component for displaying lock-related error messages
- Features a distinctive amber/yellow color scheme and lock icon
- Provides clear instructions to the user about locked files

### 2. `app/lib/persistence/lockedFiles.ts`

- Core functionality for persisting file and folder locks in localStorage
- Provides functions for adding, removing, and retrieving locked files and folders
- Defines the lock modes: "full" (no modifications) and "scoped" (only additions allowed)
- Implements chat ID scoping to isolate locks to specific projects

### 3. `app/utils/fileLocks.ts`

- Utility functions for checking if a file or folder is locked
- Helps avoid circular dependencies between components and stores
- Provides a consistent interface for lock checking across the application
- Extracts chat ID from URL for project-specific lock scoping

## Modified Files

### 1. `app/components/chat/ChatAlert.tsx`

- Updated to use the new LockAlert component for locked file errors
- Maintains backward compatibility with other error types

### 2. `app/components/editor/codemirror/CodeMirrorEditor.tsx`

- Added checks to prevent editing of locked files
- Updated to use the new fileLocks utility
- Displays appropriate tooltips when a user attempts to edit a locked file

### 3. `app/components/workbench/EditorPanel.tsx`

- Added safety checks for unsavedFiles to prevent errors
- Improved handling of locked files in the editor panel

### 4. `app/components/workbench/FileTree.tsx`

- Added visual indicators for locked files and folders in the file tree
- Improved handling of locked files and folders in the file tree
- Added context menu options for locking and unlocking folders

### 5. `app/lib/stores/editor.ts`

- Added checks to prevent updating locked files
- Improved error handling for locked files

### 6. `app/lib/stores/files.ts`

- Added core functionality for locking and unlocking files and folders
- Implemented persistence of locked files and folders across page refreshes
- Added methods for checking if a file or folder is locked
- Added chat ID scoping to prevent locks from affecting other projects

### 7. `app/lib/stores/workbench.ts`

- Added methods for locking and unlocking files and folders
- Improved error handling for locked files and folders
- Fixed issues with alert initialization
- Added support for chat ID scoping of locks

### 8. `app/types/actions.ts`

- Added `isLockedFile` property to the ActionAlert interface
- Improved type definitions for locked file alerts

## Key Features

1. **Persistent File and Folder Locking**: Locks are stored in localStorage and persist across page refreshes
2. **Visual Indicators**: Locked files and folders are clearly marked in the UI with lock icons
3. **Improved Error Messages**: Clear, visually distinct error messages when attempting to modify locked items
4. **Lock Modes**: Support for both full locks (no modifications) and scoped locks (only additions allowed)
5. **Prevention of AI Modifications**: The AI is prevented from modifying locked files and folders
6. **Project-Specific Locks**: Locks are scoped to the current chat/project to prevent conflicts
7. **Recursive Folder Locking**: Locking a folder automatically locks all files and subfolders within it

## UI Improvements

1. **Enhanced Alert Design**: Modern, visually appealing alert design with better spacing and typography
2. **Contextual Icons**: Different icons and colors for different types of alerts
3. **Improved Error Details**: Better formatting of error details with monospace font and left border
4. **Responsive Buttons**: Better positioned and styled buttons with appropriate hover effects
