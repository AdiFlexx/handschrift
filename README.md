# Handschrift

Webseite, die getippten Text in meine Handschrift setzt und als echte GoodNotes-Tinte (`.goodnotes`) ausgibt –
gemacht fürs iPad: Text einfügen, Papier wählen (kariert, liniert schmal/groß · A4 oder GoodNotes-Format),
„In GoodNotes öffnen“.

- Läuft komplett im Browser, nichts wird hochgeladen.
- Die Buchstaben-Bibliothek und die Papiervorlagen liegen verschlüsselt in `daten.bin` (AES-GCM, PBKDF2) –
  ohne Passwort ist die Seite nutzlos.
- Stichpunkte: `- Punkt`, `* Punkt`, `1. Punkt`; zwei Leerzeichen davor = Unterpunkt.

Das GoodNotes-Dateiformat ist nicht offiziell dokumentiert. Der Writer folgt
[InkLift](https://github.com/yellowHatpro/InkLift) (MIT), das Einlesen der Proben
[parser-for-goodnotes](https://github.com/Kaih1825/parser-for-goodnotes) (MIT).

Nach Änderungen an JS oder CSS die Version `?v=…` in `index.html` und bei den Imports in `app.js` erhöhen –
GitHub Pages lässt Dateien 10 Minuten im Cache, sonst passt die neue Seite nicht zum alten Programm.
