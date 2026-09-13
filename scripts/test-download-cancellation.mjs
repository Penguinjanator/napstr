import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const page = readFileSync(new URL('../src/routes/+page.svelte', import.meta.url), 'utf8').split('<script lang="ts">')[1].split('</script>')[0];
const ast = ts.createSourceFile('page.ts', page, ts.ScriptTarget.Latest, true);
const names = ['isActiveTransfer', 'requestNetworkDownload', 'startDownload', 'removeTransfer', 'clearAllTransfers'];
const source = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text)).map(node => node.getText(ast)).join('\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ lateInsert = false, failRemove = false } = {}) {
  let settleRequest;
  let rows = [];
  const row = { id: -1, fileId: 'song', filename: 'Song', size: 100, progress: 0, status: 'Connecting', speed: '—', destination: '' };
  const context = vm.createContext({
    console, Set, Map, Promise, Date, Error, String,
    nativeReady: true, clearingTransfers: false, removingTransfers: new Set(),
    downloadGeneration: 0, pendingDownloadRequests: new Map(), downloadAttempts: new Map(), cancellingFiles: new Set(),
    startingDownloads: new Set(), audiobookDownloads: [], transfers: [], activityMessage: '', selected: null,
    isLocalFile: () => false,
    mapTransfers: rows => rows.map(row => ({ ...row, name: row.filename })),
    invoke: async (command, args) => {
      if (command === 'request_network_download') {
        if (!lateInsert) rows.push({ ...row });
        await new Promise(resolve => { settleRequest = resolve; });
        if (lateInsert) rows.push({ ...row });
        return 'request';
      }
      if (command === 'get_transfers') return rows.map(row => ({ ...row }));
      if (command === 'remove_transfer') {
        if (failRemove) throw new Error('cleanup failed');
        rows = rows.filter(row => row.id !== args.id);
        return;
      }
      if (command === 'clear_all_transfers') { rows = []; return; }
      throw new Error(command);
    }
  });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, rows: () => rows, settle: () => settleRequest() };
}
for (const lateInsert of [false, true]) {
  const f = fixture({ lateInsert });
  const start = f.context.startDownload({ fileId: 'song', name: 'Song', size: 100, sourceDetails: [{ pubkey: 'source' }] });
  const optimisticId = f.context.transfers[0].id;
  assert(optimisticId > 0);
  const cancel = f.context.removeTransfer(optimisticId);
  await tick();
  assert.equal(f.rows().length, 0, 'stop an existing backend row without waiting for negotiation');
  f.settle();
  await Promise.all([start, cancel]);
  assert.equal(f.rows().length, 0, 'late backend insertion must also be removed');
  assert.equal(f.context.transfers.length, 0, 'cancelled transfer must not reappear');
  assert.equal(f.context.cancellingFiles.size, 0);
}
{
  const f = fixture();
  const start = f.context.startDownload({ fileId: 'song', name: 'Song', size: 100, sourceDetails: [{ pubkey: 'source' }] });
  const clear = f.context.clearAllTransfers();
  await tick(); f.settle(); await Promise.all([start, clear]);
  assert.equal(f.rows().length, 0);
  assert.equal(f.context.transfers.length, 0);
}
{
  const f = fixture({ failRemove: true });
  const start = f.context.startDownload({ fileId: 'song', name: 'Song', size: 100, sourceDetails: [{ pubkey: 'source' }] });
  await f.context.removeTransfer(f.context.transfers[0].id);
  f.settle(); await start;
  assert.equal(f.rows().length, 1, 'failed cleanup must not report removal');
  assert.match(f.context.activityMessage, /Could not remove transfer/);
}
{
  const f = fixture();
  const start = f.context.startDownload({ fileId: 'song', name: 'Song', size: 100, sourceDetails: [{ pubkey: 'source' }] });
  const completed = { id: 5, fileId: 'song', progress: 100, status: 'Verified · Complete' };
  f.rows().push(completed);
  f.context.transfers.push(completed);
  await f.context.removeTransfer(5);
  f.settle(); await start;
  assert.equal(f.rows().length, 1, 'removing a completed history row must not cancel a new download');
  assert.equal(f.rows()[0].id, -1);
}
console.log('PASS: early/late cancellation, clear-all, cleanup failure, and preserving other entries');
