// The restock agent: Observe stock → Plan orders → Draft POs → Request approval → Log.
// Every quantity and dollar amount comes from the tested rules in planner.ts.
import { INGREDIENTS, SETTINGS, SUPPLIERS, getIngredient, getSupplier, offerFor } from "./data.ts";
import { formatCents, formatDollars } from "./money.ts";
import { endFinishedSpecials, suggestSpecial } from "./freshness.ts";
import { formatDay } from "./orders.ts";
import { planSimple, planSmart, itemState, type PlannedPo } from "./planner.ts";
import { describeLine, isApprovedSupplier, makeLine, needsApproval, sendPo, shippingFor } from "./purchasing.ts";
import { addLog, type AgentRun, type PurchaseOrder, type World } from "./sim.ts";

const RUN_HISTORY = 30;

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function createPo(world: World, planned: PlannedPo, extra: Partial<PurchaseOrder> = {}): PurchaseOrder {
  if (!isApprovedSupplier(planned.supplierId)) throw new Error(`Refusing to order from unapproved supplier ${planned.supplierId}`);
  world.counters.po += 1;
  const supplier = getSupplier(planned.supplierId);
  const po: PurchaseOrder = {
    id: `PO-${world.counters.po}`,
    supplierId: planned.supplierId,
    status: "draft",
    lines: planned.lines,
    subtotalCents: planned.subtotalCents,
    shippingCents: planned.shippingCents,
    totalCents: planned.totalCents,
    reasons: planned.reasons,
    createdDay: world.day,
    promisedDay: world.day + supplier.leadDays,
    arrivalDay: world.day + supplier.leadDays,
    needsApproval: needsApproval(planned.totalCents),
    savings: planned.savings,
    ...extra,
  };
  world.purchaseOrders.push(po);
  world.today.spendCents += po.totalCents;
  world.today.shippingCents += po.shippingCents;
  return po;
}

/** Sends an order that doesn't need a person, or files it for approval. */
function route(world: World, po: PurchaseOrder): "sent" | "awaiting" {
  if (po.needsApproval && !world.autoApproveAll) {
    po.status = "awaiting";
    const why = po.isBackup ? "it duplicates an open order, so only a person can send it" : `${formatCents(po.totalCents)} is over the ${formatDollars(SETTINGS.approvalThresholdCents)} approval limit`;
    addLog(world, "agent", `${po.id} needs your approval`, `${getSupplier(po.supplierId).name}: ${why}.`, po.id);
    return "awaiting";
  }
  po.approvedBy = po.needsApproval ? "same-day" : "auto";
  po.status = "approved";
  sendPo(world, po);
  const why = po.needsApproval ? "approved the same day (30-day comparison run)" : `under the ${formatDollars(SETTINGS.approvalThresholdCents)} limit, so it went out automatically`;
  addLog(world, "agent", `Sent ${po.id} to ${getSupplier(po.supplierId).name} (simulated)`, `${formatCents(po.totalCents)}, ${why}. Due ${po.promisedDay - world.day === 1 ? "tomorrow" : `in ${po.promisedDay - world.day} days`}.`, po.id);
  return "sent";
}

/** The supplier lets us know about a delay the day after the order goes out. */
function delayAnnounced(world: World, po: PurchaseOrder): boolean {
  return po.arrivalDay > po.promisedDay && world.day >= (po.sentDay ?? po.createdDay) + 1;
}

/**
 * Late deliveries: note them once, and if we'll run out before they show up, draft a backup
 * order from another approved supplier. A backup duplicates an open order, so it always waits
 * for a person.
 */
export function checkLateDeliveries(world: World): PurchaseOrder[] {
  const backups: PurchaseOrder[] = [];
  const late = world.purchaseOrders.filter((po) => po.status === "sent" && !po.isBackup && (po.promisedDay <= world.day || delayAnnounced(world, po)));
  for (const po of late) {
    const supplierName = getSupplier(po.supplierId).name;
    const known = delayAnnounced(world, po);
    if (po.lateNoticeDay === undefined) {
      po.lateNoticeDay = world.day;
      addLog(world, "agent", `${po.id} from ${supplierName} is late`, known
        ? `${supplierName} says it will arrive ${po.arrivalDay - po.promisedDay} days late: ${formatDay(po.arrivalDay)} instead of ${formatDay(po.promisedDay)}.`
        : `It was due ${po.promisedDay === world.day ? "this morning" : `${world.day - po.promisedDay + 1} days ago`} and hasn't arrived.`, po.id);
    }
    const daysUntilArrival = known ? po.arrivalDay - world.day : 2;
    const alreadyBackedUp = world.purchaseOrders.some((other) => other.isBackup && other.backupFor === po.id && other.status !== "rejected");
    if (alreadyBackedUp) continue;
    const alternatives = SUPPLIERS.filter((supplier) => supplier.approved && supplier.id !== po.supplierId).sort((a, b) => a.leadDays - b.leadDays);
    // At risk: would run out before the late order shows up (with a day to spare).
    const atRisk = po.lines.filter((line) => itemState(world, getIngredient(line.ingredientId)).daysLeft < daysUntilArrival + 1);
    if (atRisk.length === 0) continue;
    const backup = alternatives.find((supplier) => atRisk.every((line) => offerFor(supplier, line.ingredientId)))
      ?? alternatives.find((supplier) => atRisk.some((line) => offerFor(supplier, line.ingredientId)));
    if (!backup) {
      addLog(world, "agent", `No backup supplier for ${po.id}`, `${list(atRisk.map((line) => getIngredient(line.ingredientId).name.toLowerCase()))} may run out. Flagged for you.`, po.id);
      continue;
    }
    const uncovered = atRisk.filter((line) => !offerFor(backup, line.ingredientId));
    if (uncovered.length > 0) addLog(world, "agent", `No backup supplier for some of ${po.id}`, `${list(uncovered.map((line) => getIngredient(line.ingredientId).name.toLowerCase()))} may run out. Flagged for you.`, po.id);
    const lines = atRisk.filter((line) => offerFor(backup, line.ingredientId)).map((line) => {
      const state = itemState(world, getIngredient(line.ingredientId));
      const offer = offerFor(backup, line.ingredientId)!;
      // Enough to bridge until the late order arrives, plus safety stock.
      const packs = Math.max(1, Math.ceil((state.usage * (daysUntilArrival + SETTINGS.safetyDays) - state.onHand) / offer.packSize));
      return makeLine(world, backup.id, line.ingredientId, packs, "backup");
    });
    const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
    const shippingCents = shippingFor(backup, subtotalCents);
    const names = list(atRisk.map((line) => getIngredient(line.ingredientId).name.toLowerCase()));
    const soonest = Math.min(...atRisk.map((line) => itemState(world, getIngredient(line.ingredientId)).daysLeft));
    const created = createPo(world, {
      supplierId: backup.id, lines, subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents,
      reasons: [
        { rule: "Late delivery", text: `${po.id} from ${supplierName} is late${known ? ` (now due ${formatDay(po.arrivalDay)})` : ""}, and ${names} will run out in about ${soonest < 1 ? "under a day" : `${soonest.toFixed(1)} days`}.` },
        { rule: "Backup order", text: `${backup.name} can deliver in ${backup.leadDays} days. Enough to bridge the gap until the late order arrives.` },
        { rule: "Human in charge", text: "This duplicates an open order, which the agent may not send on its own. It needs your approval." },
      ],
      savings: { bulkCents: 0, shippingAvoidedCents: 0 },
    }, { isBackup: true, backupFor: po.id, needsApproval: true });
    addLog(world, "agent", `Drafted backup ${created.id} for late ${po.id}`, created.reasons.map((reason) => reason.text).join(" "), created.id);
    backups.push(created);
  }
  return backups;
}

export function runAgent(world: World): AgentRun {
  const logStart = world.log.length;
  endFinishedSpecials(world);
  const backups = checkLateDeliveries(world);
  const plan = world.policy === "smart" ? planSmart(world) : planSimple(world);
  const lowNames = plan.atReorderPoint.map((id) => getIngredient(id).name.toLowerCase());

  addLog(world, "agent", `Checked ${INGREDIENTS.length} items on the shelf`, lowNames.length === 0 ? "Nothing is at its reorder point." : `${lowNames.length} at or below the reorder point: ${list(lowNames)}.`);
  for (const note of plan.notes) addLog(world, "agent", "Skipped an order", note);
  for (const deferred of plan.deferred) addLog(world, "agent", "Deferred to next week", deferred.reason);

  const created: PurchaseOrder[] = [];
  for (const planned of plan.pos) {
    const po = createPo(world, planned);
    created.push(po);
    addLog(world, "agent", `Drafted ${po.id} for ${getSupplier(po.supplierId).name} (${formatCents(po.totalCents)})`, `${po.lines.map(describeLine).join("; ")}. ${po.reasons.map((reason) => reason.text).join(" ")}`, po.id);
  }
  const routed = [...backups, ...created].map((po) => route(world, po));
  const awaiting = [...backups, ...created].filter((po) => po.status === "awaiting");
  const sentCount = routed.filter((result) => result === "sent").length;

  // Freshness: suggest a "use it up" special when a batch is likely to expire before we use it.
  const previous = world.specialSuggestion;
  const suggestion = world.specialFor ? null : suggestSpecial(world);
  world.specialSuggestion = suggestion;
  if (suggestion && previous?.batchId !== suggestion.batchId) {
    addLog(world, "agent", `Suggests a “use it up” special before ${formatDay(suggestion.expiresDay)}`, suggestion.text);
  }

  const run: AgentRun = {
    day: world.day,
    observe: lowNames.length === 0 ? `Checked ${INGREDIENTS.length} items. All above their reorder points.` : `Checked ${INGREDIENTS.length} items. ${lowNames.length} at or below the reorder point.`,
    plan: plan.pos.length === 0 && backups.length === 0 ? "No orders needed tonight." : `${plan.pos.length + backups.length} ${plan.pos.length + backups.length === 1 ? "order" : "orders"} from ${new Set([...plan.pos, ...backups].map((po) => po.supplierId)).size} ${new Set([...plan.pos, ...backups].map((po) => po.supplierId)).size === 1 ? "supplier" : "suppliers"}${plan.deferred.length > 0 ? `, ${plan.deferred.length} deferred` : ""}.`,
    draft: created.length + backups.length === 0 ? "Nothing to draft." : [...backups, ...created].map((po) => `${po.id} · ${formatCents(po.totalCents)}`).join(", "),
    approval: awaiting.length > 0 ? `${awaiting.length} waiting for you. ${sentCount > 0 ? `${sentCount} sent automatically.` : ""}`.trim() : sentCount > 0 ? `${sentCount} under the ${formatDollars(SETTINGS.approvalThresholdCents)} limit, sent automatically.` : "Nothing to approve.",
    log: `${world.log.length - logStart} ${world.log.length - logStart === 1 ? "entry" : "entries"} written to the audit log.`,
    poIds: [...backups, ...created].map((po) => po.id),
    awaitingIds: awaiting.map((po) => po.id),
  };
  world.agentRuns.push(run);
  if (world.agentRuns.length > RUN_HISTORY) world.agentRuns.splice(0, world.agentRuns.length - RUN_HISTORY);
  return run;
}
