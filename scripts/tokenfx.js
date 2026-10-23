/**
 * Token effects: a shake and color flash drawn on one token.
 * These only change how the token is drawn on this client (nothing is saved), so every client
 * plays them itself when the GM broadcasts an event.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** For an intensity k: shake size (fraction of a grid square), flash color and length (ms). */
export const TOKEN_RECIPES = {
  majorWound: k => ({ duration: 900, shake: clamp(0.08 * k, 0, 0.2), tint: 0xff2a2a }),
};

/** Mix two 0xRRGGBB colors by t (0 = a, 1 = b). */
function mix(a, b, t) {
  const ch = (c, s) => (c >> s) & 255;
  const lerp = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

const running = new Map();

/** Play a token effect on tokens of the scene this client is viewing. */
export function playTokenEffect(key, sceneId, tokenIds, { intensity = 1, durationScale = 1 } = {}) {
  const recipe = TOKEN_RECIPES[key];
  if (!recipe || !canvas?.ready || canvas.scene?.id !== sceneId) return;
  const { duration, shake, tint } = recipe(intensity);
  for (const id of tokenIds) {
    const token = canvas.tokens.get(id);
    if (token?.mesh) animate(token, duration * durationScale, shake * canvas.grid.size, tint);
  }
}

function animate(token, duration, amplitude, tint) {
  running.get(token.id)?.();

  const mesh = token.mesh;
  const baseX = mesh.position.x, baseY = mesh.position.y;
  const baseTint = Number(token.document.texture?.tint ?? 0xffffff);
  const start = performance.now();
  const ticker = canvas.app.ticker;

  const finish = () => {
    ticker.remove(step);
    running.delete(token.id);
    if (token.destroyed || mesh.destroyed) return;
    mesh.position.set(baseX, baseY);
    mesh.tint = baseTint;
    token.renderFlags.set({ refresh: true });
  };

  function step() {
    if (token.destroyed || mesh.destroyed) return finish();
    const t = (performance.now() - start) / duration;
    if (t >= 1) return finish();

    // Shake dies out over the effect; the flash comes in fast and fades slowly.
    const decay = 1 - t;
    const ms = performance.now() - start;
    mesh.position.set(
      baseX + Math.sin(ms * 0.09) * amplitude * decay,
      baseY + Math.sin(ms * 0.13 + 1) * amplitude * 0.5 * decay,
    );
    const flash = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    mesh.tint = mix(baseTint, tint, flash);
  }

  running.set(token.id, finish);
  ticker.add(step);
}
