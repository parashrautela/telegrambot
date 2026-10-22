export const rolesOf = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[,;|]/)).map(role => String(role).trim()).filter(Boolean))];
const key = role => { const value=String(role).toLowerCase().replace(/[^a-z0-9]/g, '');return value==='supervisor'?'sitesupervisor':value; };
export const hasRole = (value, role) => rolesOf(value).some(item => key(item) === key(role));
export const matchesRole = (value, role) => hasRole(value, role) || (key(role) === 'designheadadmin' && (hasRole(value, 'Founder') || hasRole(value, 'Design Head') || hasRole(value, 'Admin')));
export const roleText = value => rolesOf(value).join(', ');
export const isStaff = value => rolesOf(value).some(role => !hasRole(role, 'Client'));
