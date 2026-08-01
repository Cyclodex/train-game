---
name: Bug
about: Something behaves wrong in the game or the code
labels: ["bug", "status: triage"]
---

## What happens

<!-- Observed behaviour. -->

## What should happen

## Screenshot

<!--
REQUIRED if the bug is visible on the board (rendering, lanes, the debug
driving-line overlay, junctions, vehicles, signals, depots, trains).
Reproduce it on a /test scenario and attach the picture. The debug overlay is off
by default (it paints over the board); add --debug only if the bug is about
lanes/overlay/routing:

    npm run shot -- <scenarioId>     # writes screenshots/<scenarioId>.png

See docs/TICKET_WORKFLOW.md → "Visual verification". If the bug isn't visual,
write "N/A — not visible on the board".
-->

## How to reproduce

1. `npm run dev` → open the `/test/<scenarioId>` that shows it
2. ...

## Source / context (optional)

<!-- Code location (file + line) if known, e.g. from a TODO comment. -->
