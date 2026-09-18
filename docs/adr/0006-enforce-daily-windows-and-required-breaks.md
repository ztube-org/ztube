# Enforce daily Viewing Windows and Required Breaks without video history

ZTube will layer one recurring Viewing Window, a cross-bucket Break Cycle, and a current-Viewing-Day Viewing Pause on top of the existing allowances. Break progress is stored only as aggregate seconds and a break expiry, never as per-video or completed viewing history; this gives the Admin enforceable routine controls while preserving the privacy decision in ADR 0002 and the server-authoritative enforcement decision in ADR 0001.
