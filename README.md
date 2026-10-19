# Hirnbert 🧠

Kleine, verspielte Lern-PWA für Multiple-Choice-Fragen.

- Multiple-Choice mit Mehrfachauswahl. Eine Antwort zählt nur, wenn genau die richtigen Optionen gewählt sind.
- Leitner-System mit 5 Stufen: richtig → eine Stufe hoch (nächste Abfrage nach 1/3/7/21 Tagen), falsch → Stufe 1, kommt sofort wieder.
- Falsch beantwortete Fragen werden in derselben Lektion bis zu zweimal wiederholt und stehen danach unter „Fehler üben“ bereit.
- Der Fortschritt liegt in `localStorage` auf dem Gerät. Export/Import als JSON gibt es in den Einstellungen.
- Läuft offline (Service Worker) und lässt sich in Chrome über „Zum Startbildschirm hinzufügen“ installieren.

## Fragen aktualisieren

Die Fragen liegen nur verschlüsselt im Repo (`data.enc.json`, AES-GCM, Schlüssel per PBKDF2 aus einem Passwort), weil GitHub Pages öffentlich ist.

```sh
HIRNBERT_PASSWORT='...' python3 tools/build_data.py <ordner-mit-kapitel-yamls>
```

Erwartet werden Dateien `kapitel_*.yaml` mit `kapitel`, `titel` und einer Liste `fragen` (`nr`, `frage`, `antworten`, `korrekt`, optional `loesung`/`erklaerung`) sowie optional `infoboxen`.

Benötigt `pyyaml` und `cryptography`. Danach `CACHE` in `sw.js` hochzählen, damit installierte Apps die neue Version sicher bekommen.

## Lokal starten

```sh
python3 -m http.server 8000
```

## Lizenz

Der Quellcode steht unter der [MIT-Lizenz](LICENSE). Die verschlüsselten Fragen in `data.enc.json` sind davon ausgenommen und nicht zur Weiterverwendung freigegeben.
