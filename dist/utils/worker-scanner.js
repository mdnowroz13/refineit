import { Worker } from 'worker_threads';
import os from 'os';
export async function computeHashes(files, concurrency = Math.max(2, Math.floor(os.cpus().length / 2))) {
    if (!files || files.length === 0)
        return {};
    const out = {};
    const queue = files.slice();
    const workers = [];
    const workerCode = `
    const { parentPort, workerData } = require('worker_threads');
    const fs = require('fs').promises;
    const crypto = require('crypto');

    async function hashFile(file) {
      try {
        const b = await fs.readFile(file);
        const h = crypto.createHash('sha256').update(b).digest('hex');
        return { file, hash: h, ok: true };
      } catch (e) {
        return { file, error: String(e), ok: false };
      }
    }

    (async () => {
      for (const f of workerData.files) {
        const r = await hashFile(f);
        parentPort.postMessage(r);
      }
      parentPort.postMessage({ __done: true });
    })().catch(err => {
      parentPort.postMessage({ __error: String(err) });
    });
  `;
    function spawnWorker(slice) {
        return new Promise((resolve, reject) => {
            const w = new Worker(workerCode, { eval: true, workerData: { files: slice } });
            w.on('message', (msg) => {
                if (msg && msg.__done)
                    return;
                if (msg && msg.__error) {
                    return;
                }
                if (msg && msg.ok)
                    out[msg.file] = msg.hash;
            });
            w.on('error', (err) => {
                resolve();
            });
            w.on('exit', () => resolve());
        });
    }
    const per = Math.ceil(queue.length / concurrency);
    for (let i = 0; i < concurrency; i++) {
        const slice = queue.slice(i * per, (i + 1) * per);
        if (slice.length === 0)
            continue;
        workers.push(spawnWorker(slice));
    }
    await Promise.all(workers);
    return out;
}
//# sourceMappingURL=worker-scanner.js.map