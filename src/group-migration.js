// Telegram migration IDs, never group titles, define the same group's identity.
export async function migrateTelegramGroup(store, fromId, toId, title) {
  const from=String(fromId),to=String(toId);
  if(!/^-\d+$/.test(from) || !/^-100\d+$/.test(to) || from===to)throw new Error('Invalid Telegram group migration.');
  const projects=await store.rows('Projects');
  const oldProject=projects.find(row=>String(row.GroupChatID)===from),newProject=projects.find(row=>String(row.GroupChatID)===to);
  if(oldProject && newProject && oldProject.ProjectID!==newProject.ProjectID)throw new Error('Both group IDs have bot projects. Review before merging.');
  const groups=await store.rows('GroupRegistry');
  const oldGroup=groups.find(row=>String(row.GroupChatID)===from);
  if(oldGroup?.MigratedTo && String(oldGroup.MigratedTo)!==to)throw new Error('Conflicting Telegram migration target.');
  await store.registerGroup(to,title || oldGroup?.GroupTitle || 'Telegram project');
  const members=await store.rows('GroupMembers');
  for(const row of members.filter(row=>String(row.GroupChatID)===from && row.MembershipStatus!=='Migrated')) {
    const current=members.find(member=>String(member.GroupChatID)===to && String(member.TelegramUserID)===String(row.TelegramUserID));
    if(current){
      const changes={};
      for(const key of ['AssignedName','AssignedRole'])if(!current[key] && row[key])changes[key]=row[key];
      if(Object.keys(changes).length)await store.updateRow('GroupMembers',current.rowNumber,changes);
      await store.updateRow('GroupMembers',row.rowNumber,{MembershipStatus:'Migrated'});
    }else await store.updateRow('GroupMembers',row.rowNumber,{GroupChatID:to});
  }
  for(const sheet of ['Projects','MemberOnboarding','DecisionRequests','SubmittedResources','Approvals']) {
    for(const row of (await store.rows(sheet)).filter(row=>String(row.GroupChatID)===from))await store.updateRow(sheet,row.rowNumber,{GroupChatID:to});
  }
  if(oldProject || newProject)await store.markGroupLinked(to);
  // Final marker is written last, so a failed intermediate step can be retried.
  if(oldGroup)await store.updateRow('GroupRegistry',oldGroup.rowNumber,{Status:'Migrated',MigratedTo:to});
  else await store.append('GroupRegistry',{GroupChatID:from,GroupTitle:title || 'Telegram project',Status:'Migrated',MigratedTo:to},{raw:true});
}
