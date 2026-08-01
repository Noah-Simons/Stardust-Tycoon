# Contributing to Stardust Tycoon

Thanks for wanting to help! This is a small, vanilla web game and we'd love help with bugs, balance, and content.

## How to get set up

1. **Fork** the repo on GitHub, then clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/Stardust-Tycoon.git
   cd Stardust-Tycoon
   ```
2. **Create a branch** for your change:
   ```bash
   git checkout -b fix/my-change
   ```
3. **Run it locally** — there is no build step and no dependencies:
   ```bash
   python3 -m http.server 8000
   ```
   Then open http://localhost:8000.

## Testing by hand

Since the game runs in a browser, most testing is manual:

- Open it in a browser and **click things** — mine, buy upgrades, prestige.
- Press **F12** (or Cmd+Option+I on Mac) to open the **browser console** and check for **errors or warnings**. A clean console is required before a PR can be merged.
- Use the **Reset Save** button (in the Stats panel) to start from a clean state and re-test.
- To keep a save while testing, note that progress lives in `localStorage`; Reset Save clears it.

## Opening a PR

- Keep changes focused. One logical change per PR is best.
- In the PR description, say **what changed, why, and how you tested it**.
- Confirm the game still loads with **no console errors**.

## Minimal dependencies, on purpose

The game itself is **plain HTML, CSS, and JavaScript** — no build step, no bundler, no npm.

The one exception is **Firebase** (Auth + Firestore), loaded from a CDN as an ES module for optional cross-device cloud saves. It is deliberately isolated in `cloud.js`, and the game must stay fully playable signed out, offline, and even if Firebase fails to load entirely. `game.js` never imports it — it only dispatches `stardust:dirty` and `stardust:milestone` events that `cloud.js` listens for.

> **PRs that add further dependencies, frameworks, or a build step will probably be turned down.** Staying near-vanilla is a core design decision, not an oversight. If you think a change genuinely requires one, open an issue first to discuss.

## Game balance

Balance is subjective and **Noah (the maintainer) decides**. If you change costs, rates, or rewards, include **one sentence explaining your reasoning** in the PR. "It felt more fun" or "numbers felt off" is fine — just say it.

## Code pointers

- Content lives in the `UPGRADES` and `ACHIEVEMENTS` arrays at the top of `game.js`. Adding an object there is usually all it takes to add content.
- The game loop and rendering live in the same file. Keep functions small and named clearly.
