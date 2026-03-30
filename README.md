# Antigravity Auto-Retry & Recovery Patch

This utility provides a robust, cross-platform patch for the **Antigravity IDE** (VS Code based) that automates common UI interactions to keep your AI agents running smoothly.

## Why is this useful?
When working with AI agents or long-running tasks in Antigravity, you might encounter transient network failures, quota limits, or "Running" hangups. This script automates the process of clicking "Retry", "Allow", and "Run" buttons, and even handles situations where the agent appears to be stuck.

## Features
- **Auto-Retry**: Automatically clicks "Retry", "Try Again", or "Wiederholen" buttons.
- **Auto-Continue (Recovery Sequence)**: Monitors the "Running..." state. If it persists for more than 30 seconds, the script automatically:
  1. Clicks **Cancel**.
  2. Waits 3 seconds.
  3. Types **"continue"** into the chat input.
  4. Waits 3 seconds.
  5. Clicks **Send**.
- **Auto-Allow**: Automatically clicks "Allow" buttons.
- **Auto-Run**: Automatically clicks "Run" buttons.
- **Interactive Configuration**: Choose exactly which features to enable during installation.
- **Cross-Platform Support**: Works on Windows, Linux, and macOS.
- **Auto-Detection**: Automatically finds the Antigravity installation path.
- **Safety First**: 
  - Automatically creates a backup (`workbench.html.bak`) before making changes.
  - Safely modifies the Content Security Policy (CSP) to allow the injection.
  - Handles elevation (sudo/Admin) elegantly.

## Prerequisites
- **Node.js**: You must have Node.js installed on your system.
- **Antigravity IDE**: The IDE must be installed.

## Usage

### 1. Run the patch
Open your terminal or command prompt in the folder containing `applyAutoRetryContinueAllowPatch.js` and execute:

#### **Linux / macOS**
```bash
sudo node applyAutoRetryContinueAllowPatch.js
```
*(The script will also attempt to call `sudo` internally if you forget, but it's recommended to run it with privileges directly.)*

#### **Windows**
1. Right-click your terminal (PowerShell or Command Prompt) and select **"Run as Administrator"**.
2. Run:
   ```cmd
   node applyAutoRetryContinueAllowPatch.js
   ```

### 2. Configure your options
The script will present a menu. Choose the desired combination of features:
1) All (Retry + Continue + Allow + Run) [Default]
2) Retry + Continue + Allow
3) Retry + Allow
...and more.

### 3. Restart Antigravity
After the script reports success, simply restart the Antigravity IDE. The selected logic will now be active in the workbench.

## How it Works
The script injects a small, lightweight JavaScript snippet into the `workbench.html` file. This snippet:
1. Runs in the main UI thread.
2. Scans for buttons and monitors state every **100ms**.
3. Checks for specific button text (case-insensitive) and uses `WeakSet` to ensure each button is clicked only once when appropriate.
4. Tracks the duration of the "Running" state to trigger the recovery sequence if a timeout is reached.

## Reverting Changes
If you ever want to revert the patch:
1. Locate the `workbench.html.bak` file in the same directory where `workbench.html` was found.
2. Delete the patched `workbench.html` and rename `workbench.html.bak` back to `workbench.html`.

## License
Distributed under the **MIT License**. See `LICENSE` for more information.
