# Pilot Verification Checklist — 7 October 2026

Run this on the deployed frontend using real APIs. A missing control is an unfinished integration, not a passed test. Do not mark a Notion problem complete merely because its backend PR exists.

## Preparation

- [ ] Frontend/backend owners confirm both reviewed backend PRs and the frontend integration are deployed to the same pilot environment.
- [ ] Prepare a founder login, two staff logins, and an approved dummy Telegram client.
- [ ] Create a dedicated Telegram test group and a project named Pilot Test — 7 Oct. Use harmless dummy data.
- [ ] Backend owner confirms the group bot can read/post, client identity is mapped in both services, bot Client-role approval and bot workflow selection are complete, and both services have the required configuration.
- [ ] Prepare a second private project for access-isolation testing.

Use one browser for founder, another browser/profile for Staff A, and another profile for Staff B. The client uses Telegram.

## Core pilot test — mandatory

| #   | Your action                                                                                                                                                                     | Pass result                                                                                                                                          | Notion coverage            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | Sign in as founder and both staff users; try a wrong password and sign out/in once.                                                                                             | Correct accounts work; wrong password fails; protected views require sign-in.                                                                        | PS-02                      |
| 2   | Create the test project without assigning a client. Try to start its workflow.                                                                                                  | Project exists in Setup; start is unavailable or rejected.                                                                                           | PS-04                      |
| 3   | Assign the dummy client, select a workflow, inspect its preview, and start.                                                                                                     | Project starts and shows generated tasks/stages/deadlines. Repeating Start does not duplicate tasks.                                                 | PS-04, PS-13               |
| 4   | Add Staff A and Staff B. Open the dashboard, enter the project, switch Tasks/Chat/Team, then return home.                                                                       | Correct real project/member/stage/progress data appears; project context stays correct.                                                              | PS-03, PS-05, PS-15        |
| 5   | Create a task with title, description, assignee, deadline, and stage. Staff A updates it to In progress, then Completed. Create separate disposable tasks to cancel and delete. | Changes persist and both users see them after refresh/polling; employee cannot reassign work.                                                        | PS-06                      |
| 6   | Use an open task. Founder and Staff A each post a thread reply and an HTTPS reference. Open another task afterward.                                                             | Replies show sender/time, remain attached to the original task, and the reference opens.                                                             | PS-07                      |
| 7   | Founder and both staff users send distinct messages in internal project chat. Open the second project.                                                                          | Messages appear in the correct project only; none is automatically sent to Telegram.                                                                 | PS-08                      |
| 8   | Dummy client sends ordinary Telegram text: Can we move the living room light?                                                                                                   | One Client Query appears in the correct project with client/source information. Allow up to a minute for sync retry.                                 | PS-09                      |
| 9   | Dummy client sends a photo with a caption. Open its preview and full attachment as founder and staff.                                                                           | The photo appears with the correct query and both authorized roles can view it.                                                                      | PS-10                      |
| 10  | Staff A and Staff B discuss the query; founder adds a comment.                                                                                                                  | Discussion remains inside that query and is not posted to Telegram.                                                                                  | PS-07, PS-09, PS-11        |
| 11  | Convert that query into a task and assign Staff A. Update the task and open its source query.                                                                                   | Exactly one linked task exists; client-origin label and original discussion remain available.                                                        | PS-06, PS-11               |
| 12  | Send two additional dummy queries. Approve one; reject the other with a reason.                                                                                                 | Decisions persist; rejection requires a reason; neither action automatically sends a Telegram reply.                                                 | PS-11                      |
| 13  | Write a final reply, inspect the destination/text confirmation, and publish.                                                                                                    | Client receives the reply in the correct Telegram group; app shows the published reply separately from comments. Another successful send is blocked. | PS-12                      |
| 14  | Refresh all browser windows; sign out/in; reopen the project, query, task, and chat.                                                                                            | Tasks, comments, client query/photo references, internal messages, and published response remain saved.                                              | Pilot acceptance           |
| 15  | As Staff A, try accessing the second private project, including a copied direct task/query URL.                                                                                 | Access is denied; private data never appears.                                                                                                        | PS-02, PS-05               |
| 16  | Remove Staff A from the test project; try accessing its task/query/photo/chat in the already signed-in browser. Then disable Staff A's account.                                 | Project access is revoked immediately; other assignments remain after project-only removal; account disablement blocks session/login.                | PS-02, PS-15               |
| 17  | Repeat the central query → discussion → task → reply journey on a phone.                                                                                                        | Main controls and media work without clipped dialogs or inaccessible buttons.                                                                        | Responsive frontend checks |

Record each result as Pass, Fail, or Not available, with the Notion ID and a screenshot/reference. Record the test environment and time. If a control is missing, tell the frontend developer; if a request fails, share the action, error, and endpoint with the backend owner.

## Checks with the developers

- [ ] Restart the pilot web service and verify saved data remains. Do this in the test environment, not during the client demo.
- [ ] Replay the same incoming Telegram request; confirm one query exists. Sending the same words as a new Telegram message is not a duplicate-delivery test.
- [ ] Test failed sync and eventual recovery after a request has been saved in Sheets.
- [ ] In a controlled test environment, verify Failed reply delivery offers correction/retry; Unknown delivery blocks another send and instructs checking Telegram. Do not force timeouts while messaging a real client.
- [ ] Test loading, empty, invalid-input, expired-session, and unavailable-image states.
- [ ] Frontend/backend owners verify one real API response against the shared models and error/pagination contracts (PS-01).

## Remaining Notion requirements — do not claim complete yet

| Notion item | Additional work/check beyond the core pilot                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| PS-01       | Full shared models, mock-to-real switching, complete storage/notification models, and consistent API contracts/pagination.                          |
| PS-02       | Complete all login, permission, session-expiry, and revocation UI checks.                                                                           |
| PS-03       | Assigned to Me and ongoing filters, upcoming deadlines, and responsive/empty/error dashboard states.                                                |
| PS-04       | Client selector/association and all lifecycle UI states; core behavior is covered above.                                                            |
| PS-05       | Schedule/Files navigation and complete unread/task/query summary counts.                                                                            |
| PS-06       | All task fields, actions, permissions, and cross-user consistency; core behavior is covered above.                                                  |
| PS-07       | Reply counts, collapsed-thread behavior, attachment previews, refresh behavior; core discussion is covered above.                                   |
| PS-08       | Complete chat attachment handling, reply/thread entry points, unread state, and Client Query labeling.                                              |
| PS-09       | Notification/unread events remain. Implementation uses the existing polling worker, not a webhook; record this architectural difference explicitly. |
| PS-10       | Cloud media archival remains; the current implementation is an authenticated Telegram proxy with metadata in core storage.                          |
| PS-11       | All decision confirmations, state/error cases, source links, and audit fields; core decisions are covered above.                                    |
| PS-12       | Full Sending/Sent/Failed/Unknown UI checks; reconciliation for Unknown is not implemented.                                                          |
| PS-13       | Pilot templates/start behavior are available; web and bot/Sheets workflows remain separate.                                                         |
| PS-14       | Stage duration editing/reordering and schedule recalculation APIs/UI remain.                                                                        |
| PS-15       | Complete global team/role/access UI verification, including multiple designers.                                                                     |
| PS-16       | Google Drive integration, file/folder listing, grant/revoke permission synchronization remain.                                                      |
| PS-17       | Complete notification events, lists, counts, deep links, and read/unread aggregation remain.                                                        |
| PS-18       | Traceable project activity/TLDR summaries remain incomplete.                                                                                        |

## Pilot decision

Proceed with the core pilot only after the mandatory core tests pass and the developer checks show no issue with access, persistence, duplicate intake, or reply delivery. The Notion backlog explicitly prioritizes Tasks + Internal Chat + Telegram query/reply. Drive, advanced scheduling, complete notifications, and summaries may remain visibly deferred if they are not part of tomorrow's promised scope.

Passing this checklist establishes the core pilot journey; it does not automatically complete every checklist under PS-01 through PS-18. Mark individual Notion checkboxes only after their actual behavior or implementation has been verified.
