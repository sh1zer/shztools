# Trimming

**Trim** downloads a ≤480p copy of the whole video for the player to scrub.
**Download segment** then fetches only the range between the clamps. The
full-quality video is never downloaded to pick a timestamp.

Measured on a 10-minute 4K video:

| | time | bytes |
| --- | --- | --- |
| preview, whole video | 3s | 36 MiB |
| 15s segment, full quality | 30s | 25 MiB |
| whole video, full quality | 16s | 722 MiB |

## Fetch, then cut

`yt-dlp --download-sections` stream-copies, so its edges snap to keyframes. On
a real 4K download, asking for 30.000s starts the clip at 27.433s.

`clip` instead fetches a padded window and re-encodes the exact span out of it.
`ffmpeg -ss` seeks to a keyframe inside the pad, then decodes and discards to
the requested timestamp, which is frame-accurate. There is no stream-copy
option.

## Why yt-dlp fetches and ffmpeg cuts

ffmpeg can range-seek a remote URL, which would make the fetch and the cut one
step. But googlevideo throttles a plain sequential read to about 87 KiB/s —
317s for a 27 MiB format, measured — while yt-dlp's downloader runs at full
speed.

## Fallbacks

A host that cannot serve ranges makes yt-dlp exit 0 after writing a stub.
`clip` compares the fetched duration against the range it asked for and falls
back to downloading the whole video.

Quality presets are caps. A source with nothing below the cap yields its best
instead. The preview cap is `PREVIEW_HEIGHT` in
`web/src/tools/ytdlp/quality.ts`; the server takes a height and nothing else.
