import { SheetStore } from './sheets.js';
import { WORKFLOWS } from './schema.js';

const store = new SheetStore();
const existing = new Set((await store.rows('WorkflowTemplates')).map((row) => row.WorkflowID));
let added = 0;
for (const [workflowId, steps] of Object.entries(WORKFLOWS)) {
  if (existing.has(workflowId)) continue;
  for (const [WorkflowID, Sequence, Stage, TaskName, DurationDays, DefaultRole, PredecessorTemplateID, Required, Milestone] of steps) {
    await store.append('WorkflowTemplates', { WorkflowID, Sequence, Stage, TaskName, DurationDays, DefaultRole, PredecessorTemplateID, Required, Milestone });
  }
  added += steps.length;
}
console.log(added ? `Added ${added} workflow steps.` : 'All default workflows already exist; no rows added.');
