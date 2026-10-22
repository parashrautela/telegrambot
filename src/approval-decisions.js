// Both bot polling loops may receive the same decision at once.
const pending = new Set();
export async function decideApprovalOnce(id, decide, busy) {
  if (pending.has(id)) return busy();
  pending.add(id);
  try { return await decide(); } finally { pending.delete(id); }
}
