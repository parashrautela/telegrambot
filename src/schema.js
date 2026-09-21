export const SHEETS = {
  Projects: [
    'ProjectID', 'ProjectName', 'ClientName', 'Location', 'Status',
    'LeaderTelegramID', 'GroupChatID', 'StartDate', 'TargetEndDate', 'Notes',
  ],
  WorkflowTemplates: [
    'WorkflowID', 'Sequence', 'Stage', 'TaskName', 'DurationDays',
    'DefaultRole', 'PredecessorTemplateID', 'Required', 'Milestone',
  ],
  Tasks: [
    'TaskID', 'ProjectID', 'WorkflowID', 'TemplateID', 'Sequence', 'Stage',
    'TaskName', 'AssignedTelegramID', 'AssignedName', 'AssignedRole', 'Status',
    'PlannedStart', 'PlannedEnd', 'CurrentStart', 'CurrentEnd', 'DelayDays',
    'DelayReason', 'IssueText', 'ApprovalStatus', 'ReworkCycle',
    'PredecessorTaskID', 'CalendarEventID', 'LastUpdatedAt', 'LastUpdatedBy',
  ],
  Users: ['TelegramUserID', 'Name', 'Role', 'Active'],
  MemberOnboarding: [
    'OnboardingID', 'ProjectID', 'GroupChatID', 'TelegramUserID', 'TelegramName',
    'JoinedAt', 'Status', 'AssignedName', 'AssignedRole', 'ApprovedAt', 'ApprovedByTelegramID',
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
};

export const HOUSE_WORKFLOW = [
  ['HOUSE-V1', 10, 'Discovery', 'Site assessment and measurement', 2, 'Architect', '', 'Yes', 'No'],
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
