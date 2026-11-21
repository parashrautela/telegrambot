# Project files and Google Drive

Photos, documents and videos sent in a project's Telegram group by the founder or an assigned active member are logged in SubmittedResources, and the bot passes each record to the web app (`WEB_APP_URL`, `INTEGRATION_SHARED_SECRET`), retrying every 60 seconds until the web app accepts it.

The web app saves the files to Google Drive. The founder connects Drive on the web app's **Google Drive** page and chooses the folder there; the bot needs no Drive settings. The web app fetches each file's bytes through this bridge (`POST /api/integrations/web/resources/content`), which reads them from Telegram with the group bot token.

Telegram does not hand files over 20 MB to bots. Those stay waiting in the web app with that reason; ask for a smaller copy.

## Client handover

Change the folder on the web app's Google Drive page, or connect another Google account there. New files go to the new folder; files already saved stay where they are.
