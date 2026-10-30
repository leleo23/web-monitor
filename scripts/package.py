"""Package only reviewed assets; no profiles, tokens or dependencies."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "manifest.json").read_text())["version"]
files = [
    "manifest.json", "background.js", "popup.html", "popup.js", "popup.css",
    "offscreen.html", "offscreen.js", "alert.wav", "icon16.png", "icon32.png",
    "icon48.png", "icon128.png", "src/core/detection.js", "src/core/storage.js",
    "src/core/insights.js", "src/core/sounds.js", "src/core/detector.js", "src/core/portable.js", "src/core/connectors.js", "sounds/bell.wav", "sounds/digital.wav",
    "sounds/critical.wav", "README.md",
    "CHANGELOG.md", "docs/PRIVACY.md", "docs/DEVELOPMENT.md", "docs/RC1-SYNC.md", "docs/DELIVERY-0.7.md", "docs/EMAIL-API.md", "docs/DELIVERY-0.8.md",
]
out = root / "dist"
out.mkdir(exist_ok=True)
archive = out / f"web-monitor-v{version}.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as package:
    for name in files:
        package.write(root / name, name)
print(archive)
