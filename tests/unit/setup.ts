// ONE MACROTASK BOUNDARY PER TEST — the thing that keeps `npm run test:unit`
// from failing while every assertion passes.
//
// THE FAILURE, because it names nothing and is easy to misread: the run ends
// with `Test Files 75 passed`, `Tests 2173 passed`, and then
//
//     Unhandled Error: [vitest-worker]: Timeout calling "onTaskUpdate"
//     Errors  1 error
//
// and vitest exits 1. Green tests, red CI, and no test named as the culprit. It
// is not flaky infrastructure and it is not our assertions: it reproduces on
// `master` too, and it got likelier as this suite grew — the parking work
// roughly doubled the runtime and turned an occasional red into a reliable one.
//
// THE MECHANISM. The worker reports each finished test to the runner over
// birpc, whose timeout is a hardcoded 60s (`DEFAULT_TIMEOUT = 6e4` in vitest's
// bundle — there is no config knob for it, which is why this is a setup file and
// not a line in vitest.config.ts). The reply comes back over a MessagePort, and
// a MessagePort callback is a MACROTASK. Our sim tests are long, tight,
// allocation-free synchronous loops, and vitest chains synchronous test bodies
// through microtasks — so a worker can run for minutes without ever yielding to
// the macrotask queue. The reply sits there unread, the 60s timer fires, and the
// run is poisoned by a test that passed.
//
// Diagnosis worth keeping: it survives `--pool=forks` and
// `--no-file-parallelism`, which rules out cross-worker contention and points at
// one worker starving its own event loop.
//
// THE FIX. `setImmediate` is a macrotask, so awaiting one hands the loop back
// and lets any pending reply through. Once per test costs microseconds and
// scales with the suite instead of with any one file.
//
// This covers the gap BETWEEN tests. A single test that blocks for 60s on its
// own is still its own problem — see the long-run cases in
// `tests/unit/sim/parking.spec.ts`, which yield inside their loops and are split
// per map to stay well under the limit. If you add a multi-thousand-tick sim
// loop, do the same.
import { beforeEach } from "vitest";

beforeEach(async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
});
