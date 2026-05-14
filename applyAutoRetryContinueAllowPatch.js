const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const os = require('os');

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
 * Reads SSH config and extracts host entries with their aliases and HostNames.
 */
function getSshConfigEntries() {
    try {
        const osHome = process.env.HOME || process.env.USERPROFILE || '';
        const sshConfigPath = path.join(osHome, '.ssh', 'config');
        if (!fs.existsSync(sshConfigPath)) return [];

        const content = fs.readFileSync(sshConfigPath, 'utf8');
        const lines = content.split(/\r?\n/);
        const entries = [];
        let currentEntry = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.toLowerCase().startsWith('host ')) {
                if (currentEntry) entries.push(currentEntry);
                currentEntry = {
                    hosts: trimmed.substring(5).trim().split(/\s+/).filter(h => h && h !== '*' && !h.includes('?') && !h.includes('!')),
                    hostname: null
                };
            } else if (currentEntry && trimmed.toLowerCase().startsWith('hostname ')) {
                currentEntry.hostname = trimmed.substring(9).trim();
            }
        }
        if (currentEntry && currentEntry.hosts.length > 0) entries.push(currentEntry);
        return entries;
    } catch (e) {
        return [];
    }
}

/**
 * Ensures that necessary VS Code / Antigravity settings are set for auto-login.
 */
function ensureSettings() {
    try {
        const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
        const settingsPath = path.join(appData, 'Antigravity', 'User', 'settings.json');

        if (fs.existsSync(settingsPath)) {
            let settings = {};
            try {
                settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            } catch (e) {
                warn('Could not parse settings.json, creating new one.');
            }

            let changed = false;
            if (settings['remote.SSH.showLoginTerminal'] !== true) {
                settings['remote.SSH.showLoginTerminal'] = true;
                changed = true;
                log('Setting "remote.SSH.showLoginTerminal" to true in settings.json');
            }

            if (changed) {
                fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf8');
                log('Successfully updated settings.json');
            }
        } else {
            warn(`Settings file not found at ${settingsPath}. Please ensure "remote.SSH.showLoginTerminal" is true manually.`);
        }
    } catch (e) {
        warn('Error updating settings.json: ' + e.message);
    }
}

const crypto = require('crypto');

// --- Encryption Helpers ---
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

/**
 * Generates a machine-specific encryption key.
 */
function getEncryptionKey() {
    const user = os.userInfo().username || 'default';
    const host = os.hostname() || 'machine';
    const salt = 'antigravity-secret-salt';
    return crypto.scryptSync(user + host + salt, 'salt', 32);
}

/**
 * Encrypts a string using AES-256-CBC.
 */
function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypts a string using AES-256-CBC.
 */
function decrypt(text) {
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, getEncryptionKey(), iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

/**
 * Determines the system-specific path for the password storage.
 */
function getPasswordFilePath() {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const folderPath = path.join(appData, 'Antigravity-Auto-Retry-Patch');
    
    // Ensure the directory exists
    if (!fs.existsSync(folderPath)) {
        try {
            fs.mkdirSync(folderPath, { recursive: true });
        } catch (e) {
            // Fallback to local if folder creation fails
            return path.join(__dirname, 'ssh_passwords.json');
        }
    }
    
    return path.join(folderPath, 'ssh_passwords.json');
}

/**
 * Migrates the password file from the local directory to the system AppData folder if needed.
 */
function migratePasswords() {
    const localPath = path.join(__dirname, 'ssh_passwords.json');
    const systemPath = getPasswordFilePath();
    
    // Only migrate if local exists and system doesn't (or they are the same which is unlikely but handled)
    if (fs.existsSync(localPath) && localPath !== systemPath && !fs.existsSync(systemPath)) {
        try {
            fs.copyFileSync(localPath, systemPath);
            log(`Migrated passwords to system AppData folder.`);
        } catch (e) {
            warn('Failed to migrate passwords to AppData: ' + e.message);
        }
    }
}

/**
 * Loads saved SSH passwords from a local file and decrypts them.
 */
function loadSavedPasswords() {
    migratePasswords();
    const p = getPasswordFilePath();
    if (fs.existsSync(p)) {
        try {
            const encryptedData = JSON.parse(fs.readFileSync(p, 'utf8'));
            const decryptedData = {};
            for (const key in encryptedData) {
                const decrypted = decrypt(encryptedData[key]);
                if (decrypted) decryptedData[key] = decrypted;
            }
            return decryptedData;
        } catch (e) {
            return {};
        }
    }
    return {};
}

/**
 * Encrypts and saves SSH passwords to a local file.
 */
function savePasswords(passwords) {
    const p = getPasswordFilePath();
    try {
        const encryptedData = {};
        for (const key in passwords) {
            encryptedData[key] = encrypt(passwords[key]);
        }
        fs.writeFileSync(p, JSON.stringify(encryptedData, null, 4), 'utf8');
    } catch (e) {
        warn('Could not save passwords: ' + e.message);
    }
}

/**
 * Prompt user for passwords for specific hosts.
 */
async function promptForSshPasswords(rl) {
    const entries = getSshConfigEntries();
    if (entries.length === 0) {
        warn('No valid SSH hosts found in ~/.ssh/config.');
        return {};
    }

    let sshPasswords = loadSavedPasswords();

    while (true) {
        console.log('\n\x1b[36m--- SSH Password Configuration ---\x1b[0m');
        console.log('Found SSH entries in your config:');
        entries.forEach((e, i) => {
            const aliasStr = e.hosts.join(', ');
            const hostNameStr = e.hostname ? ` (HostName: ${e.hostname})` : '';
            const isSet = e.hosts.some(h => sshPasswords[h]) || (e.hostname && sshPasswords[e.hostname]);
            const status = isSet ? '\x1b[32m [SET]\x1b[0m' : '\x1b[90m [NOT SET]\x1b[0m';
            console.log(`${i + 1}) ${aliasStr}${hostNameStr}${status}`);
        });
        console.log('c) Done / Continue to next step');

        const answer = await new Promise(r => rl.question('\nSelect an entry number to add/change a password (or "c" to finish): ', r));
        if (answer.toLowerCase() === 'c') break;

        const idx = parseInt(answer) - 1;
        if (idx >= 0 && idx < entries.length) {
            const entry = entries[idx];
            const primaryHost = entry.hosts[0];
            const password = await new Promise(r => rl.question(`Enter password for "${primaryHost}" (leave empty to keep current): `, r));
            if (password) {
                const b64 = Buffer.from(password).toString('base64');
                // Map to all aliases
                entry.hosts.forEach(h => {
                    sshPasswords[h] = b64;
                });
                // Map to the actual HostName if available
                if (entry.hostname) {
                    sshPasswords[entry.hostname] = b64;
                }
                savePasswords(sshPasswords);
                log(`Password updated and saved for ${primaryHost}.`);
            }
        } else {
            console.log('\x1b[31mInvalid selection.\x1b[0m');
        }
    }
    return sshPasswords;
}

/**
 * Generates the injection script based on the user's choice.
 */
function generateInjectionScript(choice, hideCorruption, enableDebug, enableSshAutoLogin, sshPasswords = {}) {
    const includeRetry = choice === 'all' || choice.includes('retry');
    const includeContinue = choice === 'all' || choice.includes('continue');
    const includeAllow = choice === 'all' || choice.includes('allow');
    const includeRun = choice === 'all' || choice.includes('run');
    const includeHideCorruption = hideCorruption;
    const includeSshAutoLogin = enableSshAutoLogin;

    const configMetadata = {
        choice,
        ssh: enableSshAutoLogin,
        corruption: hideCorruption,
        debug: enableDebug
    };

    return `
<!-- Antigravity Auto-Retry Patch Start -->
<!-- PATCH_CONFIG: ${JSON.stringify(configMetadata)} -->
<script type="text/javascript">
(function() {
    console.log("Antigravity Auto-Retry: Direct Injection successful.");
    let intervalId = null;
    const clickedButtons = new WeakSet();
    ${includeContinue ? 'let runningCounter = 0;' : ''}
    ${includeContinue ? 'let hasSeenDots = false;' : ''}
    ${includeContinue ? 'let isHandlingSequence = false;' : ''}

    const AntigravityFS = (function() {
        let fs = null, path = null, basePath = '';
        try {
            if (typeof window.requireNode !== 'undefined') {
                fs = window.requireNode('fs');
                path = window.requireNode('path');
            } else if (typeof require !== 'undefined' && require.nodeRequire) {
                fs = require.nodeRequire('fs');
                path = require.nodeRequire('path');
            } else if (typeof process !== 'undefined' && process.mainModule) {
                fs = process.mainModule.require('fs');
                path = process.mainModule.require('path');
            } else if (typeof require !== 'undefined') {
                fs = require('fs');
                path = require('path');
            }
            if (fs && path) {
                const osHome = typeof process !== 'undefined' ? (process.env.HOME || process.env.USERPROFILE || '') : '';
                basePath = osHome ? path.join(osHome, 'Downloads') : (typeof process !== 'undefined' && process.platform === 'win32' ? 'C:\\\\Downloads' : '/tmp');
            }
        } catch (e) {}
        return { fs, path, basePath };
    })();

    function writeDebugLog(msg, element = null) {
        if (!${enableDebug}) return;
        try {
            const timestamp = new Date().toISOString();
            let logMsg = \`[\${timestamp}] \${msg}\`;
            if (element) {
                logMsg += \` | Element path: \${getElementPath(element)}\`;
            }
            logMsg += '\\n';
            
            console.log("Antigravity Patch Debug:", logMsg.trim());
            if (typeof logBuffer !== 'undefined') logBuffer.push(logMsg);

            if (AntigravityFS.fs && AntigravityFS.path) {
                const logPath = AntigravityFS.path.join(AntigravityFS.basePath, 'antigravity-patch-debug.log');
                AntigravityFS.fs.appendFileSync(logPath, logMsg);
            }
        } catch (e) {
            console.error("Antigravity Patch Debug error:", e);
        }
    }

    function downloadFileBrowser(filename, content) {
        try {
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch(e) {
            console.error("Antigravity Browser Download Error:", e);
        }
    }

    // Diagnostic Key Tracker
    window.addEventListener('keydown', (e) => {
        if (!${enableDebug}) return;
        try {
            const target = e.target;
            const msg = \`[KEY TRACKER] Key: "\${e.key}" | Code: "\${e.code}" | KeyCode: \${e.keyCode} | Target: \${target ? target.tagName : 'none'} | Path: \${getElementPath(target)}\`;
            writeDebugLog(msg);
        } catch (err) {}
    }, true);

    ${enableDebug ? `
    function getElementPath(el) {
        if (!el) return 'unknown';
        let path = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            let selector = current.nodeName.toLowerCase();
            if (current.id) {
                selector += '#' + current.id;
                path.unshift(selector);
                break;
            } else {
                let sib = current, nth = 1;
                while (sib = sib.previousElementSibling) {
                    if (sib.nodeName.toLowerCase() == selector) nth++;
                }
                if (nth != 1) selector += ":nth-of-type(" + nth + ")";
            }
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\\s+/);
                if (classes.length > 0 && classes[0] !== '') {
                    selector += '.' + classes.join('.');
                }
            }
            path.unshift(selector);
            current = current.parentNode;
        }
        return path.join(' > ');
    }

    let logBuffer = [];

    // Add floating button for manual log download
    function createDebugButton() {
        if (document.getElementById('antigravity-debug-download-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'antigravity-debug-download-btn';
        btn.textContent = '📥 Download Debug Infos';
        btn.style.position = 'fixed';
        btn.style.bottom = '15%';
        btn.style.right = '20px';
        btn.style.zIndex = '999999';
        btn.style.padding = '8px 12px';
        btn.style.backgroundColor = '#d32f2f';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'pointer';
        btn.style.fontFamily = 'sans-serif';
        btn.style.fontSize = '12px';
        btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        
        btn.onclick = () => {
            writeDebugLog('Manual log download triggered via UI button.');
            
            // --- Diagnostic Checks ---
            try {
                const agentView = getAgentView();
                writeDebugLog('Diagnostic: Agent View found? ' + (agentView !== document ? 'Yes' : 'No (Fallback to document)'));
                
                const buttons = Array.from(agentView.querySelectorAll('button, a.monaco-button, div.monaco-button'));
                const sendBtn = buttons.find(b => /send/i.test(b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '')) || agentView.querySelector('[data-testid="send-button"]');
                writeDebugLog('Diagnostic: Send button found (manual)? ' + (sendBtn ? 'Yes' : 'No'));
                
                const inputField = agentView.querySelector('div[contenteditable="true"][data-lexical-editor="true"], textarea[placeholder*="Ask anything" i], input[placeholder*="Ask anything" i]');
                writeDebugLog('Diagnostic: Input field found? ' + (inputField ? 'Yes' : 'No'));
            } catch (err) {
                writeDebugLog('Diagnostic checks failed: ' + err.message);
            }
            // -------------------------

            const htmlContent = formatHTML(document.documentElement.outerHTML);
            const timestamp = Date.now();
            
            if (AntigravityFS.fs && AntigravityFS.path) {
                const dumpPath = AntigravityFS.path.join(AntigravityFS.basePath, 'antigravity-agent-view-dump-' + timestamp + '.html');
                AntigravityFS.fs.writeFileSync(dumpPath, htmlContent, 'utf8');
                writeDebugLog('HTML dump saved to ' + dumpPath);
            } else {
                downloadFileBrowser('antigravity-agent-view-dump-' + timestamp + '.html', htmlContent);
                downloadFileBrowser('antigravity-patch-debug-' + timestamp + '.log', logBuffer.join(''));
            }
        };
        
        document.body.appendChild(btn);
    }
    
    createDebugButton();
    function formatHTML(html) {
        let tab = '  ';
        let result = '';
        let indent = '';
        let raw = html.trim();
        if (raw.startsWith('<') && raw.endsWith('>')) {
            raw = raw.substring(1, raw.length - 1);
        }
        
        raw.split(/>\\s*</).forEach(function(element) {
            if (element.match(/^\\/\\w/)) {
                indent = indent.substring(tab.length);
            }
            result += indent + '<' + element + '>\\n';
            if (element.match(/^<?\\w[^>]*[^\\/]$/) && !element.startsWith("input") && !element.startsWith("img") && !element.startsWith("link") && !element.startsWith("meta") && !element.startsWith("br") && !element.startsWith("hr")) { 
                indent += tab;              
            }
        });
        return result.trim();
    }
    ` : `
    function writeDebugLog(msg, element = null) {
        // Debug mode disabled
    }
    function dumpHtml() {}
    `}

    /**
     * Robust method to locate the Agent View container to avoid clicking elements elsewhere.
     */
    function getAgentView() {
        let agentView = document.querySelector('.antigravity-agent-side-panel');

        if (!agentView) {
            agentView = document.getElementById('antigravity.agentViewContainerId');
        }

        if (!agentView) {
            const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
            if (inputBox) agentView = inputBox.closest('.monaco-pane-view, .pane, .split-view-view, .composite, .antigravity-agent-side-panel');
        }

        if (!agentView) {
            const agentHeader = document.querySelector('.pane-header[aria-label*="Agent" i], .title[aria-label*="Agent" i]');
            if (agentHeader) agentView = agentHeader.closest('.monaco-pane-view, .pane, .split-view-view, .composite, .antigravity-agent-side-panel');
        }
        
        if (!agentView) {
            const chatBg = document.querySelector('.bg-ide-chat-background');
            if (chatBg) agentView = chatBg.closest('.monaco-pane-view, .pane, .split-view-view, .composite, .antigravity-agent-side-panel') || chatBg.parentElement;
        }

        if (!agentView) {
            agentView = document;
        }
        
        return agentView;
    }

    ${includeContinue ? `
    /**
     * Helper to find buttons by title, aria-label, or text.
     */
    function findButtonByAttribute(searchText) {
        const agentView = getAgentView();
        const elements = Array.from(agentView.querySelectorAll('button, a.monaco-button, div.monaco-button'));
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
        const agentView = getAgentView();
        const input = agentView.querySelector(selector);
        if (input) {
            writeDebugLog(\`Setting input value "\${value}" for selector "\${selector}"\`, input);
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
        writeDebugLog('Starting recovery sequence due to "Running" hangup.');

        try {
            // 1. Click Cancel
            const cancelButton = findButtonByAttribute('Cancel');
            if (cancelButton) {
                console.log('Antigravity Auto-Retry: Clicking Cancel button.');
                writeDebugLog('Clicking Cancel button', cancelButton);
                cancelButton.click();
            }

            // 2. Wait 3 seconds
            await new Promise(r => setTimeout(r, 3000));

            // 3. Type "continue"
            const inputFound = setInputValue('div[contenteditable="true"][data-lexical-editor="true"], textarea[placeholder*="Ask anything" i], input[placeholder*="Ask anything" i]', 'continue');

            // 4. Wait 3 seconds
            await new Promise(r => setTimeout(r, 3000));

            // 5. Click Send
            const sendButton = findButtonByAttribute('Send') || getAgentView().querySelector('[data-testid="send-button"]');
            if (sendButton) {
                console.log('Antigravity Auto-Retry: Clicking Send button.');
                writeDebugLog('Clicking Send button', sendButton);
                sendButton.click();
            }

        } catch (e) {
            console.error('Antigravity Auto-Retry: Error during recovery sequence:', e);
            writeDebugLog(\`Error during recovery sequence: \${e.message}\`);
        } finally {
            writeDebugLog('Recovery sequence finished.');
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
                const agentView = getAgentView();
                const buttons = Array.from(agentView.querySelectorAll("button, a.monaco-button"));


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
                    writeDebugLog('Clicking Retry button', retryButton);
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
                    writeDebugLog('Clicking Allow button', allowButton);
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
                    writeDebugLog('Clicking Run button', runButton);
                    clickedButtons.add(runButton);
                    runButton.click();
                }
                ` : ''}

                ${includeContinue ? `
                // --- Part 4: "Running" monitoring logic (Auto Continue) ---
                if (!isHandlingSequence) {
                    const viewElement = agentView === document ? document.body : agentView;
                    const bodyText = viewElement.innerText || '';
                    const hasDots = /Running[.]{1,3}/.test(bodyText);
                    const hasPlain = bodyText.includes('Running');

                    if (hasDots) {
                        hasSeenDots = true;
                    }

                    if (hasDots || (hasSeenDots && hasPlain)) {
                        runningCounter++;
                        if (runningCounter === 1) {
                            writeDebugLog('Detected "Running" state. Starting counter.');
                        }
                        if (runningCounter >= 3000) { // 300 seconds
                            writeDebugLog('Running counter reached 3000. Triggering recovery.');
                            executeRecoverySequence();
                        }
                    } else {
                        if (runningCounter > 0) {
                            writeDebugLog(\`Running state cleared. Counter was at \${runningCounter}.\`);
                        }
                        runningCounter = 0;
                        hasSeenDots = false;
                    }
                }
                ` : ''}

                ${includeHideCorruption ? `
                // --- Part 5: Hide corruption warning ---
                const corruptionMsg = "Your Antigravity installation appears to be corrupt";
                const corruptionMsgGerman = "Ihre Antigravity-Installation scheint beschädigt zu sein.";
                const notifications = document.querySelectorAll('.notification-toast, .monaco-list-row, .notification-list-item');
                notifications.forEach(el => {
                    if (el.textContent.includes(corruptionMsg) || el.textContent.includes(corruptionMsgGerman)) {
                        el.style.display = 'none';
                        const toast = el.closest('.notification-toast-container');
                        if (toast && toast.style.display !== 'none') {
                            writeDebugLog('Hiding corruption warning toast', toast);
                            toast.style.display = 'none';
                        }
                    }
                });
                ` : ''}

                ${includeSshAutoLogin ? `
                // --- Part 6: Remote-SSH-Auto-Login logic ---
                const bakedPasswords = ${JSON.stringify(sshPasswords)};
                const sshTitleEl = Array.from(document.querySelectorAll('.quick-input-title')).find(el => {
                    const text = el.textContent.toLowerCase();
                    return text.includes('password:') || text.includes('passwort:');
                });
                
                if (sshTitleEl) {
                    const input = document.querySelector('.quick-input-box input[type="password"]');
                    if (input && !clickedButtons.has(input)) {
                        const titleText = sshTitleEl.textContent;
                        writeDebugLog(\`SSH Prompt detected: "\${titleText}"\`);
                        
                        const match = titleText.match(/(?:([^@]+)@)?([^']+)'s (?:password|passwort):/i);
                        
                        if (match) {
                            const sshUser = match[1] || '';
                            const sshHost = match[2] || '';
                            const fullHost = (sshUser ? sshUser + '@' : '') + sshHost;
                            
                            const b64 = bakedPasswords[fullHost] || bakedPasswords[sshHost] || bakedPasswords[sshUser];
                            if (b64) {
                                try {
                                    const password = atob(b64);
                                    writeDebugLog(\`Starting auto-login for \${sshHost}...\`);
                                    
                                    input.focus();
                                    input.select();
                                    document.execCommand('insertText', false, password);
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                    input.dispatchEvent(new Event('change', { bubbles: true }));
                                    
                                    clickedButtons.add(input);
                                                                     // New Approach: 1s stabilization, then wait for focus
                                    setTimeout(() => {
                                        writeDebugLog("Stabilization finished. Starting focus-watch...");
                                        
                                        let submissionTriggered = false;
                                        const checkFocusAndSubmit = () => {
                                            if (submissionTriggered) return;

                                            const windowFocused = document.hasFocus();
                                            const inputFocused = (document.activeElement === input);
                                            
                                            if (windowFocused && inputFocused) {
                                                submissionTriggered = true;
                                                writeDebugLog("Focus detected! Waiting 100ms safety delay before submission...");
                                                
                                                setTimeout(() => {
                                                    writeDebugLog("Safety delay finished. Sending Enter events...");
                                                    const createEvent = (code) => ({ 
                                                        key: 'Enter', code: code, keyCode: 13, which: 13, 
                                                        bubbles: true, cancelable: true, composed: true,
                                                        location: code === 'NumpadEnter' ? 3 : 0, view: window
                                                    });
                                                    
                                                    const targets = [input, input.parentElement, input.closest('.quick-input-widget'), window];
                                                    for (const target of targets) {
                                                        if (!target) continue;
                                                        target.dispatchEvent(new KeyboardEvent('keydown', createEvent('Enter')));
                                                        target.dispatchEvent(new KeyboardEvent('keydown', createEvent('NumpadEnter')));
                                                    }
                                                    writeDebugLog("Enter events broadcasted.");
                                                }, 100);
                                            } else {
                                                // Log every 2 seconds if still waiting
                                                if (!window._lastSshFocusLog || Date.now() - window._lastSshFocusLog > 2000) {
                                                    writeDebugLog("Still waiting for manual focus (Click back into Antigravity)...");
                                                    window._lastSshFocusLog = Date.now();
                                                }
                                            }
                                        };

                                        // Poll every 100ms for focus
                                        const focusPoll = setInterval(() => {
                                            if (submissionTriggered) {
                                                clearInterval(focusPoll);
                                            } else {
                                                checkFocusAndSubmit();
                                            }
                                        }, 100);

                                        // Also listen for focus event
                                        window.addEventListener('focus', checkFocusAndSubmit, { once: true });
                                    }, 1000);

                                } catch (e1) {
                                    writeDebugLog(\`Error during password insertion: \${e1.message}\`);
                                }
                            }
                        }
                    }
                }
                ` : ''}
            } catch (e) {
                console.error("Antigravity Auto-Retry loop error:", e);
                writeDebugLog(\`Auto-Retry loop error: \${e.message}\`);
            }
        }, 100);
    }
    startAutoRetry();
})();
</script>
<!-- Antigravity Auto-Retry Patch End -->
`;
}

/**
 * Detects the current state of features in the patched workbench.html.
 */
function detectCurrentState(workbenchPath) {
    const state = { ssh: false, corruption: false, debug: false };
    if (!workbenchPath || !fs.existsSync(workbenchPath)) return state;

    try {
        const content = fs.readFileSync(workbenchPath, 'utf8');
        const match = content.match(/PATCH_CONFIG: ({.*?}) -->/);
        if (match) {
            try {
                const config = JSON.parse(match[1]);
                state.ssh = !!config.ssh;
                state.corruption = !!config.corruption;
                state.debug = !!config.debug;
                return state;
            } catch (e) { }
        }

        // Fallback for older patches
        state.ssh = content.includes('Part 6: Remote-SSH-Auto-Login');
        state.corruption = content.includes('Part 5: Hide corruption warning');
        state.debug = content.includes('Diagnostic Key Tracker');
    } catch (e) { }
    return state;
}

async function getPatchChoice(workbenchPath) {
    const currentState = detectCurrentState(workbenchPath);

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
    console.log('10) Continue without patching');

    return new Promise((resolve) => {
        rl.question('\nSelect an option (1-10) or press Enter for all: ', (answer) => {
            let choice = 'all';
            switch (answer) {
                case '2': choice = 'retry_continue_allow'; break;
                case '3': choice = 'retry_allow'; break;
                case '4': choice = 'continue_allow'; break;
                case '5': choice = 'retry'; break;
                case '6': choice = 'continue'; break;
                case '7': choice = 'allow'; break;
                case '8': choice = 'run'; break;
                case '9':
                    rl.close();
                    return resolve({ choice: 'reset_all' });
                case '10': choice = 'skip_patching'; break;
                default: choice = 'all'; break;
            }

            const sshDefault = currentState.ssh ? 'y' : 'n';
            rl.question(`Would you like to enable "Remote-SSH-Auto-Login"? (y/n) [Default: ${sshDefault}]: `, async (sshAnswer) => {
                const sshAnswerLower = sshAnswer.toLowerCase().trim();
                const enableSshAutoLogin = sshAnswerLower ? sshAnswerLower.startsWith('y') : currentState.ssh;

                let sshPasswords = {};
                if (enableSshAutoLogin) {
                    // Only enter the menu if the user EXPLICITLY typed 'y'
                    // If they just pressed Enter and it was already active, just load existing
                    if (sshAnswerLower.startsWith('y')) {
                        sshPasswords = await promptForSshPasswords(rl);
                    } else {
                        sshPasswords = loadSavedPasswords();
                    }
                    ensureSettings();
                }

                const corruptionDefault = currentState.corruption ? 'y' : 'n';
                rl.question(`Would you also like to hide the "corrupt installation" warning message? (y/n) [Default: ${corruptionDefault}]: `, (hideAnswer) => {
                    const hideCorruption = hideAnswer ? hideAnswer.toLowerCase().startsWith('y') : currentState.corruption;

                    const debugDefault = currentState.debug ? 'y' : 'n';
                    rl.question(`Would you like to enable debug mode? (y/n) [Default: ${debugDefault}]: `, (debugAnswer) => {
                        rl.close();
                        const enableDebug = debugAnswer ? debugAnswer.toLowerCase().startsWith('y') : currentState.debug;
                        resolve({ choice, enableSshAutoLogin, sshPasswords, hideCorruption, enableDebug });
                    });
                });
            });
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

    const workbenchPath = getWorkbenchPath();
    const { choice, enableSshAutoLogin, sshPasswords, hideCorruption, enableDebug } = await getPatchChoice(workbenchPath);
    if (choice === 'reset_all') {
        log(`Selected mode: RESET ALL`);
    } else if (choice === 'skip_patching') {
        log(`Selected mode: SKIP PATCHING (Configuration only)`);
    } else {
        log(`Selected mode: ${choice.toUpperCase()}${enableSshAutoLogin ? ' + SSH AUTO-LOGIN (' + Object.keys(sshPasswords).length + ' hosts)' : ''}${hideCorruption ? ' + HIDE CORRUPTION WARNING' : ''}${enableDebug ? ' + DEBUG MODE' : ''}`);
    }

    if (choice === 'skip_patching') {
        log('------------------------------------------');
        log('Configuration session finished.');
        if (enableSshAutoLogin) {
            log('SSH passwords and terminal settings have been updated locally.');
        } else {
            log('No changes were made to local configurations.');
        }
        warn('NOTE: Option 10 does NOT modify your Antigravity installation.');
        warn('To remove or change existing patches, you must use options 1-9.');
        log('------------------------------------------');
        return;
    }

    if (!workbenchPath) {
        error('Could not find Antigravity installation path. Please ensure Antigravity is installed or check the script path definitions.');
        return;
    }

    const backupPath = workbenchPath + '.bak';
    let cleanHtml = '';
    //reset all
    try {
        if (choice === 'reset_all') {
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
        if (!isElevated()) error('You do not have sufficient privileges. Run the script again as administrator');
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
        const injectionScript = generateInjectionScript(choice, hideCorruption, enableDebug, enableSshAutoLogin, sshPasswords);

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
                const canWrite = () => {
                    try {
                        fs.accessSync(workbenchPath, fs.constants.W_OK);
                        // If backup exists, check if we can write to it too
                        if (fs.existsSync(backupPath)) {
                            fs.accessSync(backupPath, fs.constants.W_OK);
                        }
                        return true;
                    } catch (e) {
                        return false;
                    }
                };
                if (canWrite()) {
                    log('Running with sufficient privileges');
                    fs.writeFileSync(workbenchPath, html);
                    // Also ensure backup exists if it didn't before (and we have permission now)
                    if (!fs.existsSync(backupPath)) {
                        fs.writeFileSync(backupPath, cleanHtml);
                    }
                    log('File written successfully.');
                }
                else {
                    error('Insufficient privileges to modify the file. Please run this command prompt or terminal as Administrator.');
                    process.exit(1);
                }
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
