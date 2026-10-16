// The founders' "INTERIOR 1" plan from the WORKFLOWS tab of the Google Sheet, as a dependency graph.
// Data copied from the web app's sheet-workflows.json (fetched 14 Oct 2026). The bot never imports from the web repo.
// Founders can change any duration in the WorkflowTemplates tab; the bot only fills blanks.
//
// Scheduling mirrors the web projection (sheetPlan.js):
// - Main-lane stages run one after another; tasks inside a stage run one after another (FS).
// - Items sharing an order number inside a stage run side by side, and the next order group waits for all of them.
// - A parallel stage starts when the main-lane task in its anchor sheet row starts (SS).
// A blank duration stays blank: that task and anything waiting on it stay unscheduled until a founder sets it.

const WORKFLOW_ID = 'INTERIOR-SHEET-V1';
const DESIGN_STAGE_CODES = new Set(['1', '2', '3']);
const DEFAULT_ROLE = 'Site Team';

// Each task: [sheet row, order, title, duration days (null = not set in the sheet), role (null = not set)].
const STAGES = [
  { code: "1", name: "Design plan", lane: "main", tasks: [
    [15, "1", "Existing resources", 1, "Client"],
    [16, "2", "2D drawing", 3, "Designer"],
    [17, "3", "Design approval", 2, "Design Head/ Admin"],
    [18, "4", "Client Presentation & approval", 2, "Client"],
  ] },
  { code: "2", name: "Design concept", lane: "main", tasks: [
    [19, "1", "3D Design", 7, "Designer"],
    [20, "2", "Design approval", 2, "Design Head/ Admin"],
    [21, "3", "Client Presentation & approval", 3, "Client"],
  ] },
  { code: "3", name: "3D Design", lane: "main", tasks: [
    [22, "1", "Site Condition Check", 1, "Site Supervisor"],
    [23, "2", "3D Design", 7, "Designer"],
    [24, "3", "Design approval", 2, "Design Head/ Admin"],
    [25, "4", "Client Presentation & approval", 3, "Client"],
  ] },
  { code: "4", name: "Civil Work", lane: "main", tasks: [
    [26, "1", "Site Condition Check", 2, "Site Supervisor"],
    [27, "2", "Drawing", 2, "Designer"],
    [28, "3", "Drawing approval", 1, "Design Head/ Admin"],
    [29, "4", "Client Presentation & approval", 1, "Client"],
    [30, "5", "Site Execution", 7, "Tile person"],
    [31, "6", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "5a", name: "Electrical Work", lane: "parallel", anchor: { stageCode: "4", row: 29 }, tasks: [
    [29, "1", "Drawing", 8, "Designer"],
    [31, "2", "Drawing approval", 2, "Design Head/ Admin"],
  ] },
  { code: "5b", name: "Electrical Work 1", lane: "main", tasks: [
    [32, "1", "Site Condition Check", 1, "Site Supervisor"],
    [33, "2", "Drawing", 2, "Designer"],
    [34, "3", "Drawing approval", 1, "Design Head/ Admin"],
    [35, "4", "Client Presentation & approval", 1, "Client"],
    [36, "5", "Site Execution", 5, "Electrician"],
    [37, "6", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "6a", name: "Plumbing Work", lane: "parallel", anchor: { stageCode: "5b", row: 34 }, tasks: [
    [34, "1", "Drawing", 7, "Designer"],
    [37, "2", "Drawing approval & Electrician Final", 2, "Design Head/ Admin"],
  ] },
  { code: "6b", name: "Plumbing Work", lane: "main", tasks: [
    [38, "1", "Client Presentation & approval", 1, "Client"],
    [39, "2", "Site Execution", 5, "Plumber"],
    [40, "3", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "7a", name: "Flooring", lane: "parallel", anchor: { stageCode: "6b", row: 38 }, tasks: [
    [38, "1", "Presentation", null, null],
    [39, "2", "Selection and site delivery", 7, "Client & Design Head"],
  ] },
  { code: "7b", name: "Flooring", lane: "main", tasks: [
    [41, "1", "Site Condition Check", 2, "Site Supervisor"],
    [42, "2", "Drawing", 2, "Designer"],
    [43, "3", "Drawing approval", 1, "Design Head/ Admin"],
    [44, "4", "Client Presentation & approval", 1, "Client"],
    [45, "5", "Site Execution", 5, "Tile person"],
    [46, "6", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "8", name: "Ceiling_1", lane: "parallel", anchor: { stageCode: "7b", row: 41 }, tasks: [
    [41, "1", "Drawing", 2, "Designer"],
    [42, "2", "Ceiling channelling", 2, "POP Person"],
  ] },
  { code: "9a", name: "Carpentering_Wall", lane: "parallel", anchor: { stageCode: "7b", row: 43 }, tasks: [
    [43, "1", "Presentation", 2, "Designer"],
    [45, "2", "Selection and site delivery", 7, "Client & Design Head"],
  ] },
  { code: "9b", name: "Carpentering_Wall", lane: "main", tasks: [
    [47, "1", "Site Condition Check", 1, "Site Supervisor"],
    [48, "2", "Drawing", 4, "Designer"],
    [49, "3", "Drawing approval", 1, "Design Head/ Admin"],
    [50, "4", "Client Presentation & approval", 1, "Client"],
    [51, "5", "Site Execution", 20, "Carpenter"],
    [52, "6", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "10", name: "Wall POP", lane: "parallel", anchor: { stageCode: "9b", row: 47 }, tasks: [
    [47, "1", "Drawing", 1, "Designer"],
    [48, "2", "Wall POP", 4, "POP Person"],
  ] },
  { code: "11a", name: "Carpentering_Furniture", lane: "parallel", anchor: { stageCode: "9b", row: 49 }, tasks: [
    [49, "1", "Drawings & Presentation", 8, "Designer"],
    [50, "2", "Approval", 6, "Design Head/ Admin"],
    [51, "2", "Selection and site delivery", 15, "Client & Design Head"],
  ] },
  { code: "11b", name: "Carpentering_Furniture", lane: "main", tasks: [
    [53, "1", "Site Condition Check", 1, "Site Supervisor"],
    [54, "2", "Client Presentation & approval", 1, "Client"],
    [55, "3", "Site Execution", 20, "Carpenter"],
    [56, "4", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "12a", name: "Corian, Profile Works, Fabrics & Misc", lane: "parallel", anchor: { stageCode: "11b", row: 53 }, tasks: [
    [53, "1", "Site Check", 2, "Site Supervisor"],
    [54, "2", "Presentation", 8, "Designer"],
    [55, "3", "Approval", 2, "Design Head/ Admin"],
    [56, "4", "Purchase / Vendor final", 12, "Client"],
  ] },
  { code: "12b", name: "Corian, Profile Works, Fabrics & Misc", lane: "main", tasks: [
    [57, "1", "Site Execution", 5, "Tile person"],
    [58, "2", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "13a", name: "Painting", lane: "parallel", anchor: { stageCode: "12b", row: 57 }, tasks: [
    [57, "1", "Presentation", 8, "Designer"],
    [58, "2", "Approval", 2, "Design Head/ Admin"],
  ] },
  { code: "13b", name: "Painting", lane: "main", tasks: [
    [59, "1", "Site Execution", 5, "Tile person"],
    [60, "2", "Final check", 2, "Design Head/ Admin"],
  ] },
  { code: "14", name: "Final Check", lane: "main", tasks: [
    [61, "1", "Approval", 5, "Client & Design Head/ Admin"],
  ] },
];

function stageNames(sheetStages) {
  const counts = new Map();
  for (const stage of sheetStages) counts.set(stage.name, (counts.get(stage.name) || 0) + 1);
  // "Plumbing Work" appears as 6a (parallel drawings) and 6b (main lane); the code keeps them apart.
  return new Map(sheetStages.map((stage) => [stage.code, counts.get(stage.name) > 1 ? `${stage.name} (${stage.code})` : stage.name]));
}

function taskNames(stages) {
  const titleCounts = new Map();
  for (const stage of stages) for (const task of stage.tasks) titleCounts.set(task.title, (titleCounts.get(task.title) || 0) + 1);
  const plain = (stage, task) => (titleCounts.get(task.title) > 1 ? `${stage.name} — ${task.title}` : task.title);
  const plainCounts = new Map();
  for (const stage of stages) for (const task of stage.tasks) plainCounts.set(plain(stage, task), (plainCounts.get(plain(stage, task)) || 0) + 1);
  // Fall back to the coded stage name only when the plain stage name still leaves a clash.
  return (stage, task) => (plainCounts.get(plain(stage, task)) > 1 ? `${stage.displayName} — ${task.title}` : plain(stage, task));
}

function orderGroups(tasks) {
  const groups = [];
  for (const task of tasks) {
    const last = groups.at(-1);
    if (last && last[0].order === task.order) last.push(task);
    else groups.push([task]);
  }
  return groups;
}

function definition(fields) {
  return {
    workflowId: WORKFLOW_ID,
    templateVersion: WORKFLOW_ID,
    required: 'Yes',
    milestone: 'No',
    gateType: '',
    audience: 'internal',
    predecessors: [],
    ...fields,
  };
}

// Exported for tests: builds the graph for any stage list in the STAGES shape.
export function sheetPlanDefinitions(sheetStages) {
  const displayNames = stageNames(sheetStages);
  let sequence = 0;
  const stages = sheetStages.map((stage) => ({
    ...stage,
    displayName: displayNames.get(stage.code),
    tasks: stage.tasks.map(([row, order, title, durationDays, role]) => ({ row, order, title, durationDays, role, sequence: (sequence += 10) })),
  }));
  const nameFor = taskNames(stages);
  const byCode = new Map(stages.map((stage) => [stage.code, stage]));
  const edges = (tasks, type) => tasks.map((task) => ({ sequence: task.sequence, type }));

  const rows = [];
  let previousMainTail = [];
  for (const stage of stages) {
    const groups = orderGroups(stage.tasks);
    let entry = [];
    if (stage.lane === 'main') {
      entry = edges(previousMainTail, 'FS');
      previousMainTail = groups.at(-1);
    } else {
      const anchorStage = byCode.get(stage.anchor.stageCode);
      // Every anchor row in INTERIOR 1 matches a main-lane task exactly. The fallbacks mirror the web projection.
      const anchorTask = anchorStage.tasks.find((task) => task.row === stage.anchor.row)
        || anchorStage.tasks.filter((task) => task.row <= stage.anchor.row).at(-1)
        || anchorStage.tasks[0];
      entry = [{ sequence: anchorTask.sequence, type: 'SS' }];
    }
    groups.forEach((group, index) => {
      const predecessors = index === 0 ? entry : edges(groups[index - 1], 'FS');
      for (const task of group) {
        const role = task.role || DEFAULT_ROLE;
        rows.push(definition({
          sequence: String(task.sequence),
          stage: stage.displayName,
          taskName: nameFor(stage, task),
          durationDays: task.durationDays === null ? '' : task.durationDays,
          defaultRole: role,
          audience: role === 'Client' ? 'client' : 'internal',
          predecessors: predecessors.map((edge) => ({ ...edge, sequence: String(edge.sequence) })),
          phase: DESIGN_STAGE_CODES.has(stage.code) ? 'Design' : 'Site',
          trade: stage.name,
        }));
      }
    });
  }
  return rows;
}

export function interiorSheetDefinitions() {
  return sheetPlanDefinitions(STAGES);
}

export function interiorSheetTuples() {
  return interiorSheetDefinitions().map((step) => [
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
