/** Assignment coordination shared by capture, retries, and the dashboard. */
function createAssignmentService({ leadRepo, sheetSync, logger }) {
  let queue = Promise.resolve();
  function enqueue(operation) {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  }

  async function ensureAssignment(lead) {
    if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
    if (lead.assignedSalesperson) return lead;
    const existing = await sheetSync.findLeadByPhone(lead.phoneNumber);
    const preferred = existing?.salesperson || null;
    const salespeople = preferred ? [] : await sheetSync.getSalespeople();
    return leadRepo.assignRoundRobin(lead.id, salespeople, preferred);
  }

  async function syncCurrent(id) {
    const lead = await ensureAssignment(await leadRepo.findById(id));
    const result = await sheetSync.appendLead(lead);
    return leadRepo.completeAssignmentSync(lead, result.salesperson);
  }

  function syncLead(lead) {
    // Read the latest DB row inside the queue to avoid retrying an old assignee.
    return enqueue(() => syncCurrent(lead.id));
  }

  function reassign(id, name) {
    return enqueue(async () => {
      const lead = await leadRepo.findById(id);
      if (!lead) throw Object.assign(new Error('Lead not found'), { statusCode: 404 });
      const salespeople = await sheetSync.getSalespeople({ refresh: true });
      const selected = salespeople.find((person) => person.toLowerCase() === name.trim().toLowerCase());
      if (!selected) throw Object.assign(new Error('Choose a salesperson from the spreadsheet dropdown'), { statusCode: 400 });
      let updated = await leadRepo.update(id, {
        assignedSalesperson: selected, assignmentSyncPending: true, assignmentError: null,
      });
      try {
        updated = await syncCurrent(id);
      } catch (error) {
        logger.error('Assignment saved; spreadsheet sync pending', { leadId: id, error: error.message });
        updated = await leadRepo.update(id, { assignmentSyncPending: true, assignmentError: error.message });
      }
      return updated;
    });
  }

  async function refreshFromSheet(leads) {
    if (leads.length === 0) return leads;
    try {
      const assignments = await sheetSync.getAssignments();
      return await Promise.all(leads.map((lead) => enqueue(async () => {
        const current = await leadRepo.findById(lead.id);
        if (!current || current.assignmentSyncPending) return { ...lead, ...current };
        const selected = assignments.get(sheetSync.phoneKey(current.phoneNumber));
        if (selected && selected !== current.assignedSalesperson) {
          const updated = await leadRepo.completeAssignmentSync(current, selected);
          return { ...lead, ...updated };
        }
        return { ...lead, ...current };
      })));
    } catch (error) {
      logger.warn('Could not refresh spreadsheet assignments', { error: error.message });
      return leads;
    }
  }

  return { syncLead, reassign, refreshFromSheet };
}

module.exports = { createAssignmentService };
