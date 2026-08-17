# Retain daily aggregates without video history

> Superseded in part by ADR 0005, which permits bounded unfinished playback state.

ZTube will retain each child's restricted and allowance-exempt daily usage summaries for the lifetime of that child, while never storing per-video viewing history. This preserves longitudinal usage data and future reporting options without retaining a detailed record of what the child watched; deleting the child deletes all summaries rather than anonymizing or restoring them later.
