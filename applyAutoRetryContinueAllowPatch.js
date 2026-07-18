const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const os = require('os');

/**
 * Antigravity IDE Auto-Retry Patch Utility
 * This script injects a small JavaScript snippet into the Antigravity IDE workbench
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
        let settingsPath = path.join(appData, 'Antigravity IDE', 'User', 'settings.json');

        if (!fs.existsSync(settingsPath)) {
            const legacyPath = path.join(appData, 'Antigravity', 'User', 'settings.json');
            if (fs.existsSync(legacyPath)) {
                settingsPath = legacyPath;
            }
        }

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
    const folderPath = path.join(appData, 'Antigravity-IDE-Auto-Retry-Patch');

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
 * Migrates the password file from legacy storage or local directory to the system AppData folder if needed.
 */
function migratePasswords() {
    const localPath = path.join(__dirname, 'ssh_passwords.json');
    const systemPath = getPasswordFilePath();
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const legacySystemPath = path.join(appData, 'Antigravity-Auto-Retry-Patch', 'ssh_passwords.json');

    // 1. Migrate from old legacy system AppData path if it exists but the new one does not
    if (fs.existsSync(legacySystemPath) && !fs.existsSync(systemPath)) {
        try {
            fs.copyFileSync(legacySystemPath, systemPath);
            log(`Migrated passwords from legacy Antigravity patch storage to Antigravity IDE patch storage.`);
        } catch (e) {
            warn('Failed to migrate passwords from legacy AppData: ' + e.message);
        }
    }

    // 2. Migrate from local path to system path
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
function generateInjectionScript(choice, hideCorruption, enableDebug, enableSshAutoLogin, sshPasswords = {}, enableRestoreModel = false) {
    const patchRunId = 'patch_' + Date.now();
    const includeRetry = choice === 'all' || choice.includes('retry');
    const includeContinue = choice === 'all' || choice.includes('continue');
    const includeAllow = choice === 'all' || choice.includes('allow');
    const includeRun = choice === 'all' || choice.includes('run');
    const includeSubmit = choice === 'all' || choice.includes('submit');
    const includeHideCorruption = hideCorruption;
    const includeSshAutoLogin = enableSshAutoLogin;

    const configMetadata = {
        choice,
        ssh: enableSshAutoLogin,
        corruption: hideCorruption,
        debug: enableDebug,
        restoreModel: enableRestoreModel
    };

    return `
<!-- Antigravity IDE Auto-Retry Patch Start -->
<!-- PATCH_CONFIG: ${JSON.stringify(configMetadata)} -->
<script type="text/javascript">
(function() {
    console.log("Antigravity IDE Auto-Retry: Direct Injection successful.");

    // Reset button position if patch run ID changed
    const currentPatchId = "${patchRunId}";
    if (localStorage.getItem('antigravity-patch-run-id') !== currentPatchId) {
        localStorage.removeItem('antigravity-debug-btn-left');
        localStorage.removeItem('antigravity-debug-btn-top');
        localStorage.setItem('antigravity-patch-run-id', currentPatchId);
    }

    let intervalId = null;
    const clickedButtons = new WeakSet();
    ${includeContinue ? 'let runningCounter = 0;' : ''}
    ${includeContinue ? 'let hasSeenDots = false;' : ''}
    ${includeContinue ? 'let isHandlingSequence = false;' : ''}

    // AI Model Auto-Restore state
    const enableRestoreModel = ${enableRestoreModel};
    const savedModel = localStorage.getItem('antigravity-patched-last-model');
    let modelRestored = false;
    let openAttempts = 0;
    let lastActionTime = 0;
    let lastModelValue = '';

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
        try {
            const timestamp = new Date().toISOString();
            let logMsg = \`[\${timestamp}] \${msg}\`;
            if (element && typeof getElementPath !== 'undefined') {
                logMsg += \` | Element path: \${getElementPath(element)}\`;
            }
            logMsg += '\\n';
            
            console.log("Antigravity IDE Patch:", logMsg.trim());
            
            if (${enableDebug}) {
                if (typeof logBuffer !== 'undefined') logBuffer.push(logMsg);
                if (AntigravityFS.fs && AntigravityFS.path) {
                    const logPath = AntigravityFS.path.join(AntigravityFS.basePath, 'antigravity-patch-debug.log');
                    AntigravityFS.fs.appendFileSync(logPath, logMsg);
                }
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
            console.error("Antigravity IDE Browser Download Error:", e);
        }
    }

    function createSvgIcon(color) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', color);
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.setProperty('display', 'block', 'important');
        svg.style.setProperty('flex-shrink', '0', 'important');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'm12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z');
        svg.appendChild(path);
        return svg;
    }

    function createCloseIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '12');
        svg.setAttribute('height', '12');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.setProperty('display', 'block', 'important');
        svg.style.setProperty('flex-shrink', '0', 'important');
        
        const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line1.setAttribute('x1', '18');
        line1.setAttribute('y1', '6');
        line1.setAttribute('x2', '6');
        line1.setAttribute('y2', '18');
        svg.appendChild(line1);
        
        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', '6');
        line2.setAttribute('y1', '6');
        line2.setAttribute('x2', '18');
        line2.setAttribute('y2', '18');
        svg.appendChild(line2);
        
        return svg;
    }

    function createErrorIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', '#f38ba8');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.setProperty('display', 'block', 'important');
        svg.style.setProperty('flex-shrink', '0', 'important');
        
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '12');
        circle.setAttribute('cy', '12');
        circle.setAttribute('r', '10');
        svg.appendChild(circle);
        
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '12');
        line.setAttribute('y1', '8');
        line.setAttribute('x2', '12');
        line.setAttribute('y2', '12');
        svg.appendChild(line);
        
        const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line2.setAttribute('x1', '12');
        line2.setAttribute('y1', '16');
        line2.setAttribute('x2', '12.01');
        line2.setAttribute('y2', '16');
        svg.appendChild(line2);
        
        return svg;
    }

    function createSuccessIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', '#a6e3a1');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.style.setProperty('display', 'block', 'important');
        svg.style.setProperty('flex-shrink', '0', 'important');
        
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polyline.setAttribute('points', '20 6 9 17 4 12');
        svg.appendChild(polyline);
        
        return svg;
    }

    function getOrCreateToastContainer() {
        let container = document.getElementById('antigravity-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'antigravity-toast-container';
            container.style.setProperty('position', 'fixed', 'important');
            container.style.setProperty('top', '30px', 'important');
            container.style.setProperty('left', '50%', 'important');
            container.style.setProperty('transform', 'translateX(-50%)', 'important');
            container.style.setProperty('z-index', '1000000', 'important');
            container.style.setProperty('display', 'flex', 'important');
            container.style.setProperty('flex-direction', 'column', 'important');
            container.style.setProperty('align-items', 'center', 'important');
            container.style.setProperty('gap', '10px', 'important');
            container.style.setProperty('pointer-events', 'none', 'important');
            if (document.body) {
                document.body.appendChild(container);
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    if (!document.getElementById('antigravity-toast-container')) {
                        document.body.appendChild(container);
                    }
                });
            }
        }
        return container;
    }

    function showToast(messageOrModel, isModelRestore = true, iconColor = '#89b4fa', duration = 8000) {
        const createAndShow = () => {
            try {
                const container = getOrCreateToastContainer();
                const toast = document.createElement('div');
                toast.style.setProperty('pointer-events', 'auto', 'important');
                toast.style.setProperty('display', 'flex', 'important');
                toast.style.setProperty('align-items', 'center', 'important');
                toast.style.setProperty('gap', '12px', 'important');
                toast.style.setProperty('padding', '12px 18px', 'important');
                toast.style.setProperty('background', 'linear-gradient(135deg, #1e1e2e 0%, #11111b 100%)', 'important');
                toast.style.setProperty('border', '1px solid rgba(137, 180, 250, 0.2)', 'important');
                toast.style.setProperty('border-radius', '10px', 'important');
                toast.style.setProperty('color', '#cdd6f4', 'important');
                toast.style.setProperty('font-family', 'system-ui, -apple-system, sans-serif', 'important');
                toast.style.setProperty('font-size', '13px', 'important');
                toast.style.setProperty('font-weight', '500', 'important');
                toast.style.setProperty('line-height', '1.4', 'important');
                toast.style.setProperty('box-shadow', '0 8px 32px rgba(0, 0, 0, 0.4)', 'important');
                toast.style.setProperty('opacity', '0', 'important');
                toast.style.setProperty('transform', 'translateY(-20px)', 'important');
                toast.style.setProperty('transition', 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)', 'important');
                
                const icon = document.createElement('div');
                icon.style.setProperty('display', 'flex', 'important');
                icon.style.setProperty('align-items', 'center', 'important');
                icon.style.setProperty('justify-content', 'center', 'important');
                icon.appendChild(createSvgIcon(iconColor));
                toast.appendChild(icon);

                const text = document.createElement('div');
                text.style.setProperty('line-height', '1.4', 'important');
                text.style.setProperty('margin', '0', 'important');
                text.style.setProperty('padding', '0', 'important');
                let plainLogMessage = '';
                if (isModelRestore) {
                    text.appendChild(document.createTextNode('Antigravity IDE: Model restored to '));
                    const strong = document.createElement('strong');
                    strong.style.setProperty('color', '#89b4fa', 'important');
                    strong.textContent = messageOrModel;
                    text.appendChild(strong);
                    plainLogMessage = \`Antigravity IDE: Model restored to \${messageOrModel}\`;
                } else {
                    if (messageOrModel.includes('active')) {
                        text.appendChild(document.createTextNode('Antigravity IDE: Auto-Retry Patch '));
                        const strong = document.createElement('strong');
                        strong.style.setProperty('color', '#a6e3a1', 'important');
                        strong.textContent = 'active';
                        text.appendChild(strong);
                        plainLogMessage = 'Antigravity IDE: Auto-Retry Patch active';
                    } else {
                        text.textContent = messageOrModel;
                        plainLogMessage = messageOrModel;
                    }
                }
                toast.appendChild(text);

                const closeBtn = document.createElement('div');
                closeBtn.style.setProperty('display', 'flex', 'important');
                closeBtn.style.setProperty('align-items', 'center', 'important');
                closeBtn.style.setProperty('justify-content', 'center', 'important');
                closeBtn.style.setProperty('padding', '4px', 'important');
                closeBtn.style.setProperty('margin-left', '8px', 'important');
                closeBtn.style.setProperty('cursor', 'pointer', 'important');
                closeBtn.style.setProperty('border-radius', '50%', 'important');
                closeBtn.style.setProperty('color', '#a6adc8', 'important');
                closeBtn.style.setProperty('transition', 'background 0.2s, color 0.2s', 'important');
                
                closeBtn.addEventListener('mouseenter', () => {
                    closeBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.1)', 'important');
                    closeBtn.style.setProperty('color', '#cdd6f4', 'important');
                });
                closeBtn.addEventListener('mouseleave', () => {
                    closeBtn.style.setProperty('background', 'transparent', 'important');
                    closeBtn.style.setProperty('color', '#a6adc8', 'important');
                });

                closeBtn.appendChild(createCloseIcon());

                const dismissToast = () => {
                    toast.style.setProperty('opacity', '0', 'important');
                    toast.style.setProperty('transform', 'translateY(-20px)', 'important');
                    writeDebugLog(\`Dismissed toast: "\${plainLogMessage}"\`);
                    setTimeout(() => { toast.remove(); }, 400);
                };

                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dismissToast();
                });
                toast.appendChild(closeBtn);

                container.appendChild(toast);

                writeDebugLog(\`Displaying toast: "\${plainLogMessage}" (Duration: \${duration}ms)\`);

                requestAnimationFrame(() => {
                    toast.style.setProperty('opacity', '1', 'important');
                    toast.style.setProperty('transform', 'translateY(0)', 'important');
                });

                setTimeout(() => {
                    if (toast.parentNode) {
                        dismissToast();
                    }
                }, duration);
            } catch (err) {
                console.error("Toast notification error:", err);
            }
        };

        if (document.body) {
            createAndShow();
        } else {
            document.addEventListener('DOMContentLoaded', createAndShow);
        }
    }

    function showErrorToast(err) {
        if (!${enableDebug}) return;
        try {
            let message = '';
            let stack = '';
            
            const serializeError = (val) => {
                let msg = '';
                let stk = '';
                if (val && typeof val === 'object') {
                    if (typeof Event !== 'undefined' && val instanceof Event) {
                        msg = \`Event [type: \${val.type}]\`;
                        if (val.message) {
                            msg += \`: \${val.message}\`;
                        }
                        
                        let targetInfo = '';
                        try {
                            if (val.target) {
                                if (val.target.outerHTML) {
                                    targetInfo = val.target.outerHTML.substring(0, 200);
                                } else if (val.target.tagName) {
                                    targetInfo = '<' + val.target.tagName.toLowerCase() + '>';
                                } else {
                                    targetInfo = String(val.target);
                                }
                            }
                        } catch (e) {
                            targetInfo = '[Unable to access target]';
                        }
                        
                        let currentTargetInfo = '';
                        try {
                            if (val.currentTarget) {
                                if (val.currentTarget.outerHTML) {
                                    currentTargetInfo = val.currentTarget.outerHTML.substring(0, 200);
                                } else if (val.currentTarget.tagName) {
                                    currentTargetInfo = '<' + val.currentTarget.tagName.toLowerCase() + '>';
                                } else {
                                    currentTargetInfo = String(val.currentTarget);
                                }
                            }
                        } catch (e) {
                            currentTargetInfo = '[Unable to access currentTarget]';
                        }
                        
                        stk = 'Event details:\\n' +
                              'Type: ' + val.type + '\\n' +
                              'Target: ' + targetInfo + '\\n' +
                              'CurrentTarget: ' + currentTargetInfo + '\\n' +
                              'Bubbles: ' + val.bubbles + '\\n' +
                              'Cancelable: ' + val.cancelable + '\\n' +
                              'TimeStamp: ' + val.timeStamp;
                                
                        if (val.message) {
                            stk += '\\nMessage: ' + val.message;
                        }
                        if (val.filename) {
                            stk += '\\nSource: ' + val.filename + ':' + val.lineno + ':' + val.colno;
                        }
                        if (val.error) {
                            const underlying = serializeError(val.error);
                            stk += '\\n\\nUnderlying error:\\n' + underlying.stack;
                        }
                        if (val.reason) {
                            const underlying = serializeError(val.reason);
                            stk += '\\n\\nRejection reason:\\n' + underlying.stack;
                        }
                    } else {
                        msg = val.message || String(val);
                        stk = val.stack || msg;
                        
                        if (msg === '[object Object]') {
                            try {
                                msg = JSON.stringify(val);
                            } catch (e) {
                                try {
                                    msg = 'Object keys: ' + Object.keys(val).join(', ');
                                } catch (e2) {}
                            }
                        }
                        if (stk === '[object Object]') {
                            try {
                                stk = JSON.stringify(val, null, 2);
                            } catch (e) {
                                try {
                                    stk = 'Object details:\\n' + Object.keys(val).map(k => k + ': ' + val[k]).join('\\n');
                                } catch (e2) {}
                            }
                        }
                    }
                } else {
                    msg = String(val);
                    stk = msg;
                }
                return { message: msg, stack: stk };
            };

            const serialized = serializeError(err);
            message = serialized.message;
            stack = serialized.stack;

            if (message && (message.includes('ResizeObserver') || message === 'Canceled' || message === 'canceled')) {
                return;
            }
            
            const shortMessage = message.length > 120 ? message.substring(0, 117) + '...' : message;
            
            const container = getOrCreateToastContainer();
            const toast = document.createElement('div');
            toast.style.setProperty('pointer-events', 'auto', 'important');
            toast.style.setProperty('display', 'flex', 'important');
            toast.style.setProperty('align-items', 'center', 'important');
            toast.style.setProperty('gap', '12px', 'important');
            toast.style.setProperty('padding', '12px 18px', 'important');
            toast.style.setProperty('background', 'linear-gradient(135deg, #1e1e2e 0%, #11111b 100%)', 'important');
            toast.style.setProperty('border', '1px solid rgba(243, 139, 168, 0.3)', 'important');
            toast.style.setProperty('border-radius', '10px', 'important');
            toast.style.setProperty('color', '#cdd6f4', 'important');
            toast.style.setProperty('font-family', 'system-ui, -apple-system, sans-serif', 'important');
            toast.style.setProperty('font-size', '13px', 'important');
            toast.style.setProperty('font-weight', '500', 'important');
            toast.style.setProperty('line-height', '1.4', 'important');
            toast.style.setProperty('box-shadow', '0 8px 32px rgba(0, 0, 0, 0.4)', 'important');
            toast.style.setProperty('opacity', '0', 'important');
            toast.style.setProperty('transform', 'translateY(-20px)', 'important');
            toast.style.setProperty('transition', 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)', 'important');
            toast.style.setProperty('cursor', 'pointer', 'important');

            const icon = document.createElement('div');
            icon.style.setProperty('display', 'flex', 'important');
            icon.style.setProperty('align-items', 'center', 'important');
            icon.style.setProperty('justify-content', 'center', 'important');
            icon.appendChild(createErrorIcon());
            toast.appendChild(icon);

            const text = document.createElement('div');
            text.style.setProperty('line-height', '1.4', 'important');
            text.style.setProperty('margin', '0', 'important');
            text.style.setProperty('padding', '0', 'important');
            const strong = document.createElement('strong');
            strong.textContent = 'Antigravity Patch Error: ';
            text.appendChild(strong);
            
            const span1 = document.createElement('span');
            span1.style.color = '#f38ba8';
            span1.textContent = shortMessage;
            text.appendChild(span1);
            
            text.appendChild(document.createElement('br'));
            
            const span2 = document.createElement('span');
            span2.style.fontSize = '11px';
            span2.style.color = '#a6adc8';
            span2.textContent = 'Click to copy stack trace';
            text.appendChild(span2);

            toast.appendChild(text);

            const closeBtn = document.createElement('div');
            closeBtn.style.setProperty('display', 'flex', 'important');
            closeBtn.style.setProperty('align-items', 'center', 'important');
            closeBtn.style.setProperty('justify-content', 'center', 'important');
            closeBtn.style.setProperty('padding', '4px', 'important');
            closeBtn.style.setProperty('margin-left', '8px', 'important');
            closeBtn.style.setProperty('cursor', 'pointer', 'important');
            closeBtn.style.setProperty('border-radius', '50%', 'important');
            closeBtn.style.setProperty('color', '#a6adc8', 'important');
            closeBtn.style.setProperty('transition', 'background 0.2s, color 0.2s', 'important');
            
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.1)', 'important');
                closeBtn.style.setProperty('color', '#cdd6f4', 'important');
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.setProperty('background', 'transparent', 'important');
                closeBtn.style.setProperty('color', '#a6adc8', 'important');
            });

            closeBtn.appendChild(createCloseIcon());

            const dismissToast = () => {
                toast.style.setProperty('opacity', '0', 'important');
                toast.style.setProperty('transform', 'translateY(-20px)', 'important');
                writeDebugLog(\`Dismissed error toast: "\${shortMessage}"\`);
                setTimeout(() => { toast.remove(); }, 400);
            };

            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                dismissToast();
            });
            toast.appendChild(closeBtn);

            let copied = false;
            toast.addEventListener('click', () => {
                if (copied) return;
                copied = true;
                
                const copyText = \`Antigravity IDE Patch Error:\\nMessage: \${message}\\nStack trace:\\n\${stack}\`;
                const tryFallbackCopy = () => {
                    const textarea = document.createElement('textarea');
                    textarea.value = copyText;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    let success = false;
                    try { 
                        success = document.execCommand('copy'); 
                    } catch (e) {}
                    document.body.removeChild(textarea);
                    return success;
                };

                const finishCopy = (success = true) => {
                    text.textContent = '';
                    const strongCopied = document.createElement('strong');
                    strongCopied.textContent = success ? 'Copied to clipboard!' : 'Failed to copy!';
                    text.appendChild(strongCopied);

                    icon.textContent = '';
                    icon.appendChild(createSuccessIcon());
                    toast.style.border = '1px solid rgba(166, 227, 161, 0.4)';

                    writeDebugLog(success ? 'Error stack trace copied to clipboard.' : 'Failed to copy stack trace to clipboard.');

                    setTimeout(() => {
                        dismissToast();
                    }, 1000);
                };

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(copyText)
                        .then(() => finishCopy(true))
                        .catch((err) => {
                            writeDebugLog(\`navigator.clipboard.writeText failed: \${err.message}. Trying fallback...\`);
                            const fallbackSuccess = tryFallbackCopy();
                            finishCopy(fallbackSuccess);
                        });
                } else {
                    const fallbackSuccess = tryFallbackCopy();
                    finishCopy(fallbackSuccess);
                }
            });

            container.appendChild(toast);

            writeDebugLog(\`Displaying error toast: "\${message}"\\nStack trace:\\n\${stack}\`);

            requestAnimationFrame(() => {
                toast.style.setProperty('opacity', '1', 'important');
                toast.style.setProperty('transform', 'translateY(0)', 'important');
            });

            setTimeout(() => {
                if (!copied && toast.parentNode) {
                    dismissToast();
                }
            }, 10000);
        } catch (e) {
            console.error("Error showing error toast:", e);
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
        btn.style.zIndex = '999999';
        btn.style.webkitAppRegion = 'no-drag';
        btn.style.padding = '3px 12px';
        btn.style.backgroundColor = '#d32f2f';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.style.cursor = 'grab';
        btn.style.fontFamily = 'sans-serif';
        btn.style.fontSize = '12px';
        btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        
        // Restore position from localStorage if exists
        const savedLeft = localStorage.getItem('antigravity-debug-btn-left');
        const savedTop = localStorage.getItem('antigravity-debug-btn-top');
        if (savedLeft && savedTop) {
            btn.style.left = savedLeft;
            btn.style.top = savedTop;
            btn.style.bottom = 'auto';
            btn.style.right = 'auto';
        } else {
            btn.style.left = '50%';
            btn.style.bottom = '0px';
            btn.style.transform = 'translateX(-50%)';
            btn.style.top = 'auto';
            btn.style.right = 'auto';
        }

        // Drag and drop implementation using pointer events
        let blockClick = false;

        btn.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            
            const rect = btn.getBoundingClientRect();
            const startX = e.clientX;
            const startY = e.clientY;
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;

            let isDragging = false;
            btn.style.cursor = 'grabbing';

            const onPointerMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;

                if (!isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                    isDragging = true;
                    btn.style.transform = 'none';
                }

                if (isDragging) {
                    let newLeft = moveEvent.clientX - offsetX;
                    let newTop = moveEvent.clientY - offsetY;

                    const maxLeft = window.innerWidth - rect.width;
                    const maxTop = window.innerHeight - rect.height;

                    newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                    newTop = Math.max(0, Math.min(newTop, maxTop));

                    btn.style.left = newLeft + 'px';
                    btn.style.top = newTop + 'px';
                    btn.style.bottom = 'auto';
                    btn.style.right = 'auto';
                }
            };

            const onPointerUp = (upEvent) => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', onPointerUp);
                btn.style.cursor = 'grab';

                if (isDragging) {
                    blockClick = true;
                    setTimeout(() => { blockClick = false; }, 100);
                    localStorage.setItem('antigravity-debug-btn-left', btn.style.left);
                    localStorage.setItem('antigravity-debug-btn-top', btn.style.top);
                }
            };

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        });

        // Trigger manual download only on non-dragged click
        btn.addEventListener('click', (e) => {
            if (blockClick) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            
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
        });
        
        document.body.appendChild(btn);

        window.addEventListener('resize', () => {
            const rect = btn.getBoundingClientRect();
            if (btn.style.left.endsWith('%')) return;
            let currentLeft = parseFloat(btn.style.left);
            let currentTop = parseFloat(btn.style.top);
            if (!isNaN(currentLeft) && !isNaN(currentTop)) {
                const maxLeft = window.innerWidth - rect.width;
                const maxTop = window.innerHeight - rect.height;
                const newLeft = Math.max(0, Math.min(currentLeft, maxLeft));
                const newTop = Math.max(0, Math.min(currentTop, maxTop));
                btn.style.left = newLeft + 'px';
                btn.style.top = newTop + 'px';
            }
        });

        requestAnimationFrame(() => {
            const rect = btn.getBoundingClientRect();
            if (btn.style.left.endsWith('%')) return;
            let currentLeft = parseFloat(btn.style.left);
            let currentTop = parseFloat(btn.style.top);
            if (!isNaN(currentLeft) && !isNaN(currentTop)) {
                const maxLeft = window.innerWidth - rect.width;
                const maxTop = window.innerHeight - rect.height;
                const newLeft = Math.max(0, Math.min(currentLeft, maxLeft));
                const newTop = Math.max(0, Math.min(currentTop, maxTop));
                btn.style.left = newLeft + 'px';
                btn.style.top = newTop + 'px';
            }
        });
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
        
        console.log('Antigravity IDE Auto-Retry: "Running" state detected for > 30s. Executing recovery...');
        writeDebugLog('Starting recovery sequence due to "Running" hangup.');

        try {
            // 1. Click Cancel
            const cancelButton = findButtonByAttribute('Cancel');
            if (cancelButton) {
                console.log('Antigravity IDE Auto-Retry: Clicking Cancel button.');
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
                console.log('Antigravity IDE Auto-Retry: Clicking Send button.');
                writeDebugLog('Clicking Send button', sendButton);
                sendButton.click();
            }

        } catch (e) {
            console.error('Antigravity IDE Auto-Retry: Error during recovery sequence:', e);
            writeDebugLog(\`Error during recovery sequence: \${e.message}\`);
            showErrorToast(e);
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
                    console.log("Antigravity IDE Auto-Retry: Found Retry button. Clicking...");
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
                    console.log("Antigravity IDE Auto-Retry: Found Allow button. Clicking...");
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
                    console.log("Antigravity IDE Auto-Retry: Found Run button. Clicking...");
                    writeDebugLog('Clicking Run button', runButton);
                    clickedButtons.add(runButton);
                    runButton.click();
                }
                ` : ''}

                ${includeSubmit ? `
                // --- Part 3b: Auto Submit logic ---
                const submitButton = buttons.find(button => {
                    const text = (button.textContent || "").toLowerCase();
                    return (text.includes("submit") || 
                           text.includes("absenden") || 
                           text.includes("übermitteln")) && !clickedButtons.has(button);
                });
                if (submitButton && !(submitButton.disabled)) {
                    console.log("Antigravity IDE Auto-Retry: Found Submit button. Clicking...");
                    writeDebugLog('Clicking Submit button', submitButton);
                    clickedButtons.add(submitButton);
                    submitButton.click();
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
                const notifications = document.querySelectorAll('.notification-toast, .monaco-list-row, .notification-list-item');
                notifications.forEach(el => {
                    const text = el.textContent || "";
                    const lowerText = text.toLowerCase();
                    const isCorruptMsg = lowerText.includes("antigravity") && 
                                        (lowerText.includes("corrupt") || 
                                         lowerText.includes("beschädigt") || 
                                         lowerText.includes("reinstall") || 
                                         lowerText.includes("neu installieren"));
                    if (isCorruptMsg) {
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
                                                    writeDebugLog("Still waiting for manual focus (Click back into Antigravity IDE)...");
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
                                    showErrorToast(e1);
                                }
                            }
                        }
                    }
                }
                ` : ''}

                // --- Part 7: Auto-Restore Last Selected AI Model ---
                if (enableRestoreModel) {
                    const modelBtn = getAgentView().querySelector('button[aria-label*="Select model" i]');
                    if (modelBtn) {
                        let currentModel = '';
                        const ariaLabel = modelBtn.getAttribute('aria-label') || '';
                        const match = ariaLabel.match(/current:\s*(.+)$/i);
                        if (match) {
                            currentModel = match[1].trim();
                        } else {
                            currentModel = modelBtn.textContent.trim();
                        }

                        if (currentModel) {
                            // 1. Detect manual changes
                            if (modelRestored && currentModel !== lastModelValue) {
                                console.log("Antigravity IDE Auto-Retry: Model changed from " + lastModelValue + " to " + currentModel + ". Saving to localStorage.");
                                writeDebugLog("Model changed from " + lastModelValue + " to " + currentModel + ". Saving to localStorage.");
                                localStorage.setItem('antigravity-patched-last-model', currentModel);
                                lastModelValue = currentModel;
                            }

                            // 2. Restore model
                            if (!modelRestored && savedModel) {
                                if (currentModel === savedModel) {
                                    console.log("Antigravity IDE Auto-Retry: Model is already " + savedModel + ". Restore complete.");
                                    writeDebugLog("Model is already " + savedModel + ". Restore complete.");
                                    modelRestored = true;
                                    lastModelValue = currentModel;
                                    showToast(savedModel);
                                } else {
                                    const now = Date.now();
                                    const parentDiv = modelBtn.closest('[aria-haspopup="dialog"]');
                                    const isDropdownOpen = parentDiv && parentDiv.getAttribute('aria-expanded') === 'true';

                                    if (!isDropdownOpen) {
                                        if (now - lastActionTime > 2000) {
                                            console.log("Antigravity IDE Auto-Retry: Opening model dropdown to restore: " + savedModel);
                                            writeDebugLog("Clicking model button to open dropdown for restore");
                                            modelBtn.click();
                                            lastActionTime = now;
                                            openAttempts++;
                                        }
                                    } else {
                                        const interactiveElements = Array.from(document.querySelectorAll('button, [role="menuitem"], [role="option"], .setting-dropdown-option, [class*="option" i], [class*="item" i]'));
                                        const targetOption = interactiveElements.find(el => {
                                            const cleanText = el.textContent.trim().replace(/\s+/g, ' ');
                                            return cleanText.includes(savedModel) && cleanText.length < savedModel.length + 15;
                                        });

                                        if (targetOption) {
                                            console.log("Antigravity IDE Auto-Retry: Found target model option. Clicking: " + savedModel);
                                            writeDebugLog("Clicking target model option", targetOption);
                                            targetOption.click();
                                            modelRestored = true;
                                            lastModelValue = savedModel;
                                            lastActionTime = now;
                                            showToast(savedModel);
                                        } else {
                                            if (now - lastActionTime > 1000) {
                                                console.log("Antigravity IDE Auto-Retry: Model option not found in dropdown. Closing dropdown to retry later.");
                                                writeDebugLog("Closing dropdown since option was not found");
                                                modelBtn.click();
                                                lastActionTime = now;
                                                if (openAttempts >= 3) {
                                                    console.log("Antigravity IDE Auto-Retry: Target model " + savedModel + " not available after 3 attempts. Giving up.");
                                                    writeDebugLog("Target model " + savedModel + " not available after 3 attempts. Giving up.");
                                                    modelRestored = true;
                                                    lastModelValue = currentModel;
                                                }
                                            }
                                        }
                                    }
                                }
                            } else if (!modelRestored && !savedModel) {
                                modelRestored = true;
                                lastModelValue = currentModel;
                                console.log("Antigravity IDE Auto-Retry: No saved model. Initialized with current: " + currentModel);
                                writeDebugLog("No saved model. Initialized with current: " + currentModel);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Antigravity IDE Auto-Retry loop error:", e);
                writeDebugLog(\`Auto-Retry loop error: \${e.message}\`);
                showErrorToast(e);
            }
        }, 100);
    }
    startAutoRetry();
    showToast('Antigravity IDE: Auto-Retry Patch <strong style="color: #a6e3a1">active</strong>', false, '#a6e3a1', 8000);

    window.addEventListener('error', (event) => {
        try {
            const err = event.error || { message: event.message, stack: (event.filename || 'unknown') + ':' + (event.lineno || 0) + ':' + (event.colno || 0) };
            showErrorToast(err);
        } catch (e) {}
    });

    window.addEventListener('unhandledrejection', (event) => {
        try {
            const err = event.reason || { message: 'Unhandled Promise Rejection' };
            showErrorToast(err);
        } catch (e) {}
    });
})();
</script>
<!-- Antigravity IDE Auto-Retry Patch End -->
`;
}

/**
 * Detects the current state of features in the patched workbench.html.
 */
function detectCurrentState(workbenchPath) {
    const state = { ssh: false, corruption: false, debug: false, restoreModel: false };
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
                state.restoreModel = !!config.restoreModel;
                return state;
            } catch (e) { }
        }

        // Fallback for older patches
        state.ssh = content.includes('Part 6: Remote-SSH-Auto-Login');
        state.corruption = content.includes('Part 5: Hide corruption warning');
        state.debug = content.includes('Diagnostic Key Tracker');
        state.restoreModel = content.includes('Part 7: Auto-Restore Last Selected AI Model');
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
    console.log('1) All (Retry + Continue + Allow + Run + Submit) \x1b[90m[Default]\x1b[0m');
    console.log('2) Retry + Continue + Allow + Submit');
    console.log('3) Retry + Allow + Submit');
    console.log('4) Continue + Allow + Submit');
    console.log('5) Only Retry');
    console.log('6) Only Continue');
    console.log('7) Only Allow');
    console.log('8) Only Run');
    console.log('9) Only Submit');
    console.log('10) Reset all');
    console.log('11) Continue without patching');

    return new Promise((resolve) => {
        rl.question('\nSelect an option (1-11) or press Enter for all: ', (answer) => {
            let choice = 'all';
            switch (answer) {
                case '2': choice = 'retry_continue_allow_submit'; break;
                case '3': choice = 'retry_allow_submit'; break;
                case '4': choice = 'continue_allow_submit'; break;
                case '5': choice = 'retry'; break;
                case '6': choice = 'continue'; break;
                case '7': choice = 'allow'; break;
                case '8': choice = 'run'; break;
                case '9': choice = 'submit'; break;
                case '10':
                    rl.close();
                    return resolve({ choice: 'reset_all' });
                case '11': choice = 'skip_patching'; break;
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

                    const restoreModelDefault = currentState.restoreModel ? 'y' : 'n';
                    rl.question(`Would you like to enable "Auto-Restore-Last-AI-Model"? (y/n) [Default: ${restoreModelDefault}]: `, (restoreAnswer) => {
                        const enableRestoreModel = restoreAnswer ? restoreAnswer.toLowerCase().startsWith('y') : currentState.restoreModel;

                        const debugDefault = currentState.debug ? 'y' : 'n';
                        rl.question(`Would you like to enable debug mode? (y/n) [Default: ${debugDefault}]: `, (debugAnswer) => {
                            rl.close();
                            const enableDebug = debugAnswer ? debugAnswer.toLowerCase().startsWith('y') : currentState.debug;
                            resolve({ choice, enableSshAutoLogin, sshPasswords, hideCorruption, enableRestoreModel, enableDebug });
                        });
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
        possiblePaths.push(path.join('/usr', 'share', 'antigravity-ide', relativeWorkbenchPath));
        possiblePaths.push(path.join('/usr', 'share', 'antigravity', relativeWorkbenchPath));
        possiblePaths.push(path.join('/opt', 'antigravity-ide', relativeWorkbenchPath));
        possiblePaths.push(path.join('/opt', 'antigravity', relativeWorkbenchPath));
    } else if (process.platform === 'win32') {
        if (process.env.LOCALAPPDATA) {
            possiblePaths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity IDE', relativeWorkbenchPath));
            possiblePaths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', relativeWorkbenchPath));
        }
        if (process.env.ProgramFiles) {
            possiblePaths.push(path.join(process.env.ProgramFiles, 'Antigravity IDE', relativeWorkbenchPath));
            possiblePaths.push(path.join(process.env.ProgramFiles, 'Antigravity', relativeWorkbenchPath));
        }
        if (process.env['ProgramFiles(x86)']) {
            possiblePaths.push(path.join(process.env['ProgramFiles(x86)'], 'Antigravity IDE', relativeWorkbenchPath));
            possiblePaths.push(path.join(process.env['ProgramFiles(x86)'], 'Antigravity', relativeWorkbenchPath));
        }
    } else if (process.platform === 'darwin') {
        possiblePaths.push(path.join('/Applications', 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'));
        possiblePaths.push(path.join('/Applications', 'Antigravity.app', 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'));
    }

    log(`Searching for Antigravity IDE installation on ${process.platform}...`);
    for (const p of possiblePaths) {
        log(`Checking: ${p}`);
        if (fs.existsSync(p)) {
            log(`Found workbench.html at: ${p}`);
            return p;
        }
    }

    return null;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let customPath = null;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--path' || arg === '-p') {
            if (i + 1 < args.length) {
                customPath = args[i + 1];
                i++;
            }
        } else if (!arg.startsWith('-')) {
            customPath = arg;
        }
    }
    return { customPath };
}

function resolveManualPath(inputPath) {
    if (!inputPath) return null;
    const cleaned = inputPath.trim().replace(/^['"]|['"]$/g, ''); // remove quotes if any
    
    // Check if the path itself is workbench.html
    if (fs.existsSync(cleaned)) {
        const stat = fs.statSync(cleaned);
        if (stat.isFile() && path.basename(cleaned).toLowerCase() === 'workbench.html') {
            return cleaned;
        }
    }
    
    // Check if the path is a directory containing workbench.html
    const directPath = path.join(cleaned, 'workbench.html');
    if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
        return directPath;
    }

    // Check standard subpaths relative to the installation directory
    const relativeWorkbenchPath = path.join('resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
    const winLinuxPath = path.join(cleaned, relativeWorkbenchPath);
    if (fs.existsSync(winLinuxPath) && fs.statSync(winLinuxPath).isFile()) {
        return winLinuxPath;
    }

    const macPath = path.join(cleaned, 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
    if (fs.existsSync(macPath) && fs.statSync(macPath).isFile()) {
        return macPath;
    }
    
    const macAppPath = path.join(cleaned, 'Antigravity IDE.app', 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
    if (fs.existsSync(macAppPath) && fs.statSync(macAppPath).isFile()) {
        return macAppPath;
    }

    const macAppPathLegacy = path.join(cleaned, 'Antigravity.app', 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
    if (fs.existsSync(macAppPathLegacy) && fs.statSync(macAppPathLegacy).isFile()) {
        return macAppPathLegacy;
    }

    return null;
}

async function getInteractiveWorkbenchPath() {
    let workbenchPath = getWorkbenchPath();
    if (workbenchPath) {
        return workbenchPath;
    }

    warn('Could not find Antigravity IDE installation path automatically.');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    try {
        while (true) {
            const answer = await new Promise((resolve) => {
                rl.question('\nPlease enter the manual path to your Antigravity IDE installation directory (or workbench.html), or press Enter to cancel: ', resolve);
            });
            
            const trimmed = answer.trim();
            if (!trimmed) {
                break;
            }

            const resolved = resolveManualPath(trimmed);
            if (resolved) {
                log(`Successfully resolved manual path to: ${resolved}`);
                return resolved;
            } else {
                error(`Invalid installation path. Could not find workbench.html inside: ${trimmed}`);
            }
        }
    } finally {
        rl.close();
    }
    
    return null;
}

async function applyPatch() {
    log('--- Antigravity IDE Retry Patch Utility ---');

    const args = parseArgs();
    let workbenchPath = null;

    if (args.customPath) {
        log(`Using custom path from command line arguments: ${args.customPath}`);
        workbenchPath = resolveManualPath(args.customPath);
        if (!workbenchPath) {
            error(`The specified manual path is invalid or does not contain workbench.html: ${args.customPath}`);
            process.exit(1);
        }
    } else {
        workbenchPath = await getInteractiveWorkbenchPath();
    }

    if (!workbenchPath) {
        error('Could not find Antigravity IDE installation path. Please ensure Antigravity IDE is installed or check the script path definitions.');
        process.exit(1);
    }

    const { choice, enableSshAutoLogin, sshPasswords, hideCorruption, enableRestoreModel, enableDebug } = await getPatchChoice(workbenchPath);
    if (choice === 'reset_all') {
        log(`Selected mode: RESET ALL`);
    } else if (choice === 'skip_patching') {
        log(`Selected mode: SKIP PATCHING (Configuration only)`);
    } else {
        log(`Selected mode: ${choice.toUpperCase()}${enableSshAutoLogin ? ' + SSH AUTO-LOGIN (' + Object.keys(sshPasswords).length + ' hosts)' : ''}${hideCorruption ? ' + HIDE CORRUPTION WARNING' : ''}${enableRestoreModel ? ' + AUTO-RESTORE LAST MODEL' : ''}${enableDebug ? ' + DEBUG MODE' : ''}`);
    }

    if (choice === 'skip_patching') {
        log('------------------------------------------');
        log('Configuration session finished.');
        if (enableSshAutoLogin) {
            log('SSH passwords and terminal settings have been updated locally.');
        } else {
            log('No changes were made to local configurations.');
        }
        warn('NOTE: Option 11 does NOT modify your Antigravity IDE installation.');
        warn('To remove or change existing patches, you must use options 1-10.');
        log('------------------------------------------');
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
                log('Please restart Antigravity IDE to see the changes.');
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
            if (cleanHtml.includes('Antigravity Auto-Retry Patch') || cleanHtml.includes('Antigravity IDE Auto-Retry Patch')) {
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
        const injectionScript = generateInjectionScript(choice, hideCorruption, enableDebug, enableSshAutoLogin, sshPasswords, enableRestoreModel);

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
        log('Please restart Antigravity IDE to see the changes.');
        log('------------------------------------------');

    } catch (err) {
        error(`An error occurred during the patching process: ${err.message}`);
    }
}

applyPatch();
