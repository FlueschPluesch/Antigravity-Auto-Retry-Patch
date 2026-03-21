# Antigravity Auto-Retry Patch

This utility provides a robust, cross-platform patch for the **Antigravity IDE** (VS Code based) that automatically checks for and clicks "Retry" (or "Wiederholen") buttons in the workbench UI with a bounded exponential backoff strategy.

## Why is this useful?
When working with AI agents or long-running tasks in Antigravity, you might encounter transient network failures or quota limits that prompt a "Retry" dialog. This script automates the process of clicking that button, ensuring your workflow isn't interrupted by manual intervention.

## Features
- **Cross-Platform Support:** Works on Windows, Linux, and macOS.
- **Auto-Detection:** Automatically finds the Antigravity installation path on all supported systems.
- **Detailed Logging:** Provides clear, timestamped feedback in the terminal for every step.
- **Bounded Exponential Backoff:** Retries immediately at first, then backs off quickly to avoid hammering the UI forever.
- **Safety First:** 
  - Automatically creates a backup (`workbench.html.bak`) before making changes.
  - Safely modifies the Content Security Policy (CSP) to allow the injection.
  - Handles elevation (sudo/Admin) elegantly.
- **Standalone:** No external dependencies—just standard Node.js libraries.

## Prerequisites
- **Node.js:** You must have Node.js installed on your system.
- **Antigravity IDE:** The IDE must be installed.

## Usage

### 1. Download the script
Copy `applyRetryPatch.js` from the `dist` folder to your local machine.

### 2. Run the patch
Open your terminal or command prompt and execute:

#### **Linux / macOS**
```bash
sudo node applyRetryPatch.js
```
*(The script will also attempt to call `sudo` internally if you forget, but it's recommended to run it with privileges directly.)*

#### **Windows**
1. Right-click your terminal (PowerShell or Command Prompt) and select **"Run as Administrator"**.
2. Run:
   ```cmd
   node applyRetryPatch.js
   ```

### 3. Restart Antigravity
After the script reports success, simply restart the Antigravity IDE. The auto-retry logic will now be active in the workbench.

## How it Works
The script injects a small, lightweight JavaScript snippet into the `workbench.html` file of the IDE. This snippet:
1. Runs in the main UI thread.
2. Scans for buttons every 1,000ms (1 second).
3. Looks for text like "Retry", "Try Again", "Wiederholen", or "Fortfahren".
4. Clicks immediately on the first failure, then uses fast retries followed by exponential backoff with an upper bound.
5. Resets the backoff window after the retry prompt has been gone for a while.

## Reverting Changes
If you ever want to revert the patch:
1. Locate the `workbench.html.bak` file in the same directory where `workbench.html` was found.
2. Delete the patched `workbench.html` and rename `workbench.html.bak` back to `workbench.html`.

## License
Distributed under the **MIT License**. See `LICENSE` for more information.
