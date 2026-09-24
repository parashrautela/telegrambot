// Residential interior template from the implementation plan.
// Dependencies are explicit. Blank durations stay blank: calendar type,
// the three-month design window, and procurement lead times are unconfirmed.
// Named people are not stored as assignees.

export const TRADE_ORDER = ['Civil', 'Carpentry', 'Plumbing', 'Electrical', 'Tiling'];

const WORKFLOW_ID = 'RESIDENTIAL-INTERIOR-V1';

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
    taskName: 'Design phase complete (duration target unconfirmed)',
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

  return rows.map((row) => ({ ...row, sequence: String(row.sequence), predecessors: row.predecessors.map((edge) => ({ ...edge, sequence: String(edge.sequence) })) }));
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
