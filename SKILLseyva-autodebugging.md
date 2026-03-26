---
name: autodebug
description: >
  AutoDebug — Autonomous debugging loop for Seyva Lab apps, adapted from Karpathy's
  AutoResearch pattern. An agent-driven cycle that hypothesizes, modifies code, runs
  evaluations, keeps fixes that pass, discards those that don't, and loops until the
  bug is resolved or all hypotheses are exhausted. Triggers on: autodebug, run the debug
  loop, autonomous debugging, fix this bug autonomously, debug loop, autoresearch for bugs,
  karpathy loop for debugging, persistent bug, flaky test, crash loop, regression hunt,
  "can't figure out this bug", "run experiments on this bug", "let it debug overnight",
  or any request to systematically debug a Seyva Lab app (Flip, Toma, or future apps)
  using an iterative autonomous agent approach. Also triggers when a developer is stuck
  on a bug after manual attempts and wants the agent to explore solutions systematically.
  Use this skill even if the user just says "autodebug this" or "run the loop on this error".
---

# AutoDebug — Autonomous Debugging Loop

Adapted from [Karpathy's AutoResearch](https://github.com/karpathy/autoresearch) pattern.
Core insight: **the human writes the debugging strategy, the agent executes the experiments.**

---

## THE PATTERN

AutoResearch has 3 files with strict roles:
- `prepare.py` — immutable evaluation harness (the "truth")
- `train.py` — the single file the agent modifies
- `program.md` — human-written strategy the agent follows

AutoDebug maps this to app debugging:
- **Evaluation harness** (immutable): test suite, build, lint, type-check
- **Mutable scope**: source files within the bug's blast radius
- **Strategy file**: `debug_program.md` — human defines the bug, constraints, hypotheses
- **Metric**: binary (all tests pass + build succeeds + no new errors) or graduated (error count reduction)

---

## WHEN TO USE

Use AutoDebug when:
1. A bug resists quick manual fixes (>15 min of human effort already spent)
2. The root cause is unclear and multiple hypotheses exist
3. A regression appeared and the exact commit is unknown
4. Flaky tests need systematic isolation
5. Performance degradation needs methodical profiling
6. The developer wants to "let the agent work on it" while they do something else

Do NOT use when:
- The fix is obvious (just fix it)
- The bug requires external service changes (API, backend not in repo)
- There are no tests or eval criteria (write tests first)

---

## SETUP PROTOCOL

### Step 1: Understand the bug
Before entering the loop, gather context. Read (don't skim):
- Error messages, stack traces, console output
- Recent git history (`git log --oneline -20`)
- Related test files
- The component/module where the bug manifests

### Step 2: Create `debug_program.md`
This is the human-authored strategy file. The agent reads it before every iteration.
Create it at project root (or `.autodebug/debug_program.md`).

Template — the human fills this in (or the agent drafts it for human approval):

```markdown
# Debug Program — [Bug Title]

## Bug Description
[What's broken. Be specific: what happens vs what should happen.]

## Reproduction
[Steps or command to reproduce. Must be automatable.]
- `npm test -- --testPathPattern="affected_test"`
- `npm run build`
- Or: `node scripts/repro.js`

## Evaluation Command
[The single command that determines success. This is your `prepare.py`.]
```bash
npm test -- --testPathPattern="affected" && npm run build && npm run lint
```

## Metric
- PRIMARY: All tests pass (exit code 0)
- SECONDARY: Build succeeds with zero warnings
- TERTIARY: No new TypeScript errors

## Mutable Scope
[Files the agent is ALLOWED to modify. Everything else is read-only.]
- `src/components/Canvas/`
- `src/hooks/useGLEffect.ts`
- `src/utils/shaderCompiler.ts`

## Immutable Files (DO NOT TOUCH)
- `package.json` (no dependency changes without human approval)
- `src/test/` (tests are the truth — don't modify tests to pass)
- Any file outside Mutable Scope

## Hypotheses (ranked by likelihood)
1. [Most likely cause] — shader compilation fails on specific GPU path
2. [Second guess] — race condition in effect initialization
3. [Third guess] — stale cache after hot reload
4. [Wild card] — upstream dependency regression

## Constraints
- Do NOT add new dependencies
- Do NOT change the public API of any component
- Do NOT modify test files
- Preserve all existing functionality (no regressions)
- Each experiment must be a single, reviewable git commit

## Time Budget
- Per experiment: [2 minutes] (build + test cycle)
- Max experiments: [30] before stopping for human review
- Max total time: [60 minutes]
```

### Step 3: Establish baseline
```bash
git checkout -b autodebug/[bug-tag]
# Run eval command, record baseline failures
# This is experiment 0 — the "before" snapshot
```

### Step 4: Create results log
Create `.autodebug/results.tsv`:
```
experiment	hypothesis	change_summary	tests_passed	tests_failed	build_ok	kept	timestamp
0	baseline	no changes	14	3	true	baseline	2026-03-26T10:00:00
```

---

## THE LOOP

```
REPEAT FOREVER (until success or budget exhausted):

1. READ debug_program.md (every iteration — the human may update it mid-run)
2. READ .autodebug/results.tsv (learn from past attempts)
3. SELECT next hypothesis or generate a new one based on evidence so far
4. ANALYZE relevant code in mutable scope
5. FORM a specific, testable change (one change per experiment)
6. APPLY the change
7. RUN evaluation command
8. RECORD results in results.tsv
9. DECIDE:
   - If ALL metrics pass → COMMIT, tag as fix, STOP (or continue for confirmation)
   - If metrics IMPROVED (fewer failures) → COMMIT, continue iterating
   - If metrics SAME or WORSE → REVERT (git checkout -- .), log what didn't work
10. If max experiments reached → STOP, summarize findings for human
```

### Key behaviors during the loop:

**Never ask for permission mid-loop.** The whole point is autonomous operation.
The human set the constraints in debug_program.md. Respect them and keep going.

**One change per experiment.** Like AutoResearch's single-variable approach.
If you change two things and tests pass, you don't know which fixed it.
If you change two things and tests fail, you don't know which broke it.

**Learn from failures.** Before each new experiment, review results.tsv.
If hypothesis 1 failed three different ways, move to hypothesis 2.
If a change made things worse in a specific way, that's diagnostic information.

**Commit meaningful changes.** Every kept change gets a descriptive commit:
```
autodebug: exp-07 — fix shader compilation null check in useGLEffect
  
  Hypothesis: race condition in effect initialization
  Change: Added null guard before gl.compileShader() call
  Result: tests_passed 15/17 → 17/17, build OK
```

**Escalate correctly.** If you discover the bug requires:
- Dependency changes → stop, document in results.tsv, flag for human
- Test modifications → stop, explain why tests may be wrong
- Architecture changes → stop, write a proposal in `.autodebug/proposal.md`

---

## EVALUATION HARNESS PATTERNS

The eval command must be deterministic and automatable. Common patterns:

### React Native (Flip)
```bash
# Full eval
npx jest --ci --forceExit && npx tsc --noEmit && npx eslint src/ --max-warnings 0

# Fast eval (during iteration)
npx jest --ci --testPathPattern="affected_module" --forceExit

# Build eval
npx react-native bundle --platform ios --dev false --entry-file index.js --bundle-output /tmp/test.bundle 2>&1
```

### Web app (Toma, future apps)
```bash
# Full eval
npm test -- --ci && npm run build && npm run lint

# Fast eval
npm test -- --ci --testPathPattern="affected" && npx tsc --noEmit
```

### Custom eval script
For complex bugs, write a one-off eval script:
```bash
# .autodebug/eval.sh — the agent runs this, never modifies it
#!/bin/bash
set -e
npm test -- --ci --testPathPattern="$1" 2>&1 | tee .autodebug/last_test.log
npm run build 2>&1 | tee .autodebug/last_build.log
# Custom check: verify no console.error in runtime
node -e "require('./src/sanityCheck.js')" 2>&1 | tee .autodebug/last_sanity.log
echo "EVAL_PASS"
```

---

## RESULTS ANALYSIS

After the loop completes (success or budget exhaustion), produce:

### Summary report (`.autodebug/report.md`)
```markdown
# AutoDebug Report — [Bug Title]

## Outcome: [FIXED / PARTIALLY_FIXED / UNRESOLVED]

## Stats
- Experiments run: 23
- Experiments kept: 5
- Experiments reverted: 18
- Time elapsed: 42 minutes
- Final metric: 17/17 tests passing, build OK

## What worked
- Exp 7: null guard on shader compilation (fixed 2 tests)
- Exp 12: async initialization order (fixed 1 test)
- Exp 19: cache invalidation on hot reload (fixed remaining test)

## What didn't work (and why it's useful)
- Exp 1-3: Dependency version changes — not the cause
- Exp 5: Memoization — actually made race condition worse (informative)
- Exp 14: Error boundary — masked the bug, didn't fix it

## Remaining concerns
- [Any tech debt introduced]
- [Tests that should be added]
- [Areas that need human review]
```

---

## ADVANCED PATTERNS

### Bisect mode
When a regression exists in git history:
```
1. Run eval on HEAD (confirm failure)
2. Run eval on known-good commit (confirm success)
3. Binary search: test midpoint
4. Narrow to exact breaking commit
5. Analyze the diff
6. Fix based on understanding of what broke
```

### Flaky test isolation
```
1. Run the flaky test 10 times, record pass/fail ratio
2. Add timing instrumentation
3. Hypothesize: race condition? Network? State leak?
4. Isolate: run test in isolation vs in suite
5. Fix: address the non-determinism source
```

### Performance regression
```
Metric: execution time or memory usage (not binary pass/fail)
1. Profile baseline
2. Identify hot path
3. Hypothesize optimization
4. Apply, measure, keep/discard based on threshold
```

---

## INTEGRATION WITH CLAUDE CODE

Claude Code is the recommended agent for AutoDebug. Setup:

1. Open terminal in project root
2. Ensure `debug_program.md` exists (or ask Claude Code to draft it)
3. Launch:
```
claude "Read .autodebug/debug_program.md and start the autodebug loop.
Run the evaluation after each change. Log everything to .autodebug/results.tsv.
Do not ask me for permission — follow the constraints in the program file.
Stop after [30] experiments or when all tests pass."
```

### Claude Code permissions
In `.claude/settings.json`, allow:
```json
{
  "permissions": {
    "allow": [
      "npm test",
      "npx jest",
      "npx tsc",
      "npx eslint",
      "git commit",
      "git checkout",
      "node"
    ]
  }
}
```

---

## SAFETY RAILS

1. **Git branch isolation.** All work happens on `autodebug/*` branch. Main is untouched.
2. **Immutable eval.** The agent cannot modify test files or the eval script.
3. **Scoped mutations.** Only files listed in Mutable Scope can be changed.
4. **Budget limits.** Hard cap on experiments and wall-clock time.
5. **Revert-first.** Failed experiments are reverted before the next attempt.
6. **Human review.** The final diff is always reviewed by a human before merge.

---

## ANTI-PATTERNS

- **Don't modify tests to pass.** Tests are the truth. If tests are wrong, stop and flag.
- **Don't add dependencies.** Scope creep. If a dep is needed, stop and flag.
- **Don't make multi-variable changes.** One hypothesis per experiment.
- **Don't ignore reverted experiments.** They contain diagnostic information.
- **Don't loop past budget.** Diminishing returns. Stop, report, let the human redirect.
- **Don't chase symptoms.** If adding try/catch "fixes" the test but hides the bug, revert.

---

## SEYVA LAB CONVENTIONS

When running AutoDebug on Seyva Lab apps:
- Branch naming: `autodebug/[app]-[bug-slug]` (e.g., `autodebug/flip-shader-crash`)
- Results live in `.autodebug/` directory (gitignored on main, committed on debug branch)
- Final report goes to `.autodebug/report.md`
- Successful fixes get squash-merged with a clean commit message
- The `debug_program.md` is archived in `.autodebug/history/` for future reference

For Flip specifically:
- Shader/GL bugs: check both iOS and Android render paths
- Audio-reactive bugs: test with and without mic permission
- Canvas bugs: test at multiple aspect ratios
- Export bugs: test all output formats (image, video, GIF)

For Toma specifically:
- Claims system bugs: verify confidence labels and evidence grades
- Mobile-first: test at 375px viewport minimum
- Content rendering: verify markdown/rich text round-trips
