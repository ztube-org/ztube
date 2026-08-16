# Use server-authoritative playback control

ZTube will authorize each requested video on the server, allow only one leased playback session per child, and calculate usage from acknowledged active intervals. A browser-only timer would be simpler, but it could be bypassed by changing the video URL, opening another device, disabling reporting, or modifying client state; brief leased sessions therefore trade some network dependence for enforceable cross-device limits.

