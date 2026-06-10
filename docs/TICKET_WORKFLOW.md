# Ticket Workflow

How ideas become shipped features in this project. The flow is built on plain
GitHub issues + labels, so it works without any external tooling.

```
Idea → Triage → Ready for dev → In progress → In review (PR) → Sign-off → Closed
```

## Stages & labels

| Stage | Label | Who | What happens |
|---|---|---|---|
| 1. Capture | `status: triage` | anyone | Every idea/bug/TODO becomes an issue immediately (use the issue templates). No quality bar — capturing beats forgetting. |
| 2. Review & refine | `status: triage` → `status: ready-for-dev` | product owner | Review the issue: clarify scope, write/adjust acceptance criteria, set a `prio:` label. Switching the label to `status: ready-for-dev` **is the handover to development.** Close with `not planned` if rejected. |
| 3. Development | `status: in-progress` | developer | Assign yourself, switch the label, branch off `master` as `<type>/<issue-number>-short-name` (e.g. `fix/3-correct-signal`). Reference the issue in commits. |
| 4. PR review | `status: in-review` | developer + reviewer | Open a PR using the PR template, link the issue with `Refs #N` (**not** `Closes #N` — the issue must stay open for sign-off). Review happens on the PR; merge when approved. |
| 5. Sign-off | `status: sign-off` | product owner | After merge, the developer switches the issue label to `status: sign-off`. The product owner verifies the result against the acceptance criteria and **closes the issue as the formal sign-off** (comment what was checked). Reopen → back to `status: in-progress` if it fails. |

## Label reference

**Status (exactly one per open issue):**
`status: triage` · `status: ready-for-dev` · `status: in-progress` · `status: in-review` · `status: sign-off`

**Type:** `bug` · `enhancement` · `refactor` · `polish`

**Area:** `area: trains` · `area: tiles` · `area: traffic-lights` · `area: depot` · `area: pathfinding`

**Priority (set during triage):** `prio: high` · `prio: normal` · `prio: low`

## Conventions

- **Code TODOs**: a `// TODO` in code is a parking spot, not a backlog. When one
  survives the PR it came from, turn it into an issue and reference the issue
  number in the comment (`// TODO(#12): ...`).
- **One issue, one PR** where possible. Split big issues during triage.
- **Filtering**: the review queue is
  [`label:"status: triage"`](https://github.com/Cyclodex/train-game/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3A+triage%22),
  the dev queue is
  [`label:"status: ready-for-dev"`](https://github.com/Cyclodex/train-game/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3A+ready-for-dev%22).

## Optional: project board

If you prefer a Kanban view, create a GitHub Project (repo → Projects → New
project → Board) with one column per status label and an automation that
mirrors the labels. The labels stay the source of truth, so the board is
optional and can be added anytime.
