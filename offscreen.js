chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PLAY_SOUND" || sender.id !== chrome.runtime.id) return false;
  if (!["queue_change", "manual_test"].includes(message.reason)) return false;
  const sound = Object.hasOwn(WebMonitorSounds, message.soundId) ? WebMonitorSounds[message.soundId] : null;
  if (!sound || !Number.isFinite(message.volume) || message.volume < 0 || message.volume > 1) {
    sendResponse({ ok: false, error: "Som ou volume inválido." }); return false;
  }
  const audio = document.getElementById("alertAudio");
  audio.pause();
  audio.src = chrome.runtime.getURL(sound.file);
  audio.volume = message.volume;
  audio.currentTime = 0;
  audio.play().then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false, error: "Reprodução de áudio bloqueada." }));
  return true;
});
