// Residential interior template from the implementation plan.
// Dependencies are explicit. Durations come from the founders' Google Sheet workflows (see SHEET_DURATIONS).
// Founders can change any duration in the WorkflowTemplates tab; the bot only fills blanks.
// Named people are not stored as assignees.

export const TRADE_ORDER = ['Civil', 'Carpentry', 'Plumbing', 'Electrical', 'Tiling'];

const WORKFLOW_ID = 'RESIDENTIAL-INTERIOR-V1';

// Calendar days per step, taken from the founders' WORKFLOWS sheet (imported 14 Oct 2026):
// - Civil, Plumbing, Electrical: "Residential Interior" plan (site check 3, drawings 4, execution 7, final check 4).
// - Carpentry: "INTERIOR 1" Carpentering_Wall (site check 1, drawing 4, execution 20, final check 2).
// - Tiling: "INTERIOR 1" Flooring (site check 2, drawing 2, execution 5, final check 2).
// - Resources: "INTERIOR 1" Existing resources (1).
// Procurement is agreed with the founders: presentation 2, and the sheet's 7-day
// "Selection and site delivery" split into selection 3, order 2, on-site readiness 2.
// "Design phase complete" is a 1-day review.
const TRADE_DAYS = {
  Civil: { siteCheck: 3, drawings: 4, execution: 7, finalCheck: 4 },
  Carpentry: { siteCheck: 1, drawings: 4, execution: 20, finalCheck: 2 },
  Plumbing: { siteCheck: 3, drawings: 4, execution: 7, finalCheck: 4 },
  Electrical: { siteCheck: 3, drawings: 4, execution: 7, finalCheck: 4 },
  Tiling: { siteCheck: 2, drawings: 2, execution: 5, finalCheck: 2 },
};
const PROCUREMENT_DAYS = [2, 3, 2, 2];

function sheetDuration(sequence) {
  if (sequence === 5) return 1;
  if (sequence === 90) return 1;
  const trade = (offset) => TRADE_ORDER[(sequence - offset) / 10];
  if (sequence >= 10 && sequence <= 50) return TRADE_DAYS[trade(10)].drawings;
  if (sequence >= 110 && sequence <= 150) return TRADE_DAYS[trade(110)].siteCheck;
  if (sequence >= 300 && sequence < 400) return PROCUREMENT_DAYS[sequence % 10];
  if (sequence >= 400 && sequence <= 440) return TRADE_DAYS[trade(400)].execution;
  if (sequence >= 500 && sequence <= 540) return TRADE_DAYS[trade(500)].finalCheck;
  return '';
}

function definition(fields) {
  return {
    workflowId: WORKFLOW_ID,
    templateVersion: WORKFLOW_ID,
    durationDays: '',
    required: 'Yes',
    milestone: 'No',
    gateType: '',
    audience: 'internal',
    predecessors: [],
    ...fields,
  };
}

export function residentialInteriorDefinitions() {
  const rows = [
    definition({
      sequence: 5,
      stage: 'Resources',
      taskName: 'Collect project plans, photos and client documents',
      defaultRole: 'Client',
      phase: 'Setup',
      trade: '',
      audience: 'client',
    }),
  ];

  TRADE_ORDER.forEach((trade, index) => {
    rows.push(definition({
      sequence: 10 + index * 10,
      stage: 'Design / Drawings',
      taskName: `${trade} design and drawings`,
      defaultRole: 'Designer',
      predecessors: [{ sequence: 5, type: 'FS' }],
      gateType: 'approval',
      phase: 'Design',
      trade,
      scheduleLink: 'design-drawings',
    }));
  });

  rows.push(definition({
    sequence: 90,
    stage: 'Design',
    taskName: 'Design phase complete',
    defaultRole: 'Design Head',
    predecessors: TRADE_ORDER.map((_, index) => ({ sequence: 10 + index * 10, type: 'FS' })),
    milestone: 'Yes',
    phase: 'Design',
    trade: '',
  }));

  TRADE_ORDER.forEach((trade, index) => {
    rows.push(definition({
      sequence: 110 + index * 10,
      stage: 'Site Condition Check',
      taskName: `${trade} site condition check`,
      defaultRole: 'Site Supervisor',
      predecessors: [{ sequence: 5, type: 'FS' }],
      phase: 'Site',
      trade,
    }));
  });

  TRADE_ORDER.forEach((trade, index) => {
    const presentation = 300 + index * 10;
    const designSequence = 10 + index * 10;
    const previousSiteExecution = index === 0 ? null : 400 + (index - 1) * 10;
    rows.push(definition({
      sequence: presentation,
      stage: 'Procurement',
      taskName: `${trade} material presentation`,
      defaultRole: 'Designer',
      predecessors: index === 0
        ? [{ sequence: designSequence, type: 'SS' }]
        : [{ sequence: previousSiteExecution, type: 'SS' }],
      phase: 'Procurement',
      trade,
      scheduleLink: 'procurement-start',
    }));
    rows.push(definition({
      sequence: presentation + 1,
      stage: 'Procurement',
      taskName: `${trade} material selection`,
      defaultRole: 'Project admin',
      predecessors: [{ sequence: presentation, type: 'FS' }],
      phase: 'Procurement',
      trade,
    }));
    rows.push(definition({
      sequence: presentation + 2,
      stage: 'Procurement',
      taskName: `${trade} material order`,
      defaultRole: 'Project admin',
      predecessors: [{ sequence: presentation + 1, type: 'FS' }],
      phase: 'Procurement',
      trade,
    }));
    rows.push(definition({
      sequence: presentation + 3,
      stage: 'Procurement',
      taskName: `${trade} material on-site readiness`,
      defaultRole: 'Site Supervisor',
      predecessors: [{ sequence: presentation + 2, type: 'FS' }],
      gateType: 'material',
      phase: 'Procurement',
      trade,
      scheduleLink: 'material-readiness',
    }));
  });

  TRADE_ORDER.forEach((trade, index) => {
    const designSequence = 10 + index * 10;
    const siteCondition = 110 + index * 10;
    const readiness = 300 + index * 10 + 3;
    rows.push(definition({
      sequence: 400 + index * 10,
      stage: 'Site Execution',
      taskName: `${trade} site execution`,
      defaultRole: 'Site Team',
      predecessors: [
        { sequence: designSequence, type: 'FS' },
        { sequence: siteCondition, type: 'FS' },
        { sequence: readiness, type: 'FS' },
      ],
      phase: 'Site',
      trade,
      scheduleLink: 'site-execution',
    }));
    rows.push(definition({
      sequence: 500 + index * 10,
      stage: 'Final Checking',
      taskName: `${trade} final checking`,
      defaultRole: 'Design Head',
      predecessors: [{ sequence: 400 + index * 10, type: 'FS' }],
      phase: 'Site',
      trade,
    }));
  });

  return rows.map((row) => ({ ...row, durationDays: row.durationDays === '' ? sheetDuration(row.sequence) : row.durationDays, sequence: String(row.sequence), predecessors: row.predecessors.map((edge) => ({ ...edge, sequence: String(edge.sequence) })) }));
}

export function residentialInteriorTuples() {
  return residentialInteriorDefinitions().map((step) => [
    step.workflowId,
    Number(step.sequence),
    step.stage,
    step.taskName,
    step.durationDays,
    step.defaultRole,
    '',
    step.required,
    step.milestone,
    step.predecessors.map((edge) => `${edge.sequence}:${edge.type}`).join(','),
    '',
    step.gateType,
    step.audience,
    step.phase,
    step.trade,
    step.templateVersion,
  ]);
}
