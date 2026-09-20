import { SheetStore } from './sheets.js';
import { HOUSE_WORKFLOW } from './schema.js';

const store = new SheetStore();
const existing = await store.rows('WorkflowTemplates');
if (existing.some((row) => row.WorkflowID === 'HOUSE-V1')) {
  console.log('HOUSE-V1 already exists; no rows added.');
} else {
  for (const [WorkflowID, Sequence, Stage, TaskName, DurationDays, DefaultRole, PredecessorTemplateID, Required, Milestone] of HOUSE_WORKFLOW) {
    await store.append('WorkflowTemplates', { WorkflowID, Sequence, Stage, TaskName, DurationDays, DefaultRole, PredecessorTemplateID, Required, Milestone });
  }
  console.log(`Added ${HOUSE_WORKFLOW.length} house-building workflow steps.`);
}
