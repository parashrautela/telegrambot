import { SheetStore } from './sheets.js';
import { createProjectFromHouseWorkflow } from './project-service.js';

const [projectId, projectName, clientName, startDateText, groupChatId] = process.argv.slice(2);
if (!projectId || !projectName || !clientName || !startDateText || !groupChatId) {
  console.error('Usage: npm run create-demo-project -- P001 "Demo House" "Demo Client" 2026-09-20 -1001234567890');
  process.exit(1);
}

const store = new SheetStore();
try {
  const result = await createProjectFromHouseWorkflow({ store, projectId, projectName, clientName, startDateText, groupChatId });
  console.log(`Created ${projectId} with ${result.taskCount} scheduled tasks through ${result.targetEndDate}.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
