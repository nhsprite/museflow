# Write Command Foreshadow Status Design

Date: 2026-07-17

## Goal

Show both kinds of foreshadow information before chapter generation starts:

- the complete set of active foreshadows across all resolution policies;
- the existing hard obligations that must be resolved by the current act boundary.

The new summary must make the total active count visible without expanding every active
foreshadow into a long list.

## CLI Output

`printActProgress` will print a compact active-foreshadow summary immediately before the existing
act-boundary pressure output:

```text
  伏笔状态: 8 个未结（必须回收 3 / 建议自然回收 4 / 可保持开放 1）
  伏笔边界压力: 2 个 must_resolve 硬义务待回收
  必须回收伏笔:
    1. ...
    2. ...
```

The two lines intentionally use different scopes:

- `伏笔状态` counts every canonical foreshadow that is neither fulfilled nor waived.
- `伏笔边界压力` keeps its current meaning: unresolved `must_resolve` obligations that block the
  current act boundary.

When there are no active foreshadows, the summary is:

```text
  伏笔状态: 0 个未结
```

When `StoryMemory` is unavailable, the summary is:

```text
  伏笔状态: 未知（StoryMemory 不可用）
```

The existing boundary-pressure output remains unchanged in both cases.

## Data and Components

The implementation will reuse `groupActiveForeshadowsByPolicy` from
`src/story-memory/foreshadow-policy.ts`. That function already:

- resolves canonical foreshadows;
- excludes fulfilled foreshadows;
- excludes waived foreshadows;
- groups active entries into `must_resolve`, `should_resolve`, and `may_remain_open`.

A focused CLI formatter will turn those structured groups into the one-line status summary.
`printActProgress` will print that formatter's result before calling the existing
`formatActForeshadowBoundaryPressure`.

No prose matching, story-specific rules, checkpoint mutations, or changes to scheduling behavior
are involved.

## Compatibility

The change affects display only. It does not alter chapter generation, StoryMemory projection,
foreshadow selection, act-boundary enforcement, or the `status` and `info` command semantics.

Existing uncommitted work that adds completed-chapter foreshadow details in
`chapter-display.ts` and its tests must be preserved.

## Tests

Tests will be written before production changes and will verify that `printActProgress`:

1. prints the total active count and all three policy counts;
2. prints `0 个未结` for an empty StoryMemory;
3. prints an unavailable status for legacy state without StoryMemory;
4. continues to print the existing act-boundary pressure and hard-obligation details.

Targeted tests, type checking, and relevant formatting checks will be run after implementation.
