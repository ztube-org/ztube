# Bind Approved Content to configurable Time Pools

> The day-scoped Episode Claim behavior is superseded by ADR 0012. Time Pool bindings remain in effect.

The Admin wants separate budgets for ordinary videos, cartoons and learning, with the ability to add more pools and bind YouTube sources individually. Replace fixed buckets with per-Child Time Pools; preserve existing budgets and usage as General videos, Learning and Cartoons presets. Individual video bindings outrank playlists, which outrank channels; conflicting bindings at the same priority block playback so changing entry routes cannot select a more generous pool.

Cartoon Pool membership continues to require an Episode Claim regardless of entry route and uses the cartoon library's selected pool. Claims count distinct episodes across claim-required content, while repeated watching consumes that pool's minutes. Historical usage stays in the pool where it was spent; Viewing Windows, Required Breaks and Viewing Pause remain global. This supersedes ADR 0009's fixed third bucket while preserving its independent cartoon allowance by default; legacy bucket fields remain compatibility projections during migration.
