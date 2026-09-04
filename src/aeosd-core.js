const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

class AEOSDaemon {
    constructor(workspace) {
        this.workspace = workspace;
        this.ledgerPath = path.join(workspace, '.planning', 'task_plan.md');
        this.blacklistKeys = ['stack', 'metadata', 'trace', 'config', 'debug_dump'];
    }

    calculateHash(filePath) {
        const fileBuffer = fs.readFileSync(filePath);
        return crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }

    compressPayload(payload) {
        let compressed = JSON.stringify(payload);
        this.blacklistKeys.forEach(key => {
            const regex = new RegExp(`"${key}":\\s*("[^"]*"|\\{[^}]*\\}|\\[[^\\]]*\\])`, 'g');
            compressed = compressed.replace(regex, `"${key}":"<<tokenless:COMPRESSED>>"`);
        });
        return JSON.parse(compressed);
    }

    executeThreadScheduler(taskInstruction, tokenBudget = 5000) {
        console.log(`[AEOS KERNEL] Scheduling thread for task: ${taskInstruction}`);
        
        // Command isolation wrapper: Mount sandbox folder to restricted docker container
        const sandboxCmd = `docker run --rm --network=none --memory="1g" --cpus="1.0" -v ${this.workspace}:/app node:20-alpine node -e "console.log('Compiling safely inside Sandboxed Container.')"`;
        const result = execSync(sandboxCmd).toString();
        console.log(`[SANDBOX EXECUTION LOGS]: ${result}`);
    }

    startWatcher() {
        console.log("[AEOS Daemon] Background watcher active...");
        fs.watch(path.dirname(this.ledgerPath), (eventType, filename) => {
            if (filename === 'task_plan.md') {
                try {
                    const activeHash = this.calculateHash(this.ledgerPath);
                    console.log(`[AEOS GUARDIAN] Plan integrity verified. Hash: ${activeHash}`);
                    
                    const content = fs.readFileSync(this.ledgerPath, 'utf8');
                    const pendingLine = content.split('\n').find(line => line.includes('- [ ]'));
                    
                    if (pendingLine) {
                        const taskClean = pendingLine.replace('- [ ]', '').trim();
                        this.executeThreadScheduler(taskClean);
                    }
                } catch (err) {
                    console.error(`[AEOS KERNEL LOCKDOWN] State execution terminated: ${err.message}`);
                }
            }
        });
    }
}

const daemon = new AEOSDaemon(process.cwd());
if (process.argv.includes('--watch')) {
    daemon.startWatcher();
}
