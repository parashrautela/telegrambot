import { SheetStore } from '../src/storage/sheets.js';
import { createProjectFromHouseWorkflow } from '../src/projects/service.js';

const [projectId, projectName, clientName, startDateText, groupChatId] = process.argv.slice(2);
if (!projectId || !projectName || !clientName || !startDateText || !groupChatId) {
  console.error(
    'Usage: npm run create-demo-project -- P001 "Demo House" "Approved Client Name" 2026-09-20 -1001234567890\nThe client must already have an approved Client role in this group.',
  );
  process.exit(1);
}

const store = new SheetStore();
try {
  const result = await createProjectFromHouseWorkflow({
    store,
    projectId,
    projectName,
    clientName,
    startDateText,
    groupChatId,
  });
  console.log(
    `Created ${projectId} with ${result.taskCount} scheduled tasks through ${result.targetEndDate}.`,
  );
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
