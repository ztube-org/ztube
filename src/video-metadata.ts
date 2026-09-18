// Read metadata without playing the file. No crossOrigin attribute is needed:
// signed download URLs can expose media metadata without allowing fetch CORS.
export function readVideoDuration(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    function cleanup() {
      video.removeEventListener('loadedmetadata', loaded)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
      video.removeAttribute('src')
      video.load()
    }
    function loaded() {
      const duration = Math.floor(video.duration)
      cleanup()
      if (Number.isFinite(duration) && duration > 0) resolve(duration)
      else reject(new Error('Unable to read this video’s duration.'))
    }
    function failed() {
      cleanup()
      reject(new Error('Unable to read this video. Check that Preview works, then retry.'))
    }
    function aborted() {
      cleanup()
      reject(new Error('Reading video details timed out. Retry to try again.'))
    }
    if (signal.aborted) { aborted(); return }
    signal.addEventListener('abort', aborted, { once: true })
    video.addEventListener('loadedmetadata', loaded, { once: true })
    video.addEventListener('error', failed, { once: true })
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url
    video.load()
  })
}
