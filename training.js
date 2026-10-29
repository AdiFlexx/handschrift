// Schrift trainieren: Vorlage mit dem Apple Pencil schreiben, in Buchstaben zerlegen, prüfen, speichern.
// Gespeichert wird nur auf diesem Gerät (localStorage) und sofort beim Schreiben benutzt.

const X_HOEHE = new Set("acemnorsuvwxz");
const OHNE_UNTERLAENGE = new Set("abcdehiklmnorstuvwxzäöüßABCDEFGHIKLMNOPRSTUVWXYZÄÖÜ0123456789.:!?%€<>≤≥=+×±π∞");
const MEHRTEILIG = new Set("kKxXRHEFäöüÄÖÜ%=:;!?„“≤≥≈→±×π÷ij");
export const SPEICHER_EIGENE = "handschrift-eigene";

const WOERTER = ("Quelle Qualität Quark bequem Xylofon Taxi Hexe boxen Yacht Typ Hobby Pyramide jagen Jacke Projekt Joghurt " +
  "Zwölf Ärger Öl Übung Größe Straße Fuß süß Bär Höhle Müll Schwäche Völker Küche Chemie Charakter Nacht Hund Nebel " +
  "Vulkan Wolke Kiwi Fenster Klavier Gabel Pfeffer Zebra Zitrone Kompass Rhythmus Quiz Vogel Dachs Juwel Ozean Atom " +
  "Biologie Formel Physik Gleichung Energie Funktion Vektor Matrix Winkel Kreis Zahl Summe Produkt Quotient Wurzel " +
  "Integral Ableitung Grenzwert Prozent Dreieck Volumen Masse Dichte Kraft Welle Licht Elektron Zelle Enzym Hormon " +
  "Demokratie Verfassung Parlament Regierung Kanzler Partei Wahl Bürger Europa Geschichte Revolution Kaiser König " +
  "Jahrhundert Quellen Epoche Analyse These Argument Beispiel Fazit Einleitung Hauptteil Schluss Zusammenfassung").split(" ");
// Kurze Sätze mit seltenen Zeichen – im Zusammenhang schreibt es sich natürlicher als Buchstabenreihen.
const SAETZE = ["Quark und Joghurt", "Zwölf Boxer jagen Viktor", "Xaver mag Yoga", "Ein Typ im Taxi",
  "Jörg isst süßen Quark", "Öl, Äpfel und Übungen", "Qualle im Yachthafen", "Fünf Hexen boxen", "Mäxchen jongliert",
  "Quizfrage: Wer jagt?", "Juwelen im Pyjama", "Chemie-Klausur!", "Ja? Nein! Vielleicht.", "Bayern gegen Köln: 3:1",
  "Am 7. Juli um 9 Uhr", "Seite 48, Aufgabe 6", "Größe: 1,85 m", "Straße 25 in Jena", "Preis: 49 € (inkl.)",
  "Wie geht's? Gut!", "Xylofon und Quintett", "Pyramide in Ägypten", "Höhe 345 m, Tiefe 67 m", "Quentin übt Jazz",
  "Yvonne fährt Kajak", "Wo? Hier; dort.", "„Ja“, sagt Xenia.", "Ötzi und Überlingen", "Jaguar vs. Zebra",
  "Im Jahr 1989 und 2026", "Chor, Charme, Chaos", "Qual der Wahl", "Vögel über Würzburg"];
// Mathe: kleine Formeln auf der Grundlinie (ohne Hochzahlen und Wurzeln, die würden beim Zerlegen verschmelzen).
const FORMELN = ["a < b ≤ c", "x ≥ 0 und y > 1", "π ≈ 3,14", "A = π · r · r", "5 × 4 = 20", "f(x) = 3x + 7",
  "x → ∞", "α + β = 90°", "a ≠ b", "x = ±2", "20 % von 80", "(a + b) / 2", "Δx = 7 - 3", "β < α ≤ π",
  "1 ≈ 0,99", "y = 2x - 5", "x ≠ 0 → y > 0", "z = 8 : 4 = 2"];

export function eigeneLaden() {
  try { return JSON.parse(localStorage.getItem(SPEICHER_EIGENE)) ?? {}; } catch { return {}; }
}
function eigeneSpeichern(eigene) {
  try { localStorage.setItem(SPEICHER_EIGENE, JSON.stringify(eigene)); return true; } catch { return false; }
}

// Bibliothek + eigene Varianten zusammenführen.
export function mitEigenen(daten, eigene) {
  const glyphen = { ...daten.glyphen };
  for (const [c, liste] of Object.entries(eigene)) glyphen[c] = [...(glyphen[c] ?? []), ...liste];
  return { ...daten, glyphen };
}

function median(werte) {
  const s = [...werte].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

function schraeglage(striche, ersatz) {
  const werte = [];
  for (const s of striche) {
    for (let i = 1; i < s.length; i++) {
      let dx = s[i][0] - s[i - 1][0], dy = s[i][1] - s[i - 1][1];
      const l = Math.hypot(dx, dy);
      if (l < 1.5 || Math.abs(dy) < Math.abs(dx) * 1.5) continue;
      if (dy > 0) { dx = -dx; dy = -dy; }
      for (let k = 0; k < Math.max(1, Math.round(l)); k++) werte.push(dx / -dy);
    }
  }
  return werte.length > 20 ? Math.max(-0.2, Math.min(0.8, median(werte))) : ersatz;
}

function vereinfachen(pts, eps) {                           // Ramer-Douglas-Peucker
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / l;
    if (d > max) { max = d; idx = i; }
  }
  return max > eps ? [...vereinfachen(pts.slice(0, idx + 1), eps).slice(0, -1), ...vereinfachen(pts.slice(idx), eps)] : [a, b];
}

// Striche (Bildschirm-px) einer Vorlage in Buchstaben zerlegen. Liefert {ok, teile:[{c, glyphe}], meldung}.
export function zerlegen(striche, vorlage, { basis, xhHilfe, neigung }) {
  const zeichen = [...vorlage.replace(/\s+/g, "")];
  const nutzbar = striche.filter((s) => s.length);
  if (!nutzbar.length) return { ok: false, meldung: "Noch nichts geschrieben." };
  const tan = schraeglage(nutzbar, neigung);
  const gerade = (s) => s.map(([x, y]) => [x + (y - basis) * tan, y]);
  const iv = nutzbar.map((s) => { const xs = gerade(s).map(([x]) => x); return [Math.min(...xs), Math.max(...xs)]; });
  const eltern = nutzbar.map((_, i) => i);
  const wurzel = (i) => { while (eltern[i] !== i) i = eltern[i] = eltern[eltern[i]]; return i; };
  for (let i = 0; i < iv.length; i++) {
    for (let j = i + 1; j < iv.length; j++) {
      const ueber = Math.min(iv[i][1], iv[j][1]) - Math.max(iv[i][0], iv[j][0]);
      if (ueber > 0.45 * Math.max(1.5, Math.min(iv[i][1] - iv[i][0], iv[j][1] - iv[j][0]))) eltern[wurzel(i)] = wurzel(j);
    }
  }
  const map = new Map();
  nutzbar.forEach((_, i) => { const w = wurzel(i); map.set(w, [...(map.get(w) ?? []), i]); });
  let gruppen = [...map.values()].map((g) => ({ g, l: Math.min(...g.map((i) => iv[i][0])), r: Math.max(...g.map((i) => iv[i][1])) }))
    .sort((a, b) => a.l - b.l);

  if (gruppen.length > zeichen.length) {                    // dicht anstoßende Teile zusammenfassen (k, x, ä …)
    const n = gruppen.length, m = zeichen.length, best = new Map([["0,0", [0, null]]]);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const b0 = best.get(`${i},${j}`);
      if (!b0) continue;
      for (let k = 1; k <= 3 && i + k <= n; k++) {
        let kosten = b0[0];
        for (let t = 0; t < k - 1; t++) {
          const luecke = (gruppen[i + t + 1].l - gruppen[i + t].r) / xhHilfe;
          kosten += (luecke < 0.15 ? 0.2 : luecke * 4) * (MEHRTEILIG.has(zeichen[j]) ? 0.5 : 1);
        }
        const key = `${i + k},${j + 1}`;
        if (!best.has(key) || kosten < best.get(key)[0]) best.set(key, [kosten, [i, j, k]]);
      }
    }
    const ziel = best.get(`${n},${m}`);
    if (ziel && ziel[0] < 1.5) {
      const neu = [];
      let pos = [n, m];
      while (pos[0] || pos[1]) {
        const [i, j, k] = best.get(`${pos[0]},${pos[1]}`)[1];
        const teil = gruppen.slice(i, i + k);
        neu.unshift({ g: teil.flatMap((t) => t.g), l: teil[0].l, r: teil[teil.length - 1].r });
        pos = [i, j];
      }
      gruppen = neu;
    }
  }
  if (gruppen.length !== zeichen.length) {
    return { ok: false, meldung: `Ich habe ${gruppen.length} statt ${zeichen.length} Zeichen erkannt. Schreib bitte mit etwas mehr Abstand zwischen den Buchstaben.` };
  }

  const box = (g) => { const ys = g.g.flatMap((i) => nutzbar[i].map(([, y]) => y)); return [Math.min(...ys), Math.max(...ys)]; };
  const xh = median(gruppen.filter((_, i) => X_HOEHE.has(zeichen[i])).map((g) => box(g)[1] - box(g)[0])) ?? xhHilfe;
  const grund = median(gruppen.filter((_, i) => OHNE_UNTERLAENGE.has(zeichen[i])).map((g) => box(g)[1])) ?? basis;
  if (xh < 4) return { ok: false, meldung: "Die Schrift ist zu klein – bitte etwas größer schreiben." };
  const teile = gruppen.map((g, i) => {
    const norm = g.g.map((s) => vereinfachen(gerade(nutzbar[s]).map(([x, y]) => [(x - g.l) / xh, (y - grund) / xh]), 0.015)
      .map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]));
    return { c: zeichen[i], glyphe: { striche: norm, breite: Math.round((g.r - g.l) / xh * 1e4) / 1e4, typisch: 0.8, eigen: true } };
  });
  return { ok: true, teile, meldung: `${teile.length} Zeichen erkannt – tippe auf eins, um es nicht zu übernehmen.` };
}

// Vorlage wählen: immer Wörter, Sätze oder Formeln – bevorzugt mit Zeichen, von denen es wenige Varianten gibt.
export function vorlageWaehlen(zaehler, zufall = Math.random, zuletzt = "") {
  const wert = (text) => [...new Set(text.replace(/\s+/g, ""))].reduce((s, c) => s + 1 / Math.pow(1 + (zaehler[c] ?? 0), 1.5), 0)
    / Math.sqrt(text.replace(/\s+/g, "").length);
  const paare = Array.from({ length: 30 }, () => {
    const a = WOERTER[Math.floor(zufall() * WOERTER.length)], b = WOERTER[Math.floor(zufall() * WOERTER.length)];
    return a !== b && (a + b).length <= 18 ? `${a} ${b}` : a;
  });
  const pool = zufall() < 0.35 ? FORMELN : [...SAETZE, ...paare];   // meist Wörter/Sätze, ab und zu Mathe
  const kandidaten = [...new Set(pool)].filter((t) => t !== zuletzt);
  const beste = kandidaten.map((t) => [t, wert(t)]).sort((x, y) => y[1] - x[1]).slice(0, 5);
  return beste[Math.floor(zufall() * beste.length)][0];
}

// Längere Vorlagen auf zwei Schreibzeilen verteilen (am Leerzeichen nahe der Mitte).
export function vorlageTeilen(vorlage) {
  if (vorlage.length <= 13 || !vorlage.includes(" ")) return [vorlage];
  const stellen = [...vorlage].map((c, i) => (c === " " ? i : -1)).filter((i) => i > 0);
  const i = stellen.reduce((b, s) => (Math.abs(s - vorlage.length / 2) < Math.abs(b - vorlage.length / 2) ? s : b));
  return [vorlage.slice(0, i), vorlage.slice(i + 1)];
}

// --- Oberfläche ---------------------------------------------------------------------------

export function trainingEinrichten({ daten, zaehlerAus, geaendert, teilen }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("training"), canvas = $("tr-canvas");
  let striche = [], aktuell = null, vorlage = "", teile = [""], ergebnis = null;
  const GRUENDE = [0.40, 0.84], XH = 0.13, GRENZE = 0.62;    // zwei Schreibzeilen, Hilfslinien relativ zur Feldhöhe

  const masse = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
  const zeichnen = () => {
    const { w, h } = masse(), dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    GRUENDE.slice(0, teile.length).forEach((g) => {
      ctx.strokeStyle = "#c9d3e3"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(12, h * g); ctx.lineTo(w - 12, h * g); ctx.stroke();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = "#dfe5ee";
      ctx.beginPath(); ctx.moveTo(12, h * (g - XH)); ctx.lineTo(w - 12, h * (g - XH)); ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.strokeStyle = "#15181f"; ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = "round";
    for (const s of [...striche, aktuell].filter(Boolean)) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      ctx.stroke();
    }
  };
  const punkt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const erlaubt = (e) => e.pointerType === "pen" || e.pointerType === "mouse" || $("tr-finger").checked;
  canvas.addEventListener("pointerdown", (e) => {
    if (!erlaubt(e)) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ohne Capture geht es auch */ }
    aktuell = [punkt(e)];
    zeichnen();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!aktuell || !erlaubt(e)) return;
    e.preventDefault();
    const feine = e.getCoalescedEvents?.() ?? [];           // kann leer sein – dann das Ereignis selbst nehmen
    for (const ev of feine.length ? feine : [e]) aktuell.push(punkt(ev));
    zeichnen();
  });
  const ende = () => { if (aktuell) { striche.push(aktuell); aktuell = null; zeichnen(); } };
  canvas.addEventListener("pointerup", ende);
  canvas.addEventListener("pointercancel", ende);

  const ergebnisZeigen = (an) => { $("tr-ergebnis").hidden = !an; $("tr-schreiben").hidden = an; };
  const zaehlerZeigen = () => {
    const eigene = eigeneLaden();
    const n = Object.values(eigene).reduce((s, l) => s + l.length, 0);
    $("tr-anzahl").textContent = n ? `${n} eigene Varianten auf diesem Gerät` : "Noch keine eigenen Varianten";
    $("tr-export").disabled = $("tr-loeschen").disabled = !n;
  };
  const neueVorlage = () => {
    vorlage = vorlageWaehlen(zaehlerAus(), Math.random, vorlage);
    teile = vorlageTeilen(vorlage);
    $("tr-vorlage").textContent = teile.join("\n");
    striche = []; aktuell = null; ergebnis = null;
    ergebnisZeigen(false);
    zeichnen();
  };
  const kachel = (t) => {
    const k = document.createElement("button");
    k.type = "button";
    k.className = "tr-kachel";
    k.setAttribute("aria-pressed", "true");
    k.title = `„${t.c}“ – tippen zum Aus-/Einschließen`;
    const c = document.createElement("canvas");
    c.width = c.height = 120;
    const ctx = c.getContext("2d"), s = 26;
    ctx.strokeStyle = "#cdd6e4"; ctx.beginPath(); ctx.moveTo(0, 82); ctx.lineTo(120, 82); ctx.stroke();
    ctx.strokeStyle = "#15181f"; ctx.lineWidth = 3; ctx.lineCap = ctx.lineJoin = "round";
    const off = 60 - (t.glyphe.breite * s) / 2;
    for (const st of t.glyphe.striche) {
      ctx.beginPath();
      st.forEach(([x, y], i) => (i ? ctx.lineTo(off + x * s, 82 + y * s) : ctx.moveTo(off + x * s, 82 + y * s)));
      if (st.length === 1) ctx.lineTo(off + st[0][0] * s + 0.5, 82 + st[0][1] * s);
      ctx.stroke();
    }
    const l = document.createElement("span");
    l.textContent = t.c;
    k.append(c, l);
    k.addEventListener("click", () => { t.aus = !t.aus; k.setAttribute("aria-pressed", String(!t.aus)); });
    return k;
  };

  $("trainieren").addEventListener("click", () => { dialog.showModal(); neueVorlage(); zaehlerZeigen(); requestAnimationFrame(zeichnen); });
  $("tr-schliessen").addEventListener("click", () => dialog.close());
  $("tr-zurueck").addEventListener("click", () => { striche.pop(); zeichnen(); });
  $("tr-leeren").addEventListener("click", () => { striche = []; zeichnen(); });
  $("tr-anderes").addEventListener("click", neueVorlage);
  $("tr-pruefen").addEventListener("click", () => {
    const { h } = masse();
    const neigung = daten().profil.neigung_tan;
    const mitte = (s) => s.reduce((a, [, y]) => a + y, 0) / s.length;
    const proZeile = teile.map((_, i) => striche.filter((s) => (teile.length === 1 || (i === 0) === (mitte(s) < h * GRENZE))));
    const einzeln = teile.map((t, i) => zerlegen(proZeile[i], t, { basis: h * GRUENDE[i], xhHilfe: h * XH, neigung }));
    const fehler = einzeln.find((e) => !e.ok);
    ergebnis = fehler ? { ok: false, meldung: teile.length > 1 ? `Zeile ${einzeln.indexOf(fehler) + 1}: ${fehler.meldung}` : fehler.meldung }
      : { ok: true, teile: einzeln.flatMap((e) => e.teile), meldung: `${einzeln.reduce((n, e) => n + e.teile.length, 0)} Zeichen erkannt – tippe auf eins, um es nicht zu übernehmen.` };
    $("tr-meldung").textContent = ergebnis.meldung;
    $("tr-kacheln").replaceChildren(...(ergebnis.ok ? ergebnis.teile.map(kachel) : []));
    $("tr-speichern").disabled = !ergebnis.ok;
    ergebnisZeigen(true);
  });
  $("tr-nochmal").addEventListener("click", () => { striche = []; ergebnisZeigen(false); zeichnen(); });
  $("tr-speichern").addEventListener("click", () => {
    const eigene = eigeneLaden();
    let n = 0;
    for (const t of ergebnis.teile) if (!t.aus) { (eigene[t.c] ??= []).push(t.glyphe); n++; }
    if (!eigeneSpeichern(eigene)) { $("tr-meldung").textContent = "Speichern ging nicht (Speicher voll oder privater Modus)."; return; }
    geaendert();
    zaehlerZeigen();
    neueVorlage();
    $("tr-status").textContent = `${n} Zeichen gespeichert – nächste Vorlage.`;
  });
  $("tr-export").addEventListener("click", () => {
    const datei = new File([JSON.stringify({ version: 1, erstellt: new Date().toISOString(), glyphen: eigeneLaden() })],
      "handschrift-training.json", { type: "application/json" });
    teilen([datei]);
  });
  $("tr-loeschen").addEventListener("click", () => {
    if (!confirm("Alle selbst trainierten Varianten auf diesem Gerät löschen?")) return;
    localStorage.removeItem(SPEICHER_EIGENE);
    geaendert();
    zaehlerZeigen();
  });
  addEventListener("resize", () => dialog.open && zeichnen());
  return { zerlegen, vorlageWaehlen };
}
