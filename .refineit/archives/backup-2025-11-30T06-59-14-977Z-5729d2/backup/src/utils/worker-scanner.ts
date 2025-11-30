// src/utils/worker-scanner.ts
import { Worker } from 'worker_threads';
import os from 'os';
import path from 'path';

/**
 * computeHashes(files, concurrency)
 * Uses worker threads (eval) to compute SHA256 hashes for given absolute file paths.
 *
 * Returns: Promise<Record<string, string>> (map file -> hex-hash)
 *
 * Note: We use eval workers to avoid needing a separate compiled worker file.
 */

export async function computeHashes(files: string[], concurrency = Math.max(2, Math.floor(os.cpus().length / 2))): Promise<Record<string, string>> {
    if (!files || files.length === 0) return {};
    const out: Record<string, string> = {};
    const queue = files.slice();
    const workers: Promise<void>[] = [];

    // small worker code string: read file & compute sha256
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

    // Worker runner: each worker gets a small slice of files
    function spawnWorker(slice: string[]) {
        return new Promise<void>((resolve, reject) => {
            const w = new Worker(workerCode, { eval: true, workerData: { files: slice } });
            w.on('message', (msg: any) => {
                if (msg && msg.__done) return;
                if (msg && msg.__error) {
                    // non-fatal for our hashing; report and ignore
                    // console.warn('worker error', msg.__error);
                    return;
                }
                if (msg && msg.ok) out[msg.file] = msg.hash;
            });
            w.on('error', (err) => {
                // worker crashed — resolve so pool continues
                resolve();
            });
            w.on('exit', () => resolve());
        });
    }

    // Build slices for concurrency
    const per = Math.ceil(queue.length / concurrency);
    for (let i = 0; i < concurrency; i++) {
        const slice = queue.slice(i * per, (i + 1) * per);
        if (slice.length === 0) continue;
        workers.push(spawnWorker(slice));
    }

    await Promise.all(workers);
    return out;
}
