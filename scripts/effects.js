/**
 * Effect recipes and playback through FXMaster's Effects API.
 * Every effect is a short, scene-wide flash: it is played, then stopped after its duration.
 */

/** All effects this module creates use this id prefix (FXMaster's API namespace is "apiMacro_"). */
export const ID_PREFIX = "apiMacro_gcd_";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Move a neutral value of 1 toward `target` by intensity k (k = 1 → target). Color filter range is 0..2. */
const toward1 = (target, k) => clamp(1 + (target - 1) * k, 0, 2);

/** Mix white toward a hex color by k (0 = white/no tint, 1 = full color). */
function tint(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const mix = c => Math.round(255 + (c - 255) * clamp(k, 0, 1));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return { value: "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1), apply: true };
}

const shake = (strength, seconds, k, speed = 0.6) => ({
  type: "screenShake",
  options: {
    timed: true,
    strength: clamp(strength * k, 0, 1),
    duration: seconds,
    speed,
    decay: 0.8,
  },
});

const color = ({ hex, saturation = 1, contrast = 1, brightness = 1, gamma = 1 }, k) => ({
  type: "color",
  options: {
    ...(hex ? { color: tint(hex, k) } : {}),
    saturation: toward1(saturation, k),
    contrast: toward1(contrast, k),
    brightness: toward1(brightness, k),
    gamma: toward1(gamma, k),
  },
});

const bloom = (k) => ({
  type: "bloom",
  options: { blur: clamp(3 * k, 0, 10), bloomScale: clamp(0.6 * k, 0, 1), threshold: 0.3 },
});

const oldfilm = (k) => ({
  type: "oldfilm",
  options: { sepia: clamp(0.6 * k, 0, 1), noise: clamp(0.4 * k, 0, 1), scratchDensity: clamp(0.4 * k, 0, 1) },
});

/**
 * Recipes: for an intensity k, the filters to play (top of stack first) and how long to keep them (ms).
 */
export const RECIPES = {
  majorWound: k => ({
    // Lighter than it would be alone: the wounded token also shakes and flashes red (tokenfx.js).
    duration: 1000,
    filters: [shake(0.3, 0.6, k, 0.7), color({ hex: "#ffb0b0", saturation: 1.1, contrast: 1.05 }, k)],
  }),
  reeling: k => ({
    duration: 1200,
    filters: [shake(0.2, 0.5, k), color({ hex: "#ff9d9d", saturation: 0.9 }, k)],
  }),
  collapse: k => ({
    duration: 2500,
    filters: [shake(0.35, 0.8, k), color({ saturation: 0.25, brightness: 0.75, contrast: 1.1 }, k)],
  }),
  deathCheck: k => ({
    duration: 2500,
    filters: [shake(0.8, 1.4, k, 0.8), color({ hex: "#b02020", saturation: 0.5, brightness: 0.7, contrast: 1.3 }, k)],
  }),
  dead: k => ({
    duration: 4000,
    filters: [oldfilm(k), color({ saturation: 0, brightness: 0.6, contrast: 1.2 }, k)],
  }),
  veryTired: k => ({
    duration: 1500,
    filters: [color({ saturation: 0.7, brightness: 0.9 }, k)],
  }),
  exhausted: k => ({
    duration: 2000,
    filters: [color({ saturation: 0.4, brightness: 0.8, gamma: 0.9 }, k)],
  }),
  fatigueCollapse: k => ({
    duration: 2500,
    filters: [color({ saturation: 0.2, brightness: 0.6 }, k)],
  }),
  critSuccess: k => ({
    duration: 1500,
    filters: [bloom(k), color({ hex: "#ffe08a", brightness: 1.15 }, k)],
  }),
  critFailure: k => ({
    duration: 1500,
    filters: [shake(0.3, 0.6, k), color({ hex: "#b48cff", saturation: 0.4, contrast: 1.3 }, k)],
  }),
};

export const EVENT_KEYS = Object.keys(RECIPES);

/** Build the FXMaster filter entries for an event, with stable ids so a repeat replaces rather than stacks. */
export function buildEvent(key, intensity = 1) {
  const recipe = RECIPES[key];
  if (!recipe) return null;
  const { duration, filters } = recipe(intensity);
  return {
    duration,
    filters: filters.map((f, i) => ({ ...f, id: `${ID_PREFIX}${key}_${i}_f` })),
  };
}

const timers = new Map();

/**
 * Play an event's flash on a scene, then stop it after its duration.
 * Must run on a client allowed to update the scene (the active GM).
 */
export async function playEvent(key, scene, { intensity = 1, durationScale = 1 } = {}) {
  const built = buildEvent(key, intensity);
  if (!built || !scene) return;

  const timerKey = `${scene.id}:${key}`;
  clearTimeout(timers.get(timerKey));

  const result = await FXMASTER.api.effects.play({ filters: built.filters, scene, skipFading: false });
  const ids = result?.filters?.length ? result.filters : built.filters.map(f => f.id);

  timers.set(
    timerKey,
    setTimeout(() => {
      timers.delete(timerKey);
      FXMASTER.api.effects
        .stop({ filters: ids, scene, skipFading: false })
        .catch(err => console.error("gurps-combat-drama | could not stop effect", err));
    }, built.duration * durationScale),
  );
}

/** Remove any of this module's effects left on scenes (e.g. the GM reloaded mid-flash). */
export async function cleanupLeftovers() {
  for (const scene of game.scenes) {
    const filters = scene.getFlag("fxmaster", "filters") ?? {};
    const ours = Object.keys(filters).filter(id => id.startsWith(ID_PREFIX));
    if (ours.length) await FXMASTER.api.effects.stop({ filters: ours, scene, skipFading: true });
  }
}
