# Ticket Workflow

How ideas become shipped features in this project. The flow is built on plain
GitHub issues + labels, so it works without any external tooling.

```
Idea → Triage → Ready for dev → In progress → In review (PR) → Done
```

## Stages & labels

| Stage | Label | Who | What happens |
|---|---|---|---|
| 1. Capture | `status: triage` | anyone | Every idea/bug/TODO becomes an issue immediately (use the issue templates). No quality bar — capturing beats forgetting. |
| 2. Review & refine | `status: triage` → `status: ready-for-dev` | product owner | Review the issue: clarify scope, write/adjust acceptance criteria, set a `prio:` label. Switching the label to `status: ready-for-dev` **is the handover to development.** Close with `not planned` if rejected. |
| 3. Development | `status: in-progress` | developer | Assign yourself, switch the label, branch off `master` as `<type>/<issue-number>-short-name` (e.g. `fix/3-correct-signal`). Reference the issue in commits. |
| 4. PR review & sign-off | `status: in-review` | developer + reviewer | Open a PR using the PR template, link the issue with `Closes #N`. The review verifies the acceptance criteria; **approving and merging is the sign-off** — the issue closes automatically. Found a problem after merge? Reopen the issue → back to `status: in-progress`. |

## Label reference

**Status (exactly one per open issue):**
`status: triage` · `status: ready-for-dev` · `status: in-progress` · `status: in-review`

**Type:** `bug` · `enhancement` · `refactor` · `polish`

**Area:** `area: trains` · `area: tiles` · `area: traffic-lights` · `area: depot` · `area: pathfinding`

**Priority (set during triage):** `prio: high` · `prio: normal` · `prio: low`

**Model (set during triage, optional):** `model: opus` for complex/architectural
tickets · `model: haiku` for trivial mechanical ones · no label = Sonnet (default).
The implement workflow reads this to pick the Claude model.

## Conventions

- **Code TODOs**: a `// TODO` in code is a parking spot, not a backlog. When one
  survives the PR it came from, turn it into an issue and reference the issue
  number in the comment (`// TODO(#12): ...`).
- **One issue, one PR** where possible. Split big issues during triage.
- **Filtering**: the review queue is
  [`label:"status: triage"`](https://github.com/Cyclodex/train-game/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3A+triage%22),
  the dev queue is
  [`label:"status: ready-for-dev"`](https://github.com/Cyclodex/train-game/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3A+ready-for-dev%22).

## Automation (Claude Code GitHub Action)

Stages 3–4 are automated via workflows in `.github/workflows/`:

- **`claude-implement.yml`** — adding `status: ready-for-dev` to an issue is the
  handover: Claude implements it on a `<type>/<number>-<name>` branch, runs
  lint + unit tests, opens a PR (`Closes #N`) and moves the labels along.
- **`claude-review.yml`** — every opened PR gets a first-pass review with
  inline comments against the issue's acceptance criteria.
- **`claude.yml`** — mention `@claude` in any issue/PR comment to request
  changes during review (e.g. "@claude address the review comments").

One-time setup (repo admin): install the [Claude GitHub App](https://github.com/apps/claude),
run `claude setup-token` locally (uses your Claude Pro/Max subscription) and add
the generated token as a `CLAUDE_CODE_OAUTH_TOKEN` secret under
Settings → Secrets → Actions. Runs then consume subscription limits, not API credits.
Triage (stage 2) and PR approval/merge (stage 4) stay human on purpose.

Note: PRs opened by the action don't re-trigger other workflows
(`github-actions` actor), so the auto-review won't fire on Claude's own PRs —
review those yourself or comment `@claude review this PR`.

## Optional: project board

If you prefer a Kanban view, two sync workflows connect a GitHub Project board
to the status labels (labels remain the source of truth):

- **`project-handover.yml`** — dragging a card from *Triage* into *Ready for
  dev* applies `status: ready-for-dev`, which triggers the implement
  workflow. Polls every 5 minutes (Projects v2 has no "card moved" trigger);
  run it manually from the Actions tab if you don't want to wait.
- **`project-status-sync.yml`** — whenever a `status:` label changes, the
  card moves to the matching column, so the board follows Claude's progress.

One-time board setup:

1. Create a **Project (Board)** on your GitHub profile and link the repo.
2. Name the Status options exactly: `Triage`, `Ready for dev`, `In progress`,
   `In review`, `Done`.
3. In the project's built-in workflows, enable **Auto-add** for this repo's
   issues (set status `Triage`) and **Item closed → Done**.
4. Add a repo **variable** `PROJECT_NUMBER` (the number in the project URL)
   under Settings → Secrets and variables → Actions → Variables.
5. Add a **secret** `PROJECT_SYNC_TOKEN`: a classic personal access token with
   `repo` + `project` scopes. (The default workflow token can't access
   Projects, and labels it applies wouldn't trigger other workflows.)

Until `PROJECT_NUMBER` is set, both sync workflows skip silently, so the
board is opt-in.
