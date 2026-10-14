chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PLAY_SOUND" || sender.id !== chrome.runtime.id) return false;
  const audio = document.getElementById("alertAudio");
  audio.currentTime = 0;
  audio.play().then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false, error: "Reprodução de áudio bloqueada." }));
  return true;
});
