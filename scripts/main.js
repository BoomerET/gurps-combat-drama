import { detectHpEvents, detectFpEvents, mostSevere } from "./events.js";
import { EVENT_KEYS, playEvent, cleanupLeftovers } from "./effects.js";
import { TOKEN_RECIPES, playTokenEffect } from "./tokenfx.js";

const MODULE_ID = "gurps-combat-drama";
const SOCKET = `module.${MODULE_ID}`;
const STASH = MODULE_ID; // key used to carry pre-update HP/FP in update options

const setting = key => game.settings.get(MODULE_ID, key);
const isActiveGM = () => !!game.users.activeGM?.isSelf;
const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const world = (key, type, def, extra = {}) =>
    game.settings.register(MODULE_ID, key, {
      name: `GCD.Settings.${key}.Name`,
      hint: `GCD.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      type,
      default: def,
      ...extra,
    });

  world("enabled", Boolean, true);
  world("combatOnly", Boolean, true);
  world("whoTriggers", String, "all", {
    choices: {
      all: "GCD.Settings.whoTriggers.all",
      players: "GCD.Settings.whoTriggers.players",
      npcs: "GCD.Settings.whoTriggers.npcs",
    },
  });
  world("skipHidden", Boolean, true);
  world("intensity", Number, 1, { range: { min: 0.25, max: 1.5, step: 0.05 } });
  world("durationScale", Number, 1, { range: { min: 0.5, max: 2, step: 0.1 } });
  world("rollDelay", Number, 0, { range: { min: 0, max: 5000, step: 250 } });

  for (const key of EVENT_KEYS) world(`event_${key}`, Boolean, true);
});

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Current HP/FP (value and max) from a GURPS actor. */
function readPools(actor) {
  const s = actor?.system ?? {};
  return { hp: s.HP?.value, hpMax: s.HP?.max, fp: s.FP?.value, fpMax: s.FP?.max };
}

/** Token documents for an actor on a given scene. */
function tokensOn(actor, scene) {
  if (actor.isToken) return actor.token?.parent === scene ? [actor.token] : [];
  return scene.tokens.filter(t => t.actorLink && t.actorId === actor.id);
}

/** Scenes where the actor has a token that players could be looking at. */
function scenesFor(actor) {
  if (actor.isToken) return actor.token?.parent ? [actor.token.parent] : [];
  const out = [];
  for (const scene of [game.scenes.active, canvas?.scene]) {
    if (scene && !out.includes(scene) && tokensOn(actor, scene).length) out.push(scene);
  }
  return out;
}

/** Apply the GM's filters (who, hidden tokens, combat only) for this actor on this scene. */
function shouldTrigger(actor, scene) {
  const who = setting("whoTriggers");
  if (who === "players" && !actor.hasPlayerOwner) return false;
  if (who === "npcs" && actor.hasPlayerOwner) return false;

  if (setting("skipHidden")) {
    const tokens = tokensOn(actor, scene);
    if (tokens.length && tokens.every(t => t.hidden)) return false;
  }

  if (setting("combatOnly")) {
    const inCombat = game.combats.some(c => c.started && (!c.scene || c.scene.id === scene.id));
    if (!inCombat) return false;
  }
  return true;
}

/** Play an event's token effect on every client (the sender doesn't receive its own socket message). */
function fireTokens(eventKey, scene, tokenIds) {
  if (!TOKEN_RECIPES[eventKey] || !tokenIds.length) return;
  const msg = {
    type: "tokenFx",
    key: eventKey,
    sceneId: scene.id,
    tokenIds,
    intensity: setting("intensity"),
    durationScale: setting("durationScale"),
  };
  game.socket.emit(SOCKET, msg);
  onSocket(msg);
}

function onSocket(msg) {
  if (msg?.type !== "tokenFx") return;
  playTokenEffect(msg.key, msg.sceneId, msg.tokenIds, msg);
}

function fire(eventKey, actor) {
  for (const scene of scenesFor(actor)) {
    if (!shouldTrigger(actor, scene)) continue;
    playEvent(eventKey, scene, {
      intensity: setting("intensity"),
      durationScale: setting("durationScale"),
    }).catch(err => console.error(`${MODULE_ID} | could not play ${eventKey}`, err));
    fireTokens(eventKey, scene, tokensOn(actor, scene).filter(t => !t.hidden).map(t => t.id));
  }
}

/* -------------------------------------------- */
/*  HP / FP changes                             */
/* -------------------------------------------- */

/**
 * Last HP/FP seen per actor, kept on the GM's client. Used when the updating client's
 * pre-update values did not arrive, and to ignore the same change reported twice
 * (unlinked tokens can report through both updateToken and updateActor).
 */
const lastSeen = new Map();

function touchesPools(changes) {
  const sys = changes?.system ?? changes?.delta?.system;
  return !!(sys && ("HP" in sys || "FP" in sys));
}

/** On the client making the change, remember the old values so the GM can compare. */
function stashOld(actor, changes, options) {
  if (!actor || !touchesPools(changes)) return;
  const { hp, fp } = readPools(actor);
  options[STASH] = { hp, fp };
}

function handleChange(actor, changes, options) {
  if (!actor || !isActiveGM() || !touchesPools(changes) || !setting("enabled")) return;

  const now = readPools(actor);
  const prev = options?.[STASH] ?? lastSeen.get(actor.uuid);
  const seen = lastSeen.get(actor.uuid);
  lastSeen.set(actor.uuid, { hp: now.hp, fp: now.fp });

  // Already handled this exact change through the other hook.
  if (seen && seen.hp === now.hp && seen.fp === now.fp) return;
  if (!prev) return;

  const events = [
    ...detectHpEvents(prev.hp, now.hp, now.hpMax),
    ...detectFpEvents(prev.fp, now.fp, now.fpMax),
  ];
  const key = mostSevere(events, e => setting(`event_${e}`));
  if (key) fire(key, actor);
}

Hooks.on("preUpdateActor", (actor, changes, options) => stashOld(actor, changes, options));
Hooks.on("preUpdateToken", (token, changes, options) => stashOld(token.actor, changes, options));

Hooks.on("updateActor", (actor, changes, options) => handleChange(actor, changes, options));
Hooks.on("updateToken", (token, changes, options) => {
  if (!token.actorLink) handleChange(token.actor, changes, options);
});

/** Seed known values for tokens on the scene, so the first hit of a session is detected. */
Hooks.on("canvasReady", () => {
  if (!isActiveGM()) return;
  for (const token of canvas.scene?.tokens ?? []) {
    const actor = token.actor;
    if (!actor || lastSeen.has(actor.uuid)) continue;
    const { hp, fp } = readPools(actor);
    lastSeen.set(actor.uuid, { hp, fp });
  }
});

/* -------------------------------------------- */
/*  Critical successes and failures             */
/* -------------------------------------------- */

/**
 * GURPS calls GURPS.setLastTargetedRoll(chatdata, actorId, tokenId) for every targeted roll
 * (skills, attacks, defenses) and relays it to all clients, so the GM sees every player's roll here.
 */
function wrapTargetedRolls() {
  const original = GURPS?.setLastTargetedRoll;
  if (typeof original !== "function" || original.__gcdWrapped) return;

  const wrapped = function (chatdata, actorid, tokenid, ...rest) {
    const result = original.call(this, chatdata, actorid, tokenid, ...rest);
    try {
      onTargetedRoll(chatdata, actorid, tokenid);
    } catch (err) {
      console.error(`${MODULE_ID} | roll handling failed`, err);
    }
    return result;
  };
  wrapped.__gcdWrapped = true;
  GURPS.setLastTargetedRoll = wrapped;
}

function onTargetedRoll(chatdata, actorid, tokenid) {
  if (!isActiveGM() || !setting("enabled") || !chatdata || chatdata.isBlind) return;

  const key = chatdata.isCritSuccess ? "critSuccess" : chatdata.isCritFailure ? "critFailure" : null;
  if (!key || !setting(`event_${key}`)) return;

  let actor = null;
  if (tokenid) {
    for (const scene of game.scenes) {
      const token = scene.tokens.get(tokenid);
      if (token) { actor = token.actor; break; }
    }
  }
  actor ??= game.actors.get(actorid);
  if (!actor) return;

  const delay = setting("rollDelay");
  if (delay > 0) setTimeout(() => fire(key, actor), delay);
  else fire(key, actor);
}

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  if (game.system.id !== "gurps") return;
  if (!globalThis.FXMASTER?.api?.effects) {
    ui.notifications.error(game.i18n.localize("GCD.Errors.NoFxmaster"));
    return;
  }

  wrapTargetedRolls();
  game.socket.on(SOCKET, onSocket);

  game.modules.get(MODULE_ID).api = {
    events: [...EVENT_KEYS],
    /**
     * Preview an effect: game.modules.get("gurps-combat-drama").api.play("majorWound")
     * Token effects play on the selected tokens.
     */
    play(key, { scene = canvas.scene, tokens = canvas.tokens.controlled } = {}) {
      if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("GCD.Errors.GMOnly"));
      if (!EVENT_KEYS.includes(key)) return ui.notifications.warn(`Unknown event "${key}". Try: ${EVENT_KEYS.join(", ")}`);
      fireTokens(key, scene, tokens.map(t => t.id));
      return playEvent(key, scene, { intensity: setting("intensity"), durationScale: setting("durationScale") });
    },
  };

  if (isActiveGM()) await cleanupLeftovers();
  log("ready");
});
