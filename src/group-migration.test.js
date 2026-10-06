import test from 'node:test';import assert from 'node:assert/strict';
import {migrateTelegramGroup} from './group-migration.js';
const fixture=()=>{
 const data={GroupRegistry:[{GroupChatID:'-123',GroupTitle:'Same name',rowNumber:2,Status:'Linked'},{GroupChatID:'-100456',GroupTitle:'Same name',rowNumber:3,Status:'Available'},{GroupChatID:'-999',GroupTitle:'Same name',rowNumber:4,Status:'Available'}],Projects:[{ProjectID:'P1',GroupChatID:'-123',rowNumber:2}],GroupMembers:[{GroupChatID:'-123',TelegramUserID:'1',AssignedName:'Founder',AssignedRole:'Founder',MembershipStatus:'Active',rowNumber:2},{GroupChatID:'-100456',TelegramUserID:'1',AssignedName:'',AssignedRole:'',MembershipStatus:'Active',rowNumber:3},{GroupChatID:'-123',TelegramUserID:'2',AssignedRole:'Designer',MembershipStatus:'Active',rowNumber:4}],SubmittedResources:[{SubmissionID:'RES--123-10',GroupChatID:'-123',rowNumber:2}]};
 const store={rows:async(name)=>data[name]||[],registerGroup:async()=>{},markGroupLinked:async(id)=>data.GroupRegistry.find(row=>row.GroupChatID===id).Status='Linked',append:async(name,row)=>data[name].push(row),updateRow:async(name,num,changes)=>Object.assign(data[name].find(row=>row.rowNumber===num),changes)};return{data,store};
};
test('Telegram upgrade carries project and roster, retains stable file IDs and is repeatable',async()=>{
 const {data,store}=fixture();await migrateTelegramGroup(store,'-123','-100456','Same name');await migrateTelegramGroup(store,'-123','-100456','Same name');
 assert.equal(data.Projects[0].GroupChatID,'-100456');assert.equal(data.GroupRegistry[0].MigratedTo,'-100456');assert.equal(data.GroupRegistry[0].Status,'Migrated');assert.equal(data.GroupRegistry[2].Status,'Available');
 assert.equal(data.GroupMembers[1].AssignedRole,'Founder');assert.equal(data.GroupMembers[0].MembershipStatus,'Migrated');assert.equal(data.GroupMembers[2].GroupChatID,'-100456');assert.equal(data.SubmittedResources[0].SubmissionID,'RES--123-10');assert.equal(data.SubmittedResources[0].GroupChatID,'-100456');
});
test('two bot projects or conflicting migration destinations stop before any writes',async()=>{
 const {data,store}=fixture();data.Projects.push({ProjectID:'P2',GroupChatID:'-100456'});await assert.rejects(migrateTelegramGroup(store,'-123','-100456','Same name'),/Both group IDs/);assert.equal(data.GroupRegistry[0].Status,'Linked');
});
