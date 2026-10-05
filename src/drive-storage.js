import crypto from 'node:crypto';
const API='https://www.googleapis.com/drive/v3';
const MAX=20_000_000;
let cachedToken='',expires=0;
const fault=(message)=>Object.assign(new Error(message),{publicMessage:message});
async function accessToken() {
  if (cachedToken && expires>Date.now()) return cachedToken;
  let fields;
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw fault('Google Drive user connection is not configured.');
    fields={grant_type:'refresh_token',refresh_token:process.env.GOOGLE_DRIVE_REFRESH_TOKEN,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET};
  } else {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) throw fault('Google Drive credentials are not configured.');
    const now=Math.floor(Date.now()/1000);
    const head=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const claim=Buffer.from(JSON.stringify({iss:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})).toString('base64url');
    const signature=crypto.sign('RSA-SHA256',Buffer.from(`${head}.${claim}`),process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n')).toString('base64url');
    fields={grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${head}.${claim}.${signature}`};
  }
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(fields),signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw fault('Google Drive authentication failed.');
  const data=await response.json(); if(!data.access_token)throw fault('Google Drive authentication failed.'); cachedToken=data.access_token;expires=Date.now()+((data.expires_in||3600)-60)*1000;return cachedToken;
}
async function drive(url,options={}) {
  const response=await fetch(url,{...options,headers:{authorization:`Bearer ${await accessToken()}`,...options.headers},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok) throw fault('Google Drive upload pending. Check folder access, Drive API and storage quota.');
  return response;
}
async function findFile(parent,key) {
  const q=`'${parent}' in parents and trashed=false and appProperties has { key='ikshaKey' and value='${key}' }`;
  const response=await drive(`${API}/files?${new URLSearchParams({q,fields:'files(id,webViewLink)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'})}`);
  return (await response.json()).files?.[0];
}
async function bounded(response) {
  if(!response.ok || !response.body) throw fault('The source file could not be downloaded.');
  if(Number(response.headers.get('content-length'))>MAX){await response.body.cancel();throw fault('File exceeds the 20 MB automatic upload limit.');}
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>MAX)throw fault('File exceeds the 20 MB automatic upload limit.');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
export async function archiveProjectResource({project,record}) {
  if(!project?.ProjectID || !record?.SubmissionID)throw fault('The file is missing its project identity.');
  const parent=process.env.GOOGLE_DRIVE_FOLDER_ID;
  if(!parent || !/^[\w-]+$/.test(parent)) throw fault('Set the Google Drive parent folder to enable automatic uploads.');
  // Stable identities recover after a successful Drive write but failed Sheet ack.
  const projectKey=crypto.createHash('sha256').update(String(project.ProjectID)).digest('hex');
  let folder=await findFile(parent,projectKey);
  if(!folder){const response=await drive(`${API}/files?supportsAllDrives=true&fields=id,webViewLink`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:`${project.ProjectID} — ${project.ProjectName}`,mimeType:'application/vnd.google-apps.folder',parents:[parent],appProperties:{ikshaKey:projectKey}})});folder=await response.json();}
  const key=crypto.createHash('sha256').update(String(record.SubmissionID)).digest('hex');
  const existing=await findFile(folder.id,key);if(existing)return existing;
  const token=process.env.GROUP_BOT_TOKEN;if(!token)throw fault('Telegram media download is not configured.');
  const lookup=await fetch(`https://api.telegram.org/bot${token}/getFile`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file_id:record.TelegramFileID}),signal:AbortSignal.timeout(10000),redirect:'error'});
  const data=await lookup.json();const file=data.result;
  if(!data.ok || !file?.file_path || !/^[\w./-]+$/.test(file.file_path) || file.file_path.split('/').includes('..'))throw fault('The Telegram file is not available for download.');
  if(file.file_size>MAX)throw fault('File exceeds the 20 MB automatic upload limit.');
  const bytes=await bounded(await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`,{signal:AbortSignal.timeout(20000),redirect:'error'}));
  const mime=/^[\w.+-]+\/[\w.+-]+$/.test(record.MimeType||'')?record.MimeType:record.ResourceType==='Photo'?'image/jpeg':'application/octet-stream';
  const boundary=`iksha-${crypto.randomUUID()}`;
  const metadata={name:record.FileName || 'Project document',parents:[folder.id],appProperties:{ikshaKey:key}};
  const payload=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const result=await drive(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,{method:'POST',headers:{'content-type':`multipart/related; boundary=${boundary}`},body:payload});return result.json();
}
export async function downloadProjectResource(id) {
  if(!/^[\w-]+$/.test(id))throw fault('Invalid stored file.');
  return bounded(await drive(`${API}/files/${id}?alt=media&supportsAllDrives=true`));
}
