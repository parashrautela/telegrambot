# Project documents: deployment and client handover

The chosen parent folder is https://drive.google.com/drive/folders/1ua1Hqw28njRMX6YTB019Pg4JOG_4M_RC . Set `GOOGLE_DRIVE_FOLDER_ID=1ua1Hqw28njRMX6YTB019Pg4JOG_4M_RC` on the bot host. Each project gets an automatically created child folder. Telegram documents/photos from assigned active group members are logged in SubmittedResources before upload. Save status and authenticated downloads appear in the founder and assigned employee Files tabs.

## Google connection

1. Enable **Google Drive API** in the Cloud project used by the bot. On 6 October the existing service account's read-only folder check returned HTTP 403 `accessNotConfigured`. Folder access and upload remain unverified.
2. For a normal **My Drive** folder, authorize a Google user with access and storage quota. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` securely on the host. The token must authorize Drive access. Do not commit these values or paste them in chat. Complete the Google OAuth consent flow with the account owner and retain the refresh token through a secure setup process; this change does not add an OAuth login UI.
3. For a **Shared drive**, the existing `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY` can be used when the service account has permission to add child folders/files. Service accounts have no personal Drive storage quota and cannot own files in My Drive. Do not make the folder public.
4. Deploy the corresponding web onboarding change. Set matching `INTEGRATION_SHARED_SECRET`, bot `WEB_APP_URL`, and web `BOT_BRIDGE_URL`. The bot bridge serves on `PORT`/`BOT_BRIDGE_PORT`; use the host's actual reachable URL.

References: https://developers.google.com/workspace/drive/api/guides/about-shareddrives and https://developers.google.com/workspace/drive/api/guides/manage-uploads .

## Automatic behavior and limits

- A durable record is saved first. A worker retries upload/web sync every 60 seconds and after a submission. File identities are stable to recover after a successful upload whose Sheet acknowledgment failed. Drive app properties are used to find an existing copy.
- Files up to 20 MB are automatically downloaded/uploaded. Larger files remain Pending with an explanation; send smaller files for this pilot. Uploaded files inherit the selected folder's access; the app does not grant public Drive permissions.
- No human approval is needed to save. Reviewing a resource task is separate from file storage. The founder/assigned employees can download through the authenticated app even without their own Drive login.
- Existing historical SubmittedResources rows without a source message ID can upload to Drive, but cannot appear in the new web Files list until their message identity is backfilled. No live backfill was performed.
- Do not claim live saving is verified until the host connection passes a real upload/download check.

## Client handover

Change the parent folder variable and, when required, the authorized Google account, then restart the bot. New files go under the new parent. Already stored files remain in the previous Drive and keep their stored IDs. Move/share existing project folders and verify the new account can read them before removing old account access; changing the folder variable alone does not transfer ownership or migrate old files.

## Live pilot acceptance (pending)

- [ ] Enable Drive API and verify the chosen account can create a child folder/file.
- [ ] Telegram project appears in Quick Projects; opening it shows Add members first.
- [ ] Add client/team to Telegram; if missing, have them send `/join`. Refresh the card and assign names/designations inline.
- [ ] Save any displayed employee login details privately, then Finish setup. Confirm exactly one client and at least one staff member.
- [ ] Choose Restoration in the web app. Confirm one group start announcement and the same task names/count in the web app and `/tasks`.
- [ ] Retry the same start and verify no duplicate tasks or announcement.
- [ ] Send a photo and PDF as assigned members. Confirm Pending becomes Saved in Files, actual bytes open/download, and copies exist in the project Drive folder.
- [ ] Log in as assigned staff and verify Files access; unrelated staff must not see the project files.
- [ ] Confirm no personal-bot project-type prompt is sent by the web-connected deployment.
