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
- **Remote SSH Auto-Login**: Automatically injects passwords for remote SSH connections.
  - **AES-256 Encryption**: Your passwords are saved locally in an encrypted format, bound to your specific machine and user account.
- **Auto-Detection & Persistence**: The patcher automatically detects your current configuration and pre-fills the menu, so you don't have to remember your previous settings.
- **Interactive Configuration**: Choose exactly which features to enable during installation.
- **Cross-Platform Support**: Works on Windows, Linux, and macOS.
- **Safety First**: 
  - Automatically creates a backup (`workbench.html.bak`) before making changes.
  - Safely modifies the Content Security Policy (CSP) to allow the injection.
  - Handles elevation (sudo/Admin) elegantly.

## Prerequisites
- **Antigravity IDE**: The IDE must be installed.
- *(Optional)* **Node.js**: Only required if you choose the manual installation method.

## Installation / Usage

### Step 1: Run the patch

**Option A: Automatic One-Click Scripts (Recommended)**
These scripts temporarily download a portable version of Node.js to apply the patch, leaving your system completely clean without a permanent Node.js installation.

* **Windows**: Simply double-click `install_windows.bat`. *(Note: If you receive a "Code 1" or permission error, right-click the file and select **"Run as Administrator"**)*.
* **macOS**: 
  1. Open a terminal in the folder and make the script executable: `chmod +x install_mac.command`
  2. Double-click `install_mac.command` in Finder.
* **Linux**:
  1. Open a terminal in the folder and make the script executable: `chmod +x install_linux.sh`
  2. Run `./install_linux.sh` in the terminal (or double-click if your file manager supports it).

**Option B: Manual Installation (Requires installed Node.js)**
If you already have Node.js installed globally, open your terminal in the folder containing `applyAutoRetryContinueAllowPatch.js` and execute:
* **Windows**: Right-click your terminal and select **"Run as Administrator"**, then run `node applyAutoRetryContinueAllowPatch.js`
* **Linux / macOS**: Run `sudo node applyAutoRetryContinueAllowPatch.js`

### Step 2: Configure your options
The script will present a menu. Choose the desired combination of features:
1) All (Retry + Continue + Allow + Run) [Default]
2) Retry + Continue + Allow
3) Retry + Allow
...and more.

### Step 3: Restart Antigravity
After the script reports success, simply restart the Antigravity IDE. The selected logic will now be active in the workbench.

## How it Works
The script injects a small, lightweight JavaScript snippet into the `workbench.html` file. This snippet:
1. Runs in the main UI thread.
2. Scans for buttons and monitors state every **100ms**.
3. Checks for specific button text (case-insensitive) and uses `WeakSet` to ensure each button is clicked only once when appropriate.
4. Tracks the duration of the "Running" state to trigger the recovery sequence if a timeout is reached.
5. Checks for specific notification text and hides the corrupt installation notification.
6. **Remote SSH Auto-Login**:
   - Detects password prompts in the Quick Input widget.
   - Extracts host information and retrieves the matching **encrypted password** from your local database.
   - Injects the password and waits for the window to regain focus (e.g., after a CMD window has closed).
   - Once you click back into Antigravity, it waits 100ms and sends the "Enter" command to complete the login.

## Security & Privacy
The **Remote SSH Auto-Login** feature is designed with security in mind:
* **AES-256 Encryption**: Passwords are not stored in plain text. They are encrypted using the AES-256-CBC algorithm.
* **Machine-Bound**: The encryption key is derived from your local system account and hostname. This means the `ssh_passwords.json` file is useless if copied to another machine or used by another user account.
* **Local Only**: All credentials stay on your machine. Nothing is ever sent to any remote server or external service.

## Reverting Changes
The script includes a built-in restore function. Run the script like described above and choose 9: Reset All
If you want to revert the patch manually:
1. Locate the `workbench.html.bak` file in the same directory where `workbench.html` was found.
2. Delete the patched `workbench.html` and rename `workbench.html.bak` back to `workbench.html`.

## License
Distributed under the **MIT License**. See `LICENSE` for more information.
