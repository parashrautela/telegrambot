// Durable metadata first; Drive upload and web notification retry independently.
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
export async function retryProjectResources(store, archive) {
  if (running) return;
  running = true;
  try {
    const pending = (await store.rows('SubmittedResources')).filter((row)=>row.DriveStatus!=='Stored' || row.WebSyncStatus!=='Synced');
    const start = pending.length ? cursor % pending.length : 0;
    const rows = [...pending.slice(start),...pending.slice(0,start)].slice(0,20);
    cursor = start + rows.length;
    for (const row of rows) {
      if (row.DriveStatus !== 'Stored') {
        try {
          const project = await store.projectById(row.ProjectID);
          const file = await archive({project,record:row});
          if (!file?.id) throw new Error('Drive did not return a file identity.');
          Object.assign(row,{DriveStatus:'Stored',DriveFileID:file.id,DriveUrl:file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,DriveError:'',WebSyncStatus:''});
        } catch (error) {
          Object.assign(row,{DriveStatus:'Pending',WebSyncStatus:'',DriveError:error.publicMessage || 'Drive upload pending. Check the storage configuration or retry.'});
        }
        await store.updateRow('SubmittedResources',row.rowNumber,{DriveStatus:row.DriveStatus,DriveFileID:row.DriveFileID || '',DriveUrl:row.DriveUrl || '',DriveError:row.DriveError || '',WebSyncStatus:''});
      }
      if (row.WebSyncStatus !== 'Synced') {
        try { if (await syncProjectResource(row)) await store.updateRow('SubmittedResources',row.rowNumber,{WebSyncStatus:'Synced',WebSyncedAt:new Date().toISOString()}); }
        catch { /* The metadata stays queued in Sheets; next tick retries. */ }
      }
    }
  } finally { running=false; }
}
