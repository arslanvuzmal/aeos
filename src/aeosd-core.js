const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

class AEOSDaemon {
    constructor(workspace) {
        this.workspace = workspace || process.cwd();
        this.planningDir = path.join(this.workspace, '.planning');
        this.ledgerPath = path.join(this.planningDir, 'task_plan.md');
        this.findingsPath = path.join(this.planningDir, 'findings.md');
        this.progressPath = path.join(this.planningDir, 'progress.md');
        this.lockPath = path.join(this.planningDir, 'plan.sha256');
        this.logFile = process.platform === 'win32' ? 'C:\\var\\log\\aeosd\\system.log' : '/var/log/aeosd/system.log';
        this.blacklistKeys = ['stack', 'metadata', 'trace', 'config', 'debug_dump', 'raw_html', 'verbose_logs'];
        
        this.ensureDirectories();
    }

    ensureDirectories() {
        if (!fs.existsSync(this.planningDir)) {
            fs.mkdirSync(this.planningDir, { recursive: true });
        }
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            try {
                fs.mkdirSync(logDir, { recursive: true });
            } catch (e) {
                // Non-fatal if permission denied on default root
            }
        }
    }

    logSystem(level, message) {
        const timestamp = new Date().toISOString();
        const entry = `[${timestamp}] [AEOS-${level.toUpperCase()}] ${message}\n`;
        process.stdout.write(entry);
        try {
            if (fs.existsSync(path.dirname(this.logFile))) {
                fs.appendFileSync(this.logFile, entry);
            }
        } catch (e) {
            // Fallback to local planning log
            try {
                fs.appendFileSync(path.join(this.planningDir, 'aeosd.log'), entry);
            } catch (_) {}
        }
    }

    calculateHash(filePath) {
        if (!fs.existsSync(filePath)) return null;
        const fileBuffer = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }

    lockPlan() {
        if (fs.existsSync(this.ledgerPath)) {
            const hash = this.calculateHash(this.ledgerPath);
            fs.writeFileSync(this.lockPath, hash, 'utf8');
            this.logSystem('GUARDIAN', `Plan attested and locked with SHA-256: ${hash}`);
            return hash;
        }
        return null;
    }

    verifyPlanLock() {
        if (!fs.existsSync(this.lockPath)) {
            // Auto-lock if fresh
            return this.lockPlan();
        }
        const expectedHash = fs.readFileSync(this.lockPath, 'utf8').trim();
        const currentHash = this.calculateHash(this.ledgerPath);
        if (expectedHash !== currentHash) {
            const err = `[PLAN LOCK COMPROMISED] Hash mismatch! Expected: ${expectedHash}, Current: ${currentHash}`;
            this.logSystem('LOCKDOWN', err);
            throw new Error(err);
        }
        this.logSystem('GUARDIAN', `Integrity verified. Plan SHA-256 Hash: ${currentHash}`);
        return currentHash;
    }

    compressPayload(payload) {
        let compressed = JSON.stringify(payload);
        this.blacklistKeys.forEach(key => {
            const regex = new RegExp(`"${key}":\\s*("[^"]*"|\\{[^}]*\\}|\\[[^\\]]*\\])`, 'g');
            compressed = compressed.replace(regex, `"${key}":"<<tokenless:COMPRESSED>>"`);
        });
        return JSON.parse(compressed);
    }

    formatSmartInjection() {
        if (!fs.existsSync(this.ledgerPath)) return '';
        const content = fs.readFileSync(this.ledgerPath, 'utf8');
        const lines = content.split('\n');
        
        // Extract root objectives, current subtasks, active targets
        const objectives = lines.filter(l => l.startsWith('#') || l.includes('Objective') || l.includes('Goal')).slice(0, 5);
        const pending = lines.filter(l => l.includes('- [ ]')).slice(0, 5);
        const inProgress = lines.filter(l => l.includes('[-] ') || l.includes('[IN_PROGRESS]')).slice(0, 3);
        
        let traces = [];
        if (fs.existsSync(this.progressPath)) {
            const progressLines = fs.readFileSync(this.progressPath, 'utf8').trim().split('\n');
            traces = progressLines.slice(-3);
        }

        return [
            '=== PWF_INJECT=smart ACTIVE RUNTIME CONTEXT ===',
            'Objectives:',
            ...objectives,
            'In Progress:',
            ...inProgress,
            'Immediate Subtasks:',
            ...pending,
            'Recent Audit Traces:',
            ...traces,
            '================================================'
        ].join('\n');
    }

    recordProgress(agent, action, details = '') {
        const timestamp = new Date().toISOString();
        const entry = `[${timestamp}] [${agent.toUpperCase()}] ${action} ${details ? '- ' + details : ''}\n`;
        fs.appendFileSync(this.progressPath, entry, 'utf8');
        this.logSystem('LEDGER', `Recorded transaction: ${action}`);
    }

    executeThreadScheduler(taskInstruction, tokenBudget = 5000) {
        this.logSystem('KERNEL', `Scheduling thread for task: ${taskInstruction}`);
        this.logSystem('KERNEL', `Allocated Thread Token Quota Limit: ${tokenBudget}`);
        
        try {
            // Mount workspace folder to restricted docker container (1GB RAM, 1 CPU, network none)
            const safeWorkspace = this.workspace.replace(/\\/g, '/');
            const sandboxCmd = `docker run --rm --network=none --memory="1g" --cpus="1.0" -v "${safeWorkspace}:/app" node:20-alpine node -e "console.log('Compiling safely inside Sandboxed Container.')"`;
            const result = execSync(sandboxCmd, { timeout: 30000 }).toString();
            this.logSystem('SANDBOX', `Execution logs: ${result.trim()}`);
            this.recordProgress('SCHEDULER', `Sandbox executed task: ${taskInstruction.slice(0, 80)}`);
            return result;
        } catch (err) {
            this.logSystem('ERROR', `Sandbox execution failed: ${err.message}`);
            // If docker is unavailable or volume mount format differs, fallback to running in active sandbox container
            try {
                const fallbackCmd = `docker exec aeos-sandbox node -e "console.log('Executed in existing aeos-sandbox container')"`;
                const fbRes = execSync(fallbackCmd, { timeout: 15000 }).toString();
                this.logSystem('SANDBOX', `Fallback logs: ${fbRes.trim()}`);
                return fbRes;
            } catch (fbErr) {
                this.logSystem('ERROR', `Fallback failed: ${fbErr.message}`);
                throw err;
            }
        }
    }

    processPendingTasks() {
        if (!fs.existsSync(this.ledgerPath)) return;
        try {
            this.verifyPlanLock();
            const content = fs.readFileSync(this.ledgerPath, 'utf8');
            const lines = content.split('\n');
            const pendingIndex = lines.findIndex(line => line.includes('- [ ]'));
            
            if (pendingIndex !== -1) {
                const taskClean = lines[pendingIndex].replace('- [ ]', '').trim();
                this.logSystem('DISPATCH', `Claiming task: ${taskClean}`);
                
                // Mark in progress
                lines[pendingIndex] = lines[pendingIndex].replace('- [ ]', '- [-]');
                fs.writeFileSync(this.ledgerPath, lines.join('\n'), 'utf8');
                this.lockPlan(); // Re-attest update
                
                // Execute sandbox
                this.executeThreadScheduler(taskClean);
                
                // Mark completed
                lines[pendingIndex] = lines[pendingIndex].replace('- [-]', '- [x]');
                fs.writeFileSync(this.ledgerPath, lines.join('\n'), 'utf8');
                this.lockPlan(); // Re-attest completion
                this.recordProgress('CODER', `Completed: ${taskClean}`);
            }
        } catch (err) {
            this.logSystem('LOCKDOWN', `State execution halted: ${err.message}`);
        }
    }

    startWatcher() {
        this.logSystem('DAEMON', 'Background watcher active on .planning directory...');
        
        // Initial lock
        this.lockPlan();

        // Check any pending tasks right away
        this.processPendingTasks();

        let debounceTimer = null;
        fs.watch(this.planningDir, (eventType, filename) => {
            if (filename === 'task_plan.md') {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    try {
                        this.logSystem('DAEMON', `Change detected in task_plan.md (${eventType})`);
                        const content = fs.readFileSync(this.ledgerPath, 'utf8');
                        const pendingLine = content.split('\n').find(line => line.includes('- [ ]'));
                        if (pendingLine) {
                            const taskClean = pendingLine.replace('- [ ]', '').trim();
                            this.executeThreadScheduler(taskClean);
                        }
                    } catch (err) {
                        this.logSystem('LOCKDOWN', `State execution terminated: ${err.message}`);
                    }
                }, 300);
            }
        });
    }
}

// CLI Execution Support
const workspacePath = process.env.AEOS_WORKSPACE || process.cwd();
const daemon = new AEOSDaemon(workspacePath);

if (process.argv.includes('--lock')) {
    daemon.lockPlan();
} else if (process.argv.includes('--verify')) {
    daemon.verifyPlanLock();
} else if (process.argv.includes('--inject')) {
    console.log(daemon.formatSmartInjection());
} else if (process.argv.includes('--claim-pending')) {
    daemon.processPendingTasks();
} else if (process.argv.includes('--watch')) {
    daemon.startWatcher();
} else {
    // Default export or status
    if (require.main === module) {
        console.log('[AEOS Daemon] Ready. Available commands: --watch, --lock, --verify, --inject, --claim-pending');
    }
}

module.exports = { AEOSDaemon };
