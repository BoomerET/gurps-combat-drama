/**
 * Pure GURPS 4e injury/fatigue threshold logic. No Foundry globals here, so it
 * can be unit tested outside Foundry.
 *
 * Rules references (Basic Set, Fourth Edition):
 *   Major wound: a single injury greater than 1/2 HP ............ p. B420
 *   Lost HP: < 1/3 HP, 0 HP or less, each -N×HP, -5×HP .......... p. B419
 *   Lost FP: < 1/3 FP, 0 FP or less, -1×FP ...................... p. B426
 */

/** Higher number = more dramatic. Only the most severe event of a change is played. */
export const SEVERITY = {
  dead: 100,
  deathCheck: 90,
  collapse: 80,
  majorWound: 70,
  fatigueCollapse: 65,
  reeling: 50,
  exhausted: 45,
  veryTired: 30,
};

const isNum = v => typeof v === "number" && Number.isFinite(v);

/**
 * How many full multiples of HP below zero `hp` is.
 * 0 HP → 0, -1×HP → 1, -2×HP → 2. Positive HP → -1.
 */
function negativeMultiple(hp, max) {
  return hp <= 0 ? Math.floor(-hp / max) : -1;
}

/** Events caused by an HP change from `oldHP` to `newHP`. Healing never triggers anything. */
export function detectHpEvents(oldHP, newHP, maxHP) {
  if (!isNum(oldHP) || !isNum(newHP) || !isNum(maxHP) || maxHP <= 0) return [];
  if (newHP >= oldHP) return [];
  if (oldHP <= -5 * maxHP) return []; // already dead: no more drama

  const events = [];
  if (oldHP - newHP > maxHP / 2) events.push("majorWound");
  if (newHP < maxHP / 3 && oldHP >= maxHP / 3) events.push("reeling");
  if (newHP <= 0 && oldHP > 0) events.push("collapse");

  const oldM = negativeMultiple(oldHP, maxHP);
  const newM = negativeMultiple(newHP, maxHP);
  if (newM >= 5 && oldM < 5) events.push("dead");
  else if (newM >= 1 && newM > oldM) events.push("deathCheck");

  return events;
}

/** Events caused by an FP change from `oldFP` to `newFP`. Recovery never triggers anything. */
export function detectFpEvents(oldFP, newFP, maxFP) {
  if (!isNum(oldFP) || !isNum(newFP) || !isNum(maxFP) || maxFP <= 0) return [];
  if (newFP >= oldFP) return [];

  const events = [];
  if (newFP < maxFP / 3 && oldFP >= maxFP / 3) events.push("veryTired");
  if (newFP <= 0 && oldFP > 0) events.push("exhausted");
  if (newFP <= -maxFP && oldFP > -maxFP) events.push("fatigueCollapse");
  return events;
}

/** The single most severe event from a list, limited to the enabled ones. */
export function mostSevere(events, isEnabled = () => true) {
  let best = null;
  for (const e of events) {
    if (!isEnabled(e)) continue;
    if (best === null || (SEVERITY[e] ?? 0) > (SEVERITY[best] ?? 0)) best = e;
  }
  return best;
}
