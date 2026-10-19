# Hirnbert

Verspielte Lern-PWA (Vanilla JS, kein Build-Schritt, keine Abhängigkeiten im Browser). Läuft über GitHub Pages direkt aus `main` (Root): https://hkorte.github.io/hirnbert/

## Aufbau

- `index.html`: leere Hülle, alles rendert `app.js` in `#app`.
- `app.js`: die gesamte App, gegliedert in Abschnitte (State, Leitner, Crypto, Maskottchen, Screens, Events).
  - Screens werden per `innerHTML` neu gerendert (`renderHome`, `renderLesson`, `renderDone`, `renderSettings`, `renderLock`). Klicks laufen über Event-Delegation mit `data-action`, `data-opt`, `data-chapter`, `data-step`.
  - Benutzertexte immer mit `esc()` einsetzen.
  - Das Maskottchen `brain(mood, cls)` ist inline-SVG mit den Stimmungen `happy`, `sad`, `cheer`, `think`.
  - Zurück-Taste unter Android: Lektion und Einstellungen legen einen `history`-Eintrag an, `popstate` führt zur Übersicht.
- `style.css`: Farb-Tokens in `:root`, Schriften Fredoka (Überschriften) und Nunito (Text) von Google Fonts.
- `sw.js`: network-first mit Cache-Fallback. **`CACHE` hochzählen**, sobald sich Dateien aus `SHELL` ändern.
- `data.enc.json`: verschlüsselte Fragen (AES-GCM, PBKDF2-SHA256, Inhalt ist gzip-JSON). Wird nur von `tools/build_data.py` erzeugt, nie von Hand bearbeitet.
- `icons/`: `icon.svg` und die PNGs wurden aus `brain('happy')` generiert (gelber Hintergrund, mit Inkscape gerendert).

## Datenmodell

- Frage-ID: `"<kapitel>-<nr>"`, z. B. `"8-12"`. Die IDs sind die Schlüssel im gespeicherten Fortschritt, deshalb Nummerierung nicht ändern.
- Entschlüsselt: `{kapitel: [{nr, titel, fragen: [{nr, q, a: {buchstabe: text}, k: [richtige buchstaben], l?, e?}], infoboxen: [{nach, titel, text}]}]}`
- Fortschritt in `localStorage["hirnbert.v1"]`: `{cards: {id: {b, ok, bad, due, last}}, xp, days: {"YYYY-MM-DD": anzahl}, settings: {len, goal, sound}, lastExport}`. Das Passwort steht in `localStorage["hirnbert.pw"]`.
- Bei Formatänderungen muss alter Stand weiter laden (`loadState` füllt mit Defaults auf). Fortschritt der Nutzerin oder des Nutzers nie verwerfen.

## Lernlogik

- Leitner-Boxen 1–5, Intervalle in `INTERVAL_DAYS` (Box 2 → 1 Tag, 3 → 3, 4 → 7, 5 → 21). Ab Box 4 gilt eine Frage als gemeistert.
- Nur der erste Versuch pro Frage und Lektion verändert die Box und zählt fürs Tagesziel.
- Falsch beantwortet: Box 1, sofort fällig, wird in der Lektion bis zu `MAX_RETRIES` Mal wiederholt.
- Richtig ist eine Antwort nur, wenn genau die korrekten Optionen gewählt sind. Wie viele das sind, wird nicht verraten.

## Fragen neu bauen

```sh
HIRNBERT_PASSWORT="$(cat <passwortdatei>)" python3 tools/build_data.py <ordner-mit-kapitel-yamls>
```

Das Skript entfernt den Punkt am Ende jeder Antwort (außer nach Abkürzungen, siehe `ABBREVIATIONS`). Benötigt `pyyaml` und `cryptography`.

## Testen

- Lokal: `python3 -m http.server 8765`, dann im Browser öffnen.
- Bisher bewährt: Headless-Chrome (`/usr/bin/google-chrome`) mit `puppeteer-core`, installiert in einem Scratch-Ordner, nicht im Repo. Viewport 360–390 px, `isMobile: true`. Eine Lektion durchklicken, Screenshots ansehen, `pageerror` sammeln. Für Layout: alle Fragen per `page.evaluate` rendern (`Q` und `esc` sind global erreichbar) und auf `scrollWidth > clientWidth` prüfen.
- Klicks auf den Sticky-Button per `$eval(sel, e => e.click())`, weil `page.click` dort scheitert.
- Nach dem Push: `gh api repos/hkorte/hirnbert/pages/builds/latest` zeigt den Deploy-Status.

## Regeln

- Das Repo ist öffentlich: niemals Fragen im Klartext, YAML-Quellen oder Passwörter committen.
- Keine Build-Tools und kein Framework einführen, solange es nicht nötig ist. Die App soll aus statischen Dateien laufen.
- UI-Texte auf Deutsch, verspielter Ton, Hirnbert spricht in Du-Form.
