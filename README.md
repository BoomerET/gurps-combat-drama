# GURPS Combat Drama

Short, scene-wide [FXMaster](https://github.com/gambit07/fxmaster) effects for the dramatic moments of a
[GURPS 4e Game Aid](https://github.com/crnormand/gurps) fight.

| Event | When it fires (Basic Set) | Effect |
| --- | --- | --- |
| Major wound | One injury of more than ½ HP (B420) | Hard screen shake, red flash |
| Reeling | Dropping below ⅓ HP (B419) | Light shake, faint red tint |
| 0 HP | Dropping to 0 HP or less (B419) | Shake, scene drains of color |
| Death check | Each new multiple of −1×HP (B419) | Violent shake, dark red |
| Death | Reaching −5×HP (B419) | Old-film sepia, grey-out |
| Very tired | Dropping below ⅓ FP (B426) | Slight desaturation |
| 0 FP | Dropping to 0 FP or less (B426) | Heavier desaturation |
| Fatigue collapse | Reaching −1×FP (B426) | Near grey-out |
| Critical success | Any targeted roll | Golden glow |
| Critical failure | Any targeted roll | Small shake, sickly purple |

If one change sets off several events (a single blow that is both a major wound and takes you below 0 HP),
only the most severe one plays. Healing and FP recovery never trigger anything.

## Requirements

- Foundry VTT 13 or 14
- GURPS 4e Game Aid 0.18 or later
- FXMaster 8 or later (FXMaster+ is **not** needed; only core filters are used)

## Install

In Foundry's **Add-on Modules** tab, click **Install Module** and paste this manifest URL:

```
https://github.com/BoomerET/gurps-combat-drama/releases/latest/download/module.json
```

## Install for testing

Copy the `gurps-combat-drama` folder into your Foundry data folder under `Data/modules/`, restart Foundry,
and enable **GURPS Combat Drama** in your GURPS world.

## Try it without a fight

Run this as a GM script macro (turn off **Only during combat** first, or start a combat):

```js
game.modules.get("gurps-combat-drama").api.play("majorWound");
```

`api.events` lists every event name.

## Settings

- **Only during combat** (on by default): effects only play while a combat is running on that scene.
- **Who triggers effects**: everyone, player characters only, or NPCs only.
- **Ignore hidden tokens** (on by default): wounds on hidden NPCs don't tip off players.
- **Intensity** and **Duration**: scale every effect.
- **Roll effect delay**: set about 2500 ms if you use Dice So Nice, so crit effects land after the dice settle.
- One switch per event.

## How it works

- **Wounds and fatigue.** The client making a change records the old HP/FP in `preUpdateActor` /
  `preUpdateToken`. The active GM's client compares it with the new values in `updateActor` /
  `updateToken` and checks the thresholds in `scripts/events.js`.
- **Criticals.** GURPS calls `GURPS.setLastTargetedRoll(chatdata, actorId, tokenId)` for every targeted roll and
  relays it to all clients. The module wraps that function and reads `chatdata.isCritSuccess` /
  `isCritFailure`. Blind rolls are skipped. (`GURPS.findTargetedRoll(messageId)` looks like the obvious hook,
  but in 0.18.24 the message id it searches for is never set, so it always comes back empty.)
- **Playing effects.** Only the active GM calls FXMaster, because its effects are stored on the scene and
  every client calling it would create duplicates. Each event uses fixed ids starting with `apiMacro_gcd_`,
  so a repeat replaces rather than stacks, and any left over after a GM reload are removed on startup.
- **Scene-wide.** FXMaster filters cover the whole scene, so everyone on it sees each effect.

## Customizing effects

Each event is a small recipe in `scripts/effects.js`: a list of FXMaster filters and how long to keep them.
Option names come from FXMaster's own filter definitions. To try different looks, set up a filter in
FXMaster's UI, save it as a macro, and copy its `options` into a recipe.

## License

MIT. GURPS is a trademark of Steve Jackson Games. This module is not official and is not endorsed by
Steve Jackson Games; it only cites Basic Set page numbers and contains no rules text.
