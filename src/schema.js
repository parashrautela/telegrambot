import { residentialInteriorTuples } from './residential-interior.js';

export const SHEETS = {
  Projects: [
    'ProjectID', 'ProjectName', 'ClientName', 'Location', 'Status',
    'LeaderTelegramID', 'GroupChatID', 'StartDate', 'TargetEndDate', 'Notes',
  ],
  WorkflowTemplates: [
    'WorkflowID', 'Sequence', 'Stage', 'TaskName', 'DurationDays',
    'DefaultRole', 'PredecessorTemplateID', 'Required', 'Milestone',
    'DependencySequences', 'DependencyType', 'GateType', 'Audience', 'Phase', 'Trade', 'TemplateVersion',
  ],
  Tasks: [
    'TaskID', 'ProjectID', 'WorkflowID', 'TemplateID', 'Sequence', 'Stage',
    'TaskName', 'AssignedTelegramID', 'AssignedName', 'AssignedRole', 'Status',
    'PlannedStart', 'PlannedEnd', 'CurrentStart', 'CurrentEnd', 'DelayDays',
    'DelayReason', 'IssueText', 'ApprovalStatus', 'ReworkCycle',
    'PredecessorTaskID', 'CalendarEventID', 'LastUpdatedAt', 'LastUpdatedBy',
    'PredecessorTaskIDs', 'DependencyType', 'ForecastStart', 'ForecastEnd',
    'ActualStart', 'ActualEnd', 'GateType', 'Audience', 'Phase', 'Trade',
    'TemplateVersion', 'BlockedReason',
  ],
  Users: ['TelegramUserID', 'Name', 'Role', 'Active'],
  MemberOnboarding: [
    'OnboardingID', 'ProjectID', 'GroupChatID', 'TelegramUserID', 'TelegramName',
    'JoinedAt', 'Status', 'AssignedName', 'AssignedRole', 'ApprovedAt', 'ApprovedByTelegramID',
  ],
  ProjectResources: [
    'ResourceID', 'WorkflowID', 'ResourceType', 'Title', 'UrlOrFileId',
    'Description', 'SortOrder', 'Active',
  ],
  SubmittedResources: [
    'SubmissionID', 'ProjectID', 'TaskID', 'GroupChatID', 'TelegramUserID',
    'SubmittedByName', 'ResourceType', 'TelegramFileID', 'FileName', 'Caption', 'SubmittedAt',
  ],
  GroupRegistry: ['GroupChatID', 'GroupTitle', 'RegisteredAt', 'Status'],
  Approvals: [
    'ApprovalID', 'ProjectID', 'TaskID', 'RequestType', 'RequestedByTelegramID',
    'RequestedByName', 'Reason', 'DelayDays', 'Status', 'GroupChatID',
    'CreatedAt', 'DecidedAt', 'DecidedByTelegramID',
  ],
  AuditLog: [
    'AuditID', 'OccurredAt', 'ProjectID', 'TaskID', 'Action', 'OldValue',
    'NewValue', 'ActorTelegramID', 'ActorName', 'Source', 'Details',
  ],
  FileRevisions: [
    'RevisionID', 'ProjectID', 'TaskID', 'Stage', 'Version', 'FileName',
    'StorageRef', 'UploaderRole', 'Audience', 'ApprovalState', 'ParentRevisionID', 'UploadedAt',
  ],
  ReviewDecisions: [
    'DecisionID', 'ProjectID', 'TaskID', 'RevisionID', 'Stage', 'Outcome',
    'ReviewerRole', 'ReviewerName', 'Comments', 'DecidedAt',
  ],
};

export const HOUSE_WORKFLOW = [
  ['HOUSE-V1', 5, 'Resources', 'Collect project plans, photos and client documents', 1, 'Client', '', 'Yes', 'No'],
  ['HOUSE-V1', 10, 'Discovery', 'Site assessment and measurement', 2, 'Architect', '5', 'Yes', 'No'],
  ['HOUSE-V1', 20, 'Planning', 'Client brief, budget and scope approval', 3, 'Client', '10', 'Yes', 'Yes'],
  ['HOUSE-V1', 30, 'Design', 'Concept design and layout', 5, 'Designer', '20', 'Yes', 'No'],
  ['HOUSE-V1', 40, 'Design', 'Architectural drawings', 7, 'Architect', '30', 'Yes', 'No'],
  ['HOUSE-V1', 50, 'Approval', 'Client design approval', 2, 'Client', '40', 'Yes', 'Yes'],
  ['HOUSE-V1', 60, 'Procurement', 'Material selection and procurement plan', 5, 'Designer', '50', 'Yes', 'No'],
  ['HOUSE-V1', 70, 'Construction', 'Site preparation', 3, 'Site Supervisor', '60', 'Yes', 'No'],
  ['HOUSE-V1', 80, 'Construction', 'Foundation work', 10, 'Site Supervisor', '70', 'Yes', 'No'],
  ['HOUSE-V1', 90, 'Construction', 'Structure and masonry', 20, 'Site Supervisor', '80', 'Yes', 'No'],
  ['HOUSE-V1', 100, 'Construction', 'Electrical and plumbing rough-in', 10, 'Site Supervisor', '90', 'Yes', 'No'],
  ['HOUSE-V1', 110, 'Construction', 'Waterproofing and plastering', 12, 'Site Supervisor', '100', 'Yes', 'No'],
  ['HOUSE-V1', 120, 'Finishes', 'Flooring, ceilings and painting', 15, 'Site Supervisor', '110', 'Yes', 'No'],
  ['HOUSE-V1', 130, 'Finishes', 'Joinery, fixtures and final installations', 12, 'Designer', '120', 'Yes', 'No'],
  ['HOUSE-V1', 140, 'Handover', 'Final inspection and snag resolution', 5, 'Architect', '130', 'Yes', 'No'],
  ['HOUSE-V1', 150, 'Handover', 'Client handover', 2, 'Client', '140', 'Yes', 'Yes'],
];

export const RESTORATION_WORKFLOW = [
  ['RESTORATION-V1', 5, 'Resources', 'Collect project plans, photos and client documents', 1, 'Client', '', 'Yes', 'No'],
  ['RESTORATION-V1', 10, 'Assessment', 'Existing-condition survey and measurements', 2, 'Architect', '5', 'Yes', 'No'],
  ['RESTORATION-V1', 20, 'Planning', 'Damage assessment, scope and budget approval', 3, 'Client', '10', 'Yes', 'Yes'],
  ['RESTORATION-V1', 30, 'Design', 'Restoration method and material selection', 4, 'Architect', '20', 'Yes', 'No'],
  ['RESTORATION-V1', 40, 'Protection', 'Protect retained finishes and salvage materials', 2, 'Site Supervisor', '30', 'Yes', 'No'],
  ['RESTORATION-V1', 50, 'Repair', 'Structural and surface repairs', 10, 'Site Supervisor', '40', 'Yes', 'No'],
  ['RESTORATION-V1', 60, 'Repair', 'Services repair and waterproofing', 7, 'Site Supervisor', '50', 'Yes', 'No'],
  ['RESTORATION-V1', 70, 'Finishes', 'Restore finishes, fixtures and details', 8, 'Site Supervisor', '60', 'Yes', 'No'],
  ['RESTORATION-V1', 80, 'Approval', 'Client restoration review', 2, 'Client', '70', 'Yes', 'Yes'],
  ['RESTORATION-V1', 90, 'Handover', 'Snag resolution and cleaning', 3, 'Site Supervisor', '80', 'Yes', 'No'],
  ['RESTORATION-V1', 100, 'Handover', 'Final handover', 1, 'Client', '90', 'Yes', 'Yes'],
];

export const PAINTING_WORKFLOW = [
  ['PAINTING-V1', 5, 'Resources', 'Collect project plans, photos and client documents', 1, 'Client', '', 'Yes', 'No'],
  ['PAINTING-V1', 10, 'Assessment', 'Site inspection, measurements and colour brief', 1, 'Designer', '5', 'Yes', 'No'],
  ['PAINTING-V1', 20, 'Planning', 'Colour palette, finish and estimate approval', 2, 'Client', '10', 'Yes', 'Yes'],
  ['PAINTING-V1', 30, 'Preparation', 'Surface protection, repair and putty work', 3, 'Painting Contractor', '20', 'Yes', 'No'],
  ['PAINTING-V1', 40, 'Preparation', 'Primer application and sanding', 2, 'Painting Contractor', '30', 'Yes', 'No'],
  ['PAINTING-V1', 50, 'Execution', 'First paint coat', 2, 'Painting Contractor', '40', 'Yes', 'No'],
  ['PAINTING-V1', 60, 'Execution', 'Second coat and finish details', 2, 'Painting Contractor', '50', 'Yes', 'No'],
  ['PAINTING-V1', 70, 'Quality check', 'Touch-ups and quality inspection', 2, 'Site Supervisor', '60', 'Yes', 'No'],
  ['PAINTING-V1', 80, 'Approval', 'Client colour and finish approval', 1, 'Client', '70', 'Yes', 'Yes'],
  ['PAINTING-V1', 90, 'Handover', 'Final cleaning and handover', 1, 'Painting Contractor', '80', 'Yes', 'Yes'],
];

export const INTERIOR_WORKFLOW = [
  ['INTERIOR-V1', 5, 'Resources', 'Collect project plans, photos and client documents', 1, 'Client', '', 'Yes', 'No'],
  ['INTERIOR-V1', 10, 'Discovery', 'Site measurement and client lifestyle brief', 2, 'Designer', '5', 'Yes', 'No'],
  ['INTERIOR-V1', 20, 'Planning', 'Scope, budget and timeline approval', 3, 'Client', '10', 'Yes', 'Yes'],
  ['INTERIOR-V1', 30, 'Design', 'Concept, layout and mood board', 5, 'Designer', '20', 'Yes', 'No'],
  ['INTERIOR-V1', 40, 'Design', 'Detailed drawings and material schedule', 6, 'Designer', '30', 'Yes', 'No'],
  ['INTERIOR-V1', 50, 'Approval', 'Client design approval', 2, 'Client', '40', 'Yes', 'Yes'],
  ['INTERIOR-V1', 60, 'Procurement', 'Vendor finalisation and procurement', 5, 'Designer', '50', 'Yes', 'No'],
  ['INTERIOR-V1', 70, 'Execution', 'Civil, electrical and plumbing preparation', 8, 'Site Supervisor', '60', 'Yes', 'No'],
  ['INTERIOR-V1', 80, 'Execution', 'Carpentry and false ceiling', 12, 'Site Supervisor', '70', 'Yes', 'No'],
  ['INTERIOR-V1', 90, 'Execution', 'Finishes, furniture and installation', 10, 'Site Supervisor', '80', 'Yes', 'No'],
  ['INTERIOR-V1', 100, 'Handover', 'Styling, snag resolution and inspection', 3, 'Designer', '90', 'Yes', 'No'],
  ['INTERIOR-V1', 110, 'Handover', 'Client handover', 1, 'Client', '100', 'Yes', 'Yes'],
];

export const WORKFLOWS = {
  'HOUSE-V1': HOUSE_WORKFLOW,
  'RESTORATION-V1': RESTORATION_WORKFLOW,
  'PAINTING-V1': PAINTING_WORKFLOW,
  'INTERIOR-V1': INTERIOR_WORKFLOW,
  'RESIDENTIAL-INTERIOR-V1': residentialInteriorTuples(),
};

export function templateRecord(step) {
  const [
    WorkflowID, Sequence, Stage, TaskName, DurationDays, DefaultRole, PredecessorTemplateID, Required, Milestone,
    DependencySequences = '', DependencyType = '', GateType = '', Audience = '', Phase = '', Trade = '', TemplateVersion = '',
  ] = step;
  return {
    WorkflowID, Sequence, Stage, TaskName, DurationDays, DefaultRole, PredecessorTemplateID, Required, Milestone,
    DependencySequences, DependencyType, GateType, Audience, Phase, Trade, TemplateVersion,
  };
}

export const WORKFLOW_OPTIONS = [
  { id: 'HOUSE-V1', label: 'New home / construction', description: 'Full house-building workflow' },
  { id: 'RESTORATION-V1', label: 'Restoration', description: 'Repair and restore an existing property' },
  { id: 'PAINTING-V1', label: 'Painting & finishes', description: 'Painting-led refresh workflow' },
  { id: 'INTERIOR-V1', label: 'Interior renovation', description: 'Interior design and execution workflow' },
  { id: 'RESIDENTIAL-INTERIOR-V1', label: 'Residential interior (parallel)', description: 'Design first, then overlapping trades with approval and material gates' },
];
