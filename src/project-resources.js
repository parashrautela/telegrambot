// Durable metadata first. The web app saves the files to Google Drive; the bot only passes each record on until the web app has it.
export async function syncProjectResource(record, fetchImpl = fetch) {
  const base = process.env.WEB_APP_URL?.replace(/\/$/, '');
  const secret = process.env.INTEGRATION_SHARED_SECRET;
  if (!base || !secret) return false;
  const response = await fetchImpl(`${base}/api/integrations/telegram/resources`, {
    method:'POST', headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},
    body:JSON.stringify(record),signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Project resource sync failed.');
  return true;
}
let running = false, cursor = 0;
export async function retryProjectResources(store) {
  if (running) return;
  running = true;
  try {
    const pending = (await store.rows('SubmittedResources')).filter((row)=>row.WebSyncStatus!=='Synced');
    const start = pending.length ? cursor % pending.length : 0;
    const rows = [...pending.slice(start),...pending.slice(0,start)].slice(0,20);
    cursor = start + rows.length;
    for (const row of rows) {
      try { if (await syncProjectResource(row)) await store.updateRow('SubmittedResources',row.rowNumber,{WebSyncStatus:'Synced',WebSyncedAt:new Date().toISOString()}); }
      catch { /* The metadata stays queued in Sheets; next tick retries. */ }
    }
  } finally { running=false; }
}
