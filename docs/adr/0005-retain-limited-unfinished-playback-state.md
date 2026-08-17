# Retain limited unfinished playback state

ZTube will retain playback position for at most the ten most recently updated unfinished videos per Child so that playback can resume across visits and devices. Progress is created only after 30 seconds and removed after the video ends, reaches 90%, or has 30 seconds or less remaining. This supersedes ADR 0002's absolute prohibition on per-video state: the usability benefit of Continue Watching outweighs the privacy cost when the state is bounded, excludes completed viewing history, and is deleted with the Child.
