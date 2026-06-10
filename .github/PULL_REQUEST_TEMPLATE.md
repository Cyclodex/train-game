<!-- Merging closes the linked issue — approving the PR is the sign-off (see docs/TICKET_WORKFLOW.md). -->
Closes #

## What changed

## How to verify

<!-- Steps for the reviewer, mapped to the issue's acceptance criteria. -->

## Before / After

<!--
Visual change? Show a before/after of the affected /test scenario (debug overlay
on for lane/overlay/routing work). Capture with the committed helper and commit
the PNGs under docs/verify/issue-<N>/:

    npm run shot -- <scenarioId> --label before --out docs/verify/issue-<N>
    # …make the change…
    npm run shot -- <scenarioId> --label after  --out docs/verify/issue-<N>

Then embed them here (raw URLs), e.g.
![before](https://github.com/Cyclodex/train-game/raw/<branch>/docs/verify/issue-<N>/<scenarioId>-before.png)
![after](https://github.com/Cyclodex/train-game/raw/<branch>/docs/verify/issue-<N>/<scenarioId>-after.png)

Not visual? Write "N/A — not visible on the board". See docs/TICKET_WORKFLOW.md.
-->

## Checklist

- [ ] Issue label moved to `status: in-review`
- [ ] `npm run lint` passes
- [ ] `npm run test:unit` passes
- [ ] Visual change: before/after screenshots attached (or N/A — not visible on the board)
- [ ] Resolved code TODOs removed / remaining ones reference an issue
