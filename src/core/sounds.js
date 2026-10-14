(function (root) {
  const sounds = Object.freeze({
    pulse: { name: "Pulse", file: "alert.wav" },
    bell: { name: "Bell", file: "sounds/bell.wav" },
    digital: { name: "Digital", file: "sounds/digital.wav" },
    critical: { name: "Critical", file: "sounds/critical.wav" }
  });
  root.WebMonitorSounds = sounds;
  if (typeof module !== "undefined" && module.exports) module.exports = sounds;
})(globalThis);
