# Development principles

How we build in this repo, framed through the working style Andrej Karpathy
advocates for AI-assisted development: **make the feedback loop tight,
automatic, and deterministic, and let evals — not vibes — say whether a change
is good.** None of this is new ceremony; it names what the architecture and the
ticket workflow already push you toward, so a human or an agent can follow the
same path.

This complements, and does not replace, [`CLAUDE.md`](../CLAUDE.md) (the
architecture map) and [`docs/TICKET_WORKFLOW.md`](TICKET_WORKFLOW.md) (how issues
become merged PRs).

## 1. Evals are the spec

> *"Eval is all you need."*

A feature isn't done when the code runs once — it's done when something
**re-runnable** proves it works, in isolation, forever after.

- **Every feature ships a `/test` scenario.** One file in
  `src/levels/test/scenarios/`, registered in the `DOMAINS` tree in
  `src/levels/test/index.ts`. A mechanic on a 3-tile map is far easier to reason
  about — and to screenshot — than the same mechanic buried in `DEFAULT_LEVEL`.
  Adding or meaningfully changing a mechanic without a scenario is incomplete
  work.
- **The registry is guarded, not trusted.**
  `tests/unit/levels/testScenarios.spec.ts` validates every scenario's *level*
  (connectivity, route reachability, trains-in-depots, grid fit);
  `tests/unit/levels/scenarioCoverage.spec.ts` guards the *registry tree* (no
  empty picker nodes, every scenario reachable, no scenario pinned to a game
  mode that no longer exists). Both run in the fast CI, so a broken or orphaned
  scenario fails the build.
- **Render is an eval too.** `tests/e2e/scenarios.spec.ts` sweeps every scenario
  in a real browser and fails if one crashes at render time or logs a console
  error. This is the robust form of visual regression — see §5.

## 2. Small, verifiable steps — and the gates that verify them

> *Keep each change small enough that you can tell, quickly and cheaply, whether
> it's right.*

Run the cheapest sufficient gate after each change; reach for the next only when
the change warrants it:

| Gate | Command | Catches |
|---|---|---|
| Type-check + build | `npm run build` | the fastest correctness check (vue-tsc) — runs in CI |
| Lint | `npm run lint` | style + correctness lint — `lint:nofix` runs in CI |
| Unit | `npm run test:unit` | the headless sim + coordinate math + the scenario registry |
| Render sweep / e2e | `npm run test:e2e` | scenarios that boot but crash on render (needs a browser) |
| Visual | `npm run shot -- <id>` | what a change *looks* like (see §5) |

**CI is the backstop, not the first line.** `.github/workflows/ci.yml` runs
lint + `npm run build` (type-check) + unit tests on every PR. The build step is
deliberate: vue-tsc is the project's fastest correctness check, so type errors
must not pass CI green.

## 3. Context engineering over prompt cleverness

> *Most of the leverage is in what's in the context window, not in how cleverly
> you ask.*

[`CLAUDE.md`](../CLAUDE.md) is the curated context — the architecture, the
data-driven tile model, the conventions and the gotchas (`markRaw` the sim, the
"fraight" spelling, coordinate conventions). Keep it accurate: when you change an
invariant, update `CLAUDE.md` in the same PR. A stale map is worse than none,
for a human and an agent alike. The per-subsystem design notes under `docs/` and
`docs/superpowers/specs/` are the deeper context you pull in on demand.

## 4. The autonomy slider

> *Dial up autonomy as trust grows; keep a human in the loop where the cost of
> being wrong is high.*

[`docs/TICKET_WORKFLOW.md`](TICKET_WORKFLOW.md) **is** the autonomy slider:

- `status: ready-for-dev` hands a ticket to the **automated implement
  pipeline** — full autonomy, it branches and opens a PR.
- `status: in-progress` is the **mutex**: whoever (pipeline *or* a session)
  flips it first owns the ticket. Never build a ticket that's already
  `in-progress`/`in-review`, and never set a ticket `ready-for-dev` *and* build
  it yourself — that's the double-work trap.
- High-cost / architecturally significant changes pull the slider back toward a
  human: ambiguous review feedback or a large refactor is a question to ask, not
  a guess to ship.

## 5. Determinism makes verification possible

> *A reproducible system is one you can actually evaluate.*

The whole architecture is built for this and you should preserve it:

- The **simulation is authoritative, headless and deterministic** (`src/sim/*`,
  plain TS): it advances on a fixed `step(dt)` tick, so the same inputs give the
  same run. The renderer only draws state — movement decisions never live in
  animation callbacks.
- **Seeds, not randomness in disguise.** Procedural levels (`generateLevel`),
  colour assignment (`colorSeed`) and road routing take explicit seeds, so a
  scenario can pin a determined outcome (e.g. a depot-mismatch bounce).
- **Visual checks are intentional, not flaky.** `npm run shot -- <id>` produces
  a tight, reproducible PNG with the debug overlay off (`--debug` opts back in
  when the driving-lines are the point). A visual *fix* PR carries
  a before/after pair (see `docs/TICKET_WORKFLOW.md` → Visual verification). We
  deliberately do **not** pixel-diff in CI: cross-machine font/antialiasing
  differences make that flaky, and a flaky gate trains people to ignore red. The
  render sweep (§1) asserts the robust invariant instead — *did it render
  without erroring* — and humans review the actual pixels via `shot`.

## 6. The loop runs anywhere

Claude Code on the web starts each session in a fresh container with no
`node_modules`, so the gates above couldn't run. `.claude/hooks/session-start.sh`
(registered in `.claude/settings.json`) installs dependencies on session start
in remote sessions, so build/lint/test are runnable from the first step. It's
idempotent and only the shared config is checked in (`.claude/settings.local.json`
stays per-user).
