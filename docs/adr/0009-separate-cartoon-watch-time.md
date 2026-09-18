# Give Cartoon Pool playback its own time allowance

> Superseded by ADR 0010: cartoons retain an independent default allowance through a configurable Time Pool.

Cartoon Pool episodes use a third usage bucket, Cartoon Time, regardless of their Content Rule or entry route. The Admin needs to prevent repeated playback of a claimed episode from consuming the Child's ordinary Daily Allowance. Reusing Safety Cap would mix cartoons with allowance-exempt content, so Cartoon Time has its own daily minutes, defaulting to 30, and receives no ordinary Temporary Extensions or restricted unlocks.

Episode Claims continue to limit the number of distinct episodes for the current Viewing Day. Cartoon Time counts active wall-clock playback, including replays, through the existing atomic settlement, Active Playback lease, Daily Usage Summary and Viewing Events. Viewing Windows, Required Breaks and Viewing Pause still apply across all three buckets. Existing Content Rules remain stored and apply again if the Admin removes an episode from the pool; historical usage is not reclassified.

Migration 0022 preserves prior sessions and Viewing Events while expanding their allowed bucket values. Sessions whose bucket no longer matches the current catalog stop at their next authorization check and must be restarted.
