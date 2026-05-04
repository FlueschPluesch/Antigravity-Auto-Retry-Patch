const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

/**
 * Antigravity Auto-Retry Patch Utility
 * This script injects a small JavaScript snippet into the Antigravity workbench
 * to automatically click "Retry" buttons and/or fix "Running" hangups.
 */

function log(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[\x1b[32m${timestamp}\x1b[0m] [INFO] ${message}`);
}

function warn(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.warn(`[\x1b[33m${timestamp}\x1b[0m] [WARN] ${message}`);
}

function error(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.error(`[\x1b[31m${timestamp}\x1b[0m] [ERROR] ${message}`);
}

/**
 * Generates the injection script based on the user's choice.
 */
function generateInjectionScript(choice) {
    const includeRetry = choice === 'all' || choice.includes('retry');
    const includeContinue = choice === 'all' || choice.includes('continue');
    const includeAllow = choice === 'all' || choice.includes('allow');
    const includeRun = choice === 'all' || choice.includes('run');

    return `
<!-- Antigravity Auto-Retry Patch Start -->
<script type="text/javascript">
(function() {
    console.log("Antigravity Auto-Retry: Direct Injection successful.");
    let intervalId = null;
    const clickedButtons = new WeakSet();
    ${includeContinue ? 'let runningCounter = 0;' : ''}
    ${includeContinue ? 'let hasSeenDots = false;' : ''}
    ${includeContinue ? 'let isHandlingSequence = false;' : ''}

    ${includeContinue ? `
    /**
     * Helper to find buttons by title, aria-label, or text.
     */
    function findButtonByAttribute(searchText) {
        const elements = Array.from(document.querySelectorAll('button, a.monaco-button, div.monaco-button'));
        const regex = new RegExp(searchText, 'i');
        return elements.find(el => {
            const title = el.getAttribute('title') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const text = el.textContent || '';
            return regex.test(title) || regex.test(ariaLabel) || regex.test(text);
        }) || null;
    }

    /**
     * Sets value and triggers events for an input field.
     */
    function setInputValue(selector, value) {
        const input = document.querySelector(selector);
        if (input) {
            input.focus();
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }

    /**
     * Recovery sequence: Cancel -> 3s -> "continue" -> 3s -> Send
     */
    async function executeRecoverySequence() {
        if (isHandlingSequence) return;
        isHandlingSequence = true;
        
        console.log('Antigravity Auto-Retry: "Running" state detected for > 30s. Executing recovery...');

        try {
            // 1. Click Cancel
            const cancelButton = findButtonByAttribute('Cancel');
            if (cancelButton) {
                console.log('Antigravity Auto-Retry: Clicking Cancel button.');
                cancelButton.click();
            }

            // 2. Wait 3 seconds
            await new Promise(r => setTimeout(r, 3000));

            // 3. Type "continue"
            const inputFound = setInputValue('textarea[placeholder*="Ask anything" i], input[placeholder*="Ask anything" i]', 'continue');
            if (inputFound) {
                console.log('Antigravity Auto-Retry: Input "continue" set.');
            }

            // 4. Wait 3 seconds
            await new Promise(r => setTimeout(r, 3000));

            // 5. Click Send
            const sendButton = findButtonByAttribute('Send');
            if (sendButton) {
                console.log('Antigravity Auto-Retry: Clicking Send button.');
                sendButton.click();
            }

        } catch (e) {
            console.error('Antigravity Auto-Retry: Error during recovery sequence:', e);
        } finally {
            runningCounter = 0;
            hasSeenDots = false;
            isHandlingSequence = false;
        }
    }
    ` : ''}

    function startAutoRetry() {
        if (intervalId) return;
        intervalId = setInterval(() => {
            try {
                const buttons = Array.from(document.querySelectorAll("button, a.monaco-button"));

                ${includeRetry ? `
                // --- Part 1: Auto Retry logic ---
                const retryButton = buttons.find(button => {
                    const text = (button.textContent || "").toLowerCase();
                    return (text.includes("retry") || 
                           text.includes("wiederholen") || 
                           text.includes("try again")) && !clickedButtons.has(button);
                });
                if (retryButton && !(retryButton.disabled)) {
                    console.log("Antigravity Auto-Retry: Found Retry button. Clicking...");
                    clickedButtons.add(retryButton);
                    retryButton.click();
                }
                ` : ''}

                ${includeAllow ? `
                // --- Part 2: Auto Allow logic ---
                const allowButton = buttons.find(button => {
                    const text = (button.textContent || "").toLowerCase();
                    return text.includes("allow") && !clickedButtons.has(button);
                });
                if (allowButton && !(allowButton.disabled)) {
                    console.log("Antigravity Auto-Retry: Found Allow button. Clicking...");
                    clickedButtons.add(allowButton);
                    allowButton.click();
                }
                ` : ''}

                ${includeRun ? `
                // --- Part 3: Auto Run logic ---
                const runButton = buttons.find(button => {
                    const text = (button.textContent || "").toLowerCase();
                    return text.includes("run") && !clickedButtons.has(button);
                });
                if (runButton && !(runButton.disabled)) {
                    console.log("Antigravity Auto-Retry: Found Run button. Clicking...");
                    clickedButtons.add(runButton);
                    runButton.click();
                }
                ` : ''}

                ${includeContinue ? `
                // --- Part 4: "Running" monitoring logic (Auto Continue) ---
                if (!isHandlingSequence) {
                    const bodyText = document.body.innerText || '';
                    const hasDots = /Running[.]{1,3}/.test(bodyText);
                    const hasPlain = bodyText.includes('Running');

                    if (hasDots) {
                        hasSeenDots = true;
                    }

                    // Count if we see dots, OR if we have seen dots in this streak and still see plain "Running"
                    if (hasDots || (hasSeenDots && hasPlain)) {
                        runningCounter++;
                        if (runningCounter >= 3000) { // 300 seconds at 100ms interval
                            executeRecoverySequence();
                        }
                    } else {
                        runningCounter = 0;
                        hasSeenDots = false;
                    }
                }
                ` : ''}
            } catch (e) {
                console.error("Antigravity Auto-Retry loop error:", e);
            }
        }, 100);
    }
    startAutoRetry();
})();
</script>
<!-- Antigravity Auto-Retry Patch End -->
`;
}

async function getPatchChoice() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('');
    console.log('\x1b[36m--- Patch Configuration ---\x1b[0m');
    console.log('1) All (Retry + Continue + Allow + Run) \x1b[90m[Default]\x1b[0m');
    console.log('2) Retry + Continue + Allow');
    console.log('3) Retry + Allow');
    console.log('4) Continue + Allow');
    console.log('5) Only Retry');
    console.log('6) Only Continue');
    console.log('7) Only Allow');
    console.log('8) Only Run');
    console.log('9) Reset all');

    return new Promise((resolve) => {
        rl.question('\nSelect an option (1-9) or press Enter for all: ', (answer) => {
            rl.close();
            switch (answer) {
                case '2': return resolve('retry_continue_allow');
                case '3': return resolve('retry_allow');
                case '4': return resolve('continue_allow');
                case '5': return resolve('retry');
                case '6': return resolve('continue');
                case '7': return resolve('allow');
                case '8': return resolve('run');
                case '9': return resolve('reset_all');
                default: return resolve('all');
            }
        });
    });
}

function isElevated() {
    if (process.platform === 'linux' || process.platform === 'darwin') {
        return process.getuid && process.getuid() === 0;
    } else if (process.platform === 'win32') {
        try {
            execSync('net session', { stdio: 'ignore' });
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

function getWorkbenchPath() {
    const relativeWorkbenchPath = path.join('resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');

    let possiblePaths = [];

    if (process.platform === 'linux') {
        possiblePaths.push(path.join('/usr', 'share', 'antigravity', relativeWorkbenchPath));
        possiblePaths.push(path.join('/opt', 'antigravity', relativeWorkbenchPath));
    } else if (process.platform === 'win32') {
        if (process.env.LOCALAPPDATA) {
            possiblePaths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', relativeWorkbenchPath));
        }
        if (process.env.ProgramFiles) {
            possiblePaths.push(path.join(process.env.ProgramFiles, 'Antigravity', relativeWorkbenchPath));
        }
        if (process.env['ProgramFiles(x86)']) {
            possiblePaths.push(path.join(process.env['ProgramFiles(x86)'], 'Antigravity', relativeWorkbenchPath));
        }
    } else if (process.platform === 'darwin') {
        possiblePaths.push(path.join('/Applications', 'Antigravity.app', 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'));
    }

    log(`Searching for Antigravity installation on ${process.platform}...`);
    for (const p of possiblePaths) {
        log(`Checking: ${p}`);
        if (fs.existsSync(p)) {
            log(`Found workbench.html at: ${p}`);
            return p;
        }
    }

    return null;
}

async function applyPatch() {
    log('--- Antigravity Retry Patch Utility ---');

    const choice = await getPatchChoice();
    log(`Selected mode: ${choice.toUpperCase()}`);

    const workbenchPath = getWorkbenchPath();
    if (!workbenchPath) {
        error('Could not find Antigravity installation path. Please ensure Antigravity is installed or check the script path definitions.');
        return;
    }

    const backupPath = workbenchPath + '.bak';
    let cleanHtml = '';
    //reset all
    try {
        if (choice.includes('reset_all')) {
            if (fs.existsSync(backupPath)) {
                log(`Found backup at ${backupPath}. Using it as clean base`);
                fs.writeFileSync(workbenchPath, fs.readFileSync(backupPath))
                log('------------------------------------------');
                log('Reset successfully applied!');
                log('Please restart Antigravity to see the changes.');
                log('------------------------------------------');
            }
            else {
                console.log('Backup does not exist, reset aborted')
                return;
            }
            return;
        }
    } catch (e) {
        if (!isElevated()) error('You do not have sufficient permissions. Run the script again as administrator');
        else if (e.code === 'EACCES') {
            warn('Permission denied while writing file.');
        } else {
            throw e;
        }
        return;
    }
    //normal patching proces
    try {
        // 1. Determine clean base content
        if (fs.existsSync(backupPath)) {
            log(`Found backup at ${backupPath}. Using it as clean base to prevent double patching.`);
            cleanHtml = fs.readFileSync(backupPath, 'utf8');
        } else {
            log(`No backup found. Reading current file and creating backup at ${backupPath}...`);
            cleanHtml = fs.readFileSync(workbenchPath, 'utf8');

            // Initial check to make sure we don't backup a file that's already patched
            if (cleanHtml.includes('Antigravity Auto-Retry Patch')) {
                error('The current workbench.html already contains a patch but no .bak file exists.');
                error('To be safe, please manually restore a clean workbench.html or create a workbench.html.bak from a clean version.');
                return;
            }

            try {
                fs.writeFileSync(backupPath, cleanHtml);
                log('Backup created successfully.');
            } catch (e) {
                if (e.code === 'EACCES') {
                    warn('Permission denied while creating backup. We will attempt to write the backup using elevated privileges during the final step.');
                } else {
                    throw e;
                }
            }
        }

        log('Preparing patched content...');
        let html = cleanHtml;
        const injectionScript = generateInjectionScript(choice);

        // 2. Inject 'unsafe-inline' into CSP (Content Security Policy)
        html = html.replace(/(script-src\s+[^;]*)/, (match) => {
            if (!match.includes("'unsafe-inline'")) {
                log('Updating CSP to allow injected script (adding \'unsafe-inline\')...');
                return match + " 'unsafe-inline'";
            }
            return match;
        });

        // 3. Inject the script before </body> or at the end of body
        if (html.includes('</body>')) {
            log('Injecting script before </body> tag...');
            html = html.replace('</body>', injectionScript + '</body>');
        } else if (html.includes('<body')) {
            log('Injecting script after <body ...> tag...');
            html = html.replace(/(<body[^>]*>)/, (match) => match + injectionScript);
        } else {
            warn('Could not find <body> tag, appending script to the end of file.');
            html += injectionScript;
        }

        // 4. Write back with privilege handling
        log('Writing patched content back to workbench.html...');

        if (isElevated()) {
            log('Running with sufficient privileges. Writing directly...');
            fs.writeFileSync(workbenchPath, html);
            // Also ensure backup exists if it didn't before (and we have permission now)
            if (!fs.existsSync(backupPath)) {
                fs.writeFileSync(backupPath, cleanHtml);
            }
            log('File written successfully.');
        } else {
            log('Not running with elevated privileges. Attempting to use platform-specific elevation...');

            if (process.platform === 'linux' || process.platform === 'darwin') {
                const tempPath = path.join(process.env.TMPDIR || '/tmp', 'workbench_patched.html');
                const tempBakPath = path.join(process.env.TMPDIR || '/tmp', 'workbench.html.bak');

                fs.writeFileSync(tempPath, html);
                let commands = `sudo cp "${tempPath}" "${workbenchPath}"`;

                if (!fs.existsSync(backupPath)) {
                    fs.writeFileSync(tempBakPath, cleanHtml);
                    commands += ` && sudo cp "${tempBakPath}" "${backupPath}"`;
                }

                log('Executing sudo to copy files to system path...');
                execSync(commands);
                log('Files moved successfully using sudo.');
            } else if (process.platform === 'win32') {
                error('Insufficient privileges to modify the file. Please run this command prompt or terminal as Administrator.');
                process.exit(1);
            }
        }

        log('------------------------------------------');
        log('Patch successfully applied!');
        log('Please restart Antigravity to see the changes.');
        log('------------------------------------------');

    } catch (err) {
        error(`An error occurred during the patching process: ${err.message}`);
    }
}

applyPatch();
