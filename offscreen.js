chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "PLAY_SOUND") return;

  const audio =
    document.getElementById("alertAudio");

  audio.currentTime = 0;
  audio.play().catch(() => {});
});
