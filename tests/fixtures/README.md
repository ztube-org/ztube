`native-video.mp4` is an original generated 240-second solid-color H.264 video without audio, used to exercise real browser metadata, seeking and native playback without a network dependency.

Regenerate with:

```sh
ffmpeg -f lavfi -i color=c=0x385975:s=160x90:r=1 -t 240 -c:v libx264 -pix_fmt yuv420p -movflags +faststart tests/fixtures/native-video.mp4
```

`hls/video.m3u8` and `hls/video.m4s` are an original 240-second H.264/AAC
solid-color and silent-audio HLS fixture. It uses fMP4 byte ranges to keep the
fixture small while testing actual decoding, resume, seeking and cleanup.

```sh
ffmpeg -f lavfi -i color=c=0x385975:s=160x90:r=2 -f lavfi -i anullsrc=r=48000:cl=stereo -t 240 -c:v libx264 -pix_fmt yuv420p -g 12 -c:a aac -b:a 16k -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags single_file tests/fixtures/hls/video.m3u8
```
