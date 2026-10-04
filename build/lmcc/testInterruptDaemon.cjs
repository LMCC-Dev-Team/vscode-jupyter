// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Windows regression: duplicating a handle into Node must not close Python's stdin.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
    assert.equal(process.platform, 'win32', 'Run against the Windows distribution');
    assert(process.argv[2], 'Pass the managed python.exe path');
    const daemon = spawn(process.argv[2], [process.argv[3] || path.resolve(__dirname, '../../pythonFiles/vscode_datascience_helpers/kernel_interrupt_daemon.py'), '--ppid', String(process.pid)], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }, windowsHide: true
    });
    let stdout = '', stderr = '';
    daemon.stdout.on('data', data => stdout += data);
    daemon.stderr.on('data', data => stderr += data);
    async function waitFor(pattern) {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const match = stdout.match(pattern);
            if (match) { return match; }
            assert.equal(daemon.exitCode, null, `Daemon exited: ${stderr}`);
            await delay(50);
        }
        throw new Error(`Daemon response timed out: ${stdout}\n${stderr}`);
    }
    try {
        await waitFor(/DAEMON_STARTED:/);
        daemon.stdin.write('INITIALIZE_INTERRUPT:0\n');
        const first = (await waitFor(/INITIALIZE_INTERRUPT:0:(\d+)/))[1];
        // Longer than the daemon's former five-second bad-file-descriptor retry window.
        await delay(6000);
        daemon.stdin.write('INITIALIZE_INTERRUPT:1\n');
        await waitFor(/INITIALIZE_INTERRUPT:1:(\d+)/);
        daemon.stdin.write(`INTERRUPT:2:${first}\n`);
        await waitFor(/INTERRUPT:2/);
        assert(!stderr.includes('Bad file descriptor'), stderr);
        console.log('Windows interrupt daemon regression passed');
    } finally {
        daemon.kill();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
