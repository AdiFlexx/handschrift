// Handschrift-Engine für die Webseite – Port von schreiben.py (Satz) und goodnotes_datei.py (Writer).
// Läuft komplett im Browser; die Buchstaben kommen aus der verschlüsselten daten.bin.
// GoodNotes-Format nach InkLift (MIT, github.com/yellowHatpro/InkLift).

export const GN_PRO_PT = 132 / 72;
const UMLAUTE = { "ä": "a", "ö": "o", "ü": "u", "Ä": "A", "Ö": "O", "Ü": "U" };
const VERSALHOCH = new Set("0123456789?!%€()/");
const LISTE = /^(\s*)([-–•·*]|\d{1,2}[.)])\s+(.*)$/;    // Stichpunkt: Einrückung, Zeichen, Text

// --- Zufall (reproduzierbar über den Seed) -------------------------------------------

class Zufall {
  constructor(seed) {
    let a = (seed ?? Math.floor(Math.random() * 2 ** 31)) | 0;
    this.r = () => {                                     // mulberry32
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  random() { return this.r(); }
  uniform(a, b) { return a + (b - a) * this.r(); }
  gauss(mu, sigma) { return mu + sigma * Math.sqrt(-2 * Math.log(1 - this.r())) * Math.cos(2 * Math.PI * this.r()); }
  randrange(n) { return Math.floor(this.r() * n); }
  choice(liste) { return liste[this.randrange(liste.length)]; }
}

const istGross = (c) => c !== c.toLowerCase() && c === c.toUpperCase();

export function textAufbereiten(text) {
  return text
    .replace(/\r/g, "")
    .replace(/^>\s?/gm, "")                               // Markdown-Zitate
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, a, b) => `==${a ?? b}==`)   // fett -> unterstrichen
    .replace(/\*\*|`/g, "")                               // Reste/Code; „* “ als Stichpunkt bleibt
    .replace(/"([^"$]*)"/g, "„$1“")                       // gerade Anführungszeichen -> deutsche
    .replace(/’/g, "'").replace(/[–—](?=\s)/g, "-");
}

// --- Gliederung erkennen ----------------------------------------------------------------

const PUNKT_MARKEN = "•·*◦▪▫●○■□";
const STRICH_MARKEN = "-–—►▶→➔➜✓✔";

// Stichpunkt aus einer Zeile lesen (auch aus Word/Notizen eingefügt): Ebene, Zeichenart, Text.
export function stichpunktErkennen(zeile) {
  const [, einzug, rest] = /^([ \t ]*)(.*)$/s.exec(zeile);
  const ebene = Math.min(3, Math.floor(einzug.replace(/\t/g, "  ").replace(/ /g, " ").length / 2));
  let r;
  if ((r = /^([•·◦▪▫●○■□►▶→➔➜✓✔])\s*(\S.*)$/u.exec(rest))) return { ebene, marke: r[1], text: r[2] };
  if ((r = /^([-–—*])\s+(\S.*)$/.exec(rest))) return { ebene, marke: r[1], text: r[2] };
  if ((r = /^o\t+(\S.*)$/.exec(rest))) return { ebene, marke: "◦", text: r[1] };          // Word, 2. Ebene
  if ((r = /^(\d{1,2}[.)]|[a-zA-Z]\)|[a-z]\.)\s+(\S.*)$/.exec(rest))) return { ebene, marke: r[1], text: r[2] };
  return null;
}

// Überschrift: Markdown „# …“ oder kurze Zeile mit Doppelpunkt am Ende („Funktionen:“).
export function ueberschriftErkennen(zeile) {
  const t = zeile.trim();
  const r = /^(#{1,3})\s+(.+)$/.exec(t);
  if (r) return { text: r[2], stufe: r[1].length };
  if (t.length <= 45 && /:$/.test(t) && !/[.!?;$]/.test(t.slice(0, -1)) && t.split(/\s+/).length <= 6) return { text: t, stufe: 2 };
  return null;
}

// Anweisungen am Textanfang (für KI): @papier, @format, @platz, @layout, @groesse, @wortabstand, @gliedern, @unterstreichen, @titel
const ANWEISUNG = /^\s*@(papier|format|platz|layout|groesse|größe|wortabstand|buchstabenabstand|gliedern|unterstreichen|titel|zeilen)\s*:\s*(.+?)\s*$/i;

export function anweisungenLesen(text) {
  const anweisungen = {};
  const zeilen = text.split("\n");
  let i = 0;
  while (i < zeilen.length && (ANWEISUNG.test(zeilen[i]) || (!zeilen[i].trim() && Object.keys(anweisungen).length))) {
    const m = ANWEISUNG.exec(zeilen[i]);
    if (m) anweisungen[m[1].toLowerCase().replace("größe", "groesse")] = m[2];
    i++;
  }
  return { anweisungen, text: Object.keys(anweisungen).length ? zeilen.slice(i).join("\n") : text };
}

// Übersetzt Anweisungen in Einstellungen der Seite (unbekannte Werte werden ignoriert).
export function anweisungenAnwenden(anweisungen, basis) {
  const a = anweisungen, aus = { ...basis, optionen: { ...basis.optionen } };
  const zahl = (s) => { const n = parseFloat(String(s).replace(",", ".")); return Number.isFinite(n) ? (n > 3 ? n / 100 : n) : null; };
  const janein = (s) => /^(an|ja|true|1|on)$/i.test(s) ? true : /^(aus|nein|false|0|off)$/i.test(s) ? false : null;
  const papier = { kariert: "kariert-klein", "kariert-klein": "kariert-klein", liniert: "liniert-schmal", "liniert-schmal": "liniert-schmal",
                   "liniert-gross": "liniert-gross", "liniert-groß": "liniert-gross" }[String(a.papier ?? "").toLowerCase()];
  if (papier) aus.art = papier;
  const format = { a4: "A4", goodnotes: "GoodNotes" }[String(a.format ?? "").toLowerCase()];
  if (format) aus.format = format;
  const platz = String(a.platz ?? "").toLowerCase();
  if (VOREINSTELLUNGEN[platz]) aus.optionen = { ...aus.optionen, ...VOREINSTELLUNGEN[platz] };
  const layout = { standard: "standard", normal: "standard", spalten: "spalten", "zwei spalten": "spalten", "2 spalten": "spalten",
                   cornell: "cornell", notizen: "cornell", rand: "rand", mathe: "rand", "mit rand": "rand" }[String(a.layout ?? "").toLowerCase()];
  if (layout) aus.optionen.layout = layout;
  for (const [k, min, max] of [["groesse", 0.8, 1.25], ["wortabstand", 0.7, 1.5], ["buchstabenabstand", 0.7, 1.5]]) {
    const n = a[k] != null ? zahl(a[k]) : null;
    if (n != null) aus.optionen[k] = Math.min(max, Math.max(min, n));
  }
  for (const k of ["gliedern", "unterstreichen"]) if (a[k] != null && janein(a[k]) != null) aus.optionen[k] = janein(a[k]);
  if (/^(2|jede zweite)/i.test(a.zeilen ?? "")) aus.optionen.zeilenSprung = 2;
  if (/^(1|jede)$/i.test(a.zeilen ?? "")) aus.optionen.zeilenSprung = 1;
  if (a.titel) aus.titel = a.titel;
  return aus;
}

// --- Layouts ----------------------------------------------------------------------------
// Bahnen = waagerechte Bereiche (pt), in denen Zeilen stehen: voll (ganze Breite), haupt (Fließtext),
// schmal + neben (Hauptrechnung links, Nebenrechnung rechts daneben), stichwort (Cornell-Stichwortspalte).

export const LAYOUTS = { standard: "Standard", spalten: "Zwei Spalten", cornell: "Cornell-Notizen", rand: "Mit Rand" };

export function layoutBahnen(layout, papier) {
  const L = papier.x_links, R = papier.x_rechts, W = R - L;
  const geteilt = (x0, x1) => ({ schmal: [x0, x0 + 0.6 * (x1 - x0)], neben: [x0 + 0.66 * (x1 - x0), x1] });
  const strich = (x0, x1) => x0 + 0.63 * (x1 - x0);       // senkrechter Strich vor der Nebenrechnung
  if (layout === "spalten") {
    const g = 0.06 * W, s = (W - g) / 2;
    return { name: layout, bahnen: { voll: [L, R], haupt: [L, L + s], stichwort: [L, L + s], ...geteilt(L, L + s) },
             nrStrich: strich(L, L + s), spalteDx: s + g, trenner: L + s + g / 2 };
  }
  if (layout === "cornell") {
    const h = L + 0.33 * W;
    return { name: layout, bahnen: { voll: [L, R], stichwort: [L, L + 0.27 * W], haupt: [h, R], ...geteilt(h, R) },
             nrStrich: strich(h, R), trenner: L + 0.3 * W };
  }
  if (layout === "rand") {                               // Heft mit Rand: Nebenrechnungen in den Rand
    const haupt = [L, L + 0.7 * W];
    return { name: layout, bahnen: { voll: [L, R], haupt, schmal: haupt, stichwort: haupt, neben: [L + 0.77 * W, R] },
             nrStrich: null, trenner: L + 0.735 * W };
  }
  return { name: "standard", bahnen: { voll: [L, R], haupt: [L, R], stichwort: [L, R], ...geteilt(L, R) }, nrStrich: strich(L, R) };
}

const BEFEHL = /^\s*\[(leer|seite|kasten|\/kasten)(?:\s+(\d{1,2}))?\]\s*$/i;
const PRAEFIX = /^\s*\[(mitte|rechts|neben|ergebnis)\]\s*/i;
const NEBENRECHNUNG = /^\s*(NR|Nebenrechnung)\s*:/i;
const ZUSAMMENFASSUNG = /^(zusammenfassung|fazit|kurz gesagt|zum schluss|summary)\b/i;
const BEGRIFF = /^(==)?([A-ZÄÖÜ][\wäöüßÄÖÜ-]*(?: [\wäöüßÄÖÜ-]+){0,2})\1\s*(?::|\s[-–]\s)\s*(\S.*)$/;

// Zeilen des Textes einer Bahn zuordnen: Nebenrechnungen rechts daneben, im Cornell-Layout Überschriften und
// Begriffe in die Stichwortspalte, Titel über die ganze Breite.
function postenBilden(zeilen, B) {
  const posten = [];
  let imKasten = false, schluss = false, erster = true;
  for (const zeile of zeilen) {
    const befehl = BEFEHL.exec(zeile);
    if (befehl) {
      const art = befehl[1].toLowerCase();
      if (art === "kasten") imKasten = true;
      if (art === "/kasten") imKasten = false;
      posten.push({ befehl: art, n: befehl[2] });
      continue;
    }
    let roh = zeile, praefix = false;
    const p = { bahn: "haupt" };
    for (let m; (m = PRAEFIX.exec(roh)); roh = roh.slice(m[0].length)) { p[m[1].toLowerCase()] = true; praefix = true; }
    if (praefix && !roh.trim()) continue;
    if (NEBENRECHNUNG.test(roh)) p.neben = true;
    p.roh = roh;
    if (!roh.trim()) { posten.push(p); continue; }
    const ue = /^\s*\$\$/.test(roh) ? null : ueberschriftErkennen(roh);
    if (p.neben) {
      p.bahn = "neben";
      p.anker = "vorher";
    } else if (B.name === "cornell") {
      if (ue && !schluss && ZUSAMMENFASSUNG.test(ue.text)) { schluss = true; posten.push({ roh: "---", bahn: "voll" }); }
      const d = !ue && !imKasten && !p.mitte && !p.rechts && !stichpunktErkennen(roh) ? BEGRIFF.exec(roh.trim()) : null;
      if (schluss) p.bahn = "voll";
      else if (ue && ue.stufe === 1 && erster) { p.bahn = "voll"; p.mitte = true; }
      else if (ue && !imKasten) { p.bahn = "stichwort"; p.anker = "nachher"; }
      else if (d && d[3].split(/\s+/).length >= 2 && !/[=$]/.test(d[3])) {
        posten.push({ roh: d[1] ? `==${d[2]}==` : d[2], bahn: "stichwort", anker: "nachher" });
        p.roh = d[3];
      }
    } else if (B.name === "spalten" && ue && ue.stufe === 1 && erster) {
      p.bahn = "voll";
      p.mitte = true;
    }
    erster = false;
    posten.push(p);
  }
  if (B.bahnen.schmal[1] < B.bahnen.haupt[1]) {          // Absätze mit Nebenrechnung: Hauptteil schmaler
    let block = [];
    const fertig = () => {
      if (block.some((p) => p.bahn === "neben")) for (const p of block) if (p.bahn === "haupt") p.bahn = "schmal";
      block = [];
    };
    for (const p of posten) {
      if (p.befehl || !p.roh.trim() || (p.bahn === "haupt" && ueberschriftErkennen(p.roh))) fertig();
      else block.push(p);
    }
    fertig();
  }
  return posten;
}

// Rechenschritte untereinander: Gleichheitszeichen bündig, Umformungen („| -5“) in einer Spalte.
function rechnungenAusrichten(zeilen) {
  const offen = new Map();
  const verschieben = (z, dx, ab = 0) => {
    z.teile.forEach((t, i) => { if (i >= ab) t.x += dx; });
    if (!ab) z.linien = z.linien.map((l) => l.map(([px, py]) => [px + dx, py]));
    z.ende += dx;
  };
  const fertig = (bahn) => {
    const g = offen.get(bahn);
    offen.delete(bahn);
    if (!g || g.length < 2) return;
    const ziel = Math.max(...g.map((z) => z.gleichX));
    if (g.every((z) => z.ende + ziel - z.gleichX <= z.rechts)) for (const z of g) verschieben(z, ziel - z.gleichX);
    const mit = g.filter((z) => z.strichAb != null);
    if (mit.length < 2) return;
    const zs = Math.max(...mit.map((z) => z.teile[z.strichAb].x));
    if (mit.every((z) => z.ende + zs - z.teile[z.strichAb].x <= z.rechts)) for (const z of mit) verschieben(z, zs - z.teile[z.strichAb].x, z.strichAb);
  };
  for (const z of zeilen) {
    if (z.umbruch || z.frei) for (const b of [...offen.keys()]) fertig(b);
    if (!z.teile) continue;
    if (z.einzeilig && z.gleichX != null && !z.ausgerichtet && z.teile.length) {
      if (!offen.has(z.bahn)) offen.set(z.bahn, []);
      offen.get(z.bahn).push(z);
    } else fertig(z.bahn);
  }
  for (const b of [...offen.keys()]) fertig(b);
}

// --- Mathe ------------------------------------------------------------------------------

const BEFEHLE = {
  cdot: "·", times: "×", div: ":", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", infty: "∞", to: "→", rightarrow: "→", Rightarrow: "⇒", degree: "°", circ: "°", in: "∈",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", lambda: "λ", mu: "μ", pi: "π",
  sigma: "σ", phi: "φ", omega: "ω", Delta: "Δ", Sigma: "Σ", Omega: "Ω", cdots: "…", ldots: "…",
};
const OPERATOREN = new Set("=+-−×·:<>≤≥≠≈→⇒±∈");
export const MATHE_ERKENNEN = /^\$.+\$$|[\^_]|\\(frac|sqrt|[a-zA-Z]+)|^sqrt\(/;

// Kleine Formelsprache wie in LaTeX: x^2, a_1, \frac{1}{2}, \sqrt{x}, \pi … ; außerdem sqrt(x) und a/b.
export function matheParsen(quelle) {
  let i = 0;
  const s = quelle.replace(/\*/g, "·").replace(/<=/g, "≤").replace(/>=/g, "≥").replace(/!=/g, "≠").replace(/->/g, "→");
  const gruppe = () => {
    if (s[i] === "{") {
      i++;
      const f = folge("}");
      i++;
      return f;
    }
    return atom();
  };
  const atom = () => {
    if (i >= s.length) return { t: "folge", kinder: [] };   // z. B. „x^“ am Ende: nichts anhängen
    const c = s[i];
    if (c === "\\") {
      const name = /^\\([a-zA-Z]+)/.exec(s.slice(i))?.[1] ?? "";
      i += 1 + name.length;
      if (name === "frac") { const z = gruppe(); return { t: "bruch", z, n: gruppe() }; }
      if (name === "sqrt") return { t: "wurzel", inhalt: gruppe() };
      if (!name) { i++; return { t: "zeichen", c: s[i - 1] }; }
      return { t: "zeichen", c: BEFEHLE[name] ?? name };
    }
    if (s.startsWith("sqrt(", i)) {
      i += 5;
      const f = folge(")");
      i++;
      return { t: "wurzel", inhalt: f };
    }
    if (c === "(") {                                      // Klammern bleiben sichtbar, Inhalt als Gruppe
      i++;
      const f = folge(")");
      i++;
      return { t: "folge", kinder: [{ t: "zeichen", c: "(" }, f, { t: "zeichen", c: ")" }], klammer: f };
    }
    i++;
    return { t: "zeichen", c };
  };
  const folge = (ende) => {
    const kinder = [];
    while (i < s.length && s[i] !== ende) {
      if (s[i] === " ") { i++; continue; }
      let a = atom();
      while (s[i] === "^" || s[i] === "_") {
        const art = s[i] === "^" ? "hoch" : "tief";
        i++;
        a = { t: art, basis: a, skript: gruppe() };
      }
      if (s[i] === "/") {                                 // a/b -> Bruch
        i++;
        let n = atom();
        while (s[i] === "^" || s[i] === "_") { const art = s[i] === "^" ? "hoch" : "tief"; i++; n = { t: art, basis: n, skript: gruppe() }; }
        const ohneKlammer = (x) => (x.klammer ? x.klammer : x);
        a = { t: "bruch", z: ohneKlammer(a), n: ohneKlammer(n) };
      }
      kinder.push(a);
    }
    return { t: "folge", kinder };
  };
  return folge(undefined);
}

// Ersatzstriche für Zeichen, die (noch) nicht in der Handschrift-Bibliothek sind – leicht zittrig wie von Hand.
const ERSATZ = {
  "<": [[[0.75, -0.95], [0.05, -0.5], [0.75, -0.05]]],
  ">": [[[0.05, -0.95], [0.75, -0.5], [0.05, -0.05]]],
  "≤": [[[0.75, -1.15], [0.05, -0.7], [0.75, -0.25]], [[0.05, 0.05], [0.75, 0.05]]],
  "≥": [[[0.05, -1.15], [0.75, -0.7], [0.05, -0.25]], [[0.05, 0.05], [0.75, 0.05]]],
  "≈": [[[0, -0.62], [0.2, -0.75], [0.45, -0.6], [0.7, -0.72]], [[0, -0.3], [0.2, -0.43], [0.45, -0.28], [0.7, -0.4]]],
  "→": [[[0, -0.5], [1.1, -0.5]], [[0.8, -0.75], [1.12, -0.5], [0.8, -0.25]]],
  "⇒": [[[0, -0.62], [0.95, -0.62]], [[0, -0.32], [0.95, -0.32]], [[0.75, -0.9], [1.15, -0.47], [0.75, -0.05]]],
  "∞": [[[0.55, -0.45], [0.35, -0.7], [0.1, -0.65], [0.05, -0.4], [0.25, -0.22], [0.55, -0.45], [0.85, -0.7],
    [1.05, -0.62], [1.08, -0.35], [0.85, -0.2], [0.55, -0.45]]],
  "π": [[[0, -0.82], [0.25, -0.95], [1.0, -0.98]], [[0.3, -0.95], [0.25, -0.45], [0.15, 0]], [[0.75, -0.97], [0.72, -0.3], [0.85, 0]]],
  "°": [[[0.15, -1.6], [0.05, -1.45], [0.15, -1.3], [0.32, -1.38], [0.32, -1.55], [0.15, -1.6]]],
  "±": [[[0.4, -1.0], [0.4, -0.35]], [[0.05, -0.68], [0.75, -0.68]], [[0.05, 0], [0.75, 0]]],
  "×": [[[0.1, -0.85], [0.7, -0.15]], [[0.7, -0.85], [0.1, -0.15]]],
  "≠": [[[0, -0.62], [0.8, -0.62]], [[0, -0.3], [0.8, -0.3]], [[0.6, -0.95], [0.2, 0.02]]],
  "=": [[[0, -0.62], [0.8, -0.62]], [[0, -0.3], [0.8, -0.3]]],
  "α": [[[0.95, -0.95], [0.7, -0.4], [0.45, -0.05], [0.15, -0.1], [0.05, -0.5], [0.3, -0.9], [0.6, -0.7], [0.75, -0.25], [0.95, 0]]],
  "∈": [[[0.75, -0.9], [0.3, -0.85], [0.05, -0.5], [0.3, -0.12], [0.75, -0.1]], [[0.1, -0.5], [0.65, -0.5]]],
  "Δ": [[[0.5, -1.8], [0.02, 0], [0.98, 0], [0.5, -1.8]]],
  "β": [[[0.15, 0.6], [0.15, -1.4], [0.3, -1.7], [0.6, -1.65], [0.65, -1.3], [0.35, -1.0], [0.75, -0.75], [0.75, -0.25], [0.45, -0.02], [0.15, -0.15]]],
  "γ": [[[0, -0.95], [0.25, -0.7], [0.45, -0.1], [0.4, 0.55], [0.3, 0.6], [0.35, 0.2], [0.6, -0.5], [0.8, -0.95]]],
  "δ": [[[0.65, -1.6], [0.25, -1.55], [0.3, -1.25], [0.7, -0.8], [0.75, -0.3], [0.45, 0], [0.1, -0.25], [0.15, -0.7], [0.6, -0.9]]],
  "ε": [[[0.7, -0.85], [0.3, -0.95], [0.1, -0.7], [0.35, -0.5], [0.1, -0.3], [0.3, -0.02], [0.75, -0.1]]],
  "λ": [[[0.05, -1.75], [0.25, -1.6], [0.8, 0]], [[0.45, -0.75], [0.05, 0]]],
  "μ": [[[0.1, 0.6], [0.15, -0.95], [0.15, -0.35], [0.4, -0.02], [0.7, -0.2], [0.75, -0.95], [0.78, -0.15], [0.95, 0]]],
  "σ": [[[1.0, -0.95], [0.45, -0.95], [0.15, -0.7], [0.1, -0.3], [0.35, -0.02], [0.65, -0.15], [0.75, -0.55], [0.55, -0.95]]],
  "φ": [[[0.45, -1.5], [0.45, 0.6]], [[0.45, -0.95], [0.15, -0.8], [0.05, -0.45], [0.3, -0.05], [0.6, -0.05], [0.85, -0.45], [0.75, -0.85], [0.45, -0.95]]],
  "ω": [[[0.15, -0.95], [0.05, -0.4], [0.25, -0.02], [0.5, -0.35], [0.55, -0.6], [0.6, -0.35], [0.85, -0.02], [1.05, -0.4], [0.95, -0.95]]],
  "Σ": [[[1.0, -1.8], [0.05, -1.8], [0.55, -0.9], [0.05, 0], [1.0, 0]]],
  "Ω": [[[0.05, 0], [0.35, 0], [0.15, -0.6], [0.2, -1.4], [0.55, -1.8], [0.9, -1.4], [0.95, -0.6], [0.75, 0], [1.05, 0]]],
  "…": [[[0.1, -0.05], [0.12, -0.03]], [[0.5, -0.05], [0.52, -0.03]], [[0.9, -0.05], [0.92, -0.03]]],
  "|": [[[0.2, -1.75], [0.18, -0.6], [0.15, 0.45]]],
  "{": [[[0.5, -1.75], [0.28, -1.62], [0.25, -1.05], [0.05, -0.85], [0.25, -0.68], [0.22, -0.05], [0.45, 0.12]]],
  "}": [[[0.05, -1.75], [0.27, -1.62], [0.3, -1.05], [0.5, -0.85], [0.3, -0.68], [0.33, -0.05], [0.1, 0.12]]],
};
const HOCHGESTELLT = { "²": "2", "³": "3", "¹": "1", "⁰": "0", "⁴": "4" };

// --- Satz ---------------------------------------------------------------------------

export class Handschrift {
  constructor(daten, seed) {
    this.p = daten.profil;
    this.glyphen = daten.glyphen;
    this.zufall = new Zufall(seed);
    this.zuletzt = {};
    this.fehlend = new Set();
    this.punkte = this.umlautpunkte();
    const h = [];
    for (const c of "ABDEFHKLMNPRTZ") for (const g of this.glyphen[c] || []) h.push(Handschrift.hoehe(g));
    h.sort((a, b) => a - b);
    this.versal = h.length ? h[Math.floor(h.length / 2)] : 1.7;   // Großbuchstabenhöhe in x-Höhen
  }

  static hoehe(g) {
    let m = Infinity;
    for (const s of g.striche) for (const [, y] of s) m = Math.min(m, y);
    return Math.max(0.3, -m);
  }

  umlautpunkte() {
    const paare = [];
    for (const c of "äöü") {
      for (const g of this.glyphen[c] || []) {
        const mitte = g.breite / 2;
        const oben = g.striche.filter((s) => Math.max(...s.map(([, y]) => y)) < -1.05);
        if (oben.length === 2) paare.push(oben.map((s) => s.map(([x, y]) => [x - mitte, y])));
      }
    }
    return paare;
  }

  variante(c) {
    let varianten = this.glyphen[c];
    const selten = (varianten || []).length < 3 && this.zufall.random() < 0.5;   // wenig echte Umlaute: mischen
    if ((!varianten || selten) && UMLAUTE[c] && this.punkte.length && this.glyphen[UMLAUTE[c]]) {
      const basis = this.zufall.choice(this.glyphen[UMLAUTE[c]]);
      const punkte = this.zufall.choice(this.punkte);
      const hoch = istGross(c) ? -0.9 : 0.0;
      const mitte = basis.breite / 2;
      return { striche: basis.striche.concat(punkte.map((s) => s.map(([x, y]) => [x + mitte, y + hoch]))),
               breite: basis.breite };
    }
    if (!varianten || !varianten.length) {
      this.fehlend.add(c);
      return null;
    }
    for (const [grenze, mindestens] of [[1.0, 8], [1.3, 4]]) {   // bei genug Auswahl nur gut lesbare Varianten
      const typische = varianten.filter((g) => (g.typisch ?? 0) <= grenze);
      if (typische.length >= mindestens) { varianten = typische; break; }
    }
    let k = this.zufall.randrange(varianten.length);
    if (varianten.length > 1 && k === this.zuletzt[c]) k = (k + 1) % varianten.length;
    this.zuletzt[c] = k;
    return varianten[k];
  }

  static mittig(g, breite = null, mitte = -0.45, gleichmaessig = false) {
    const xs = g.striche.flatMap((s) => s.map(([x]) => x));
    const ys = g.striche.flatMap((s) => s.map(([, y]) => y));
    const x0 = Math.min(...xs), ym = (Math.min(...ys) + Math.max(...ys)) / 2;
    const sx = breite ? breite / Math.max(0.15, Math.max(...xs) - x0) : 1.0;
    const sy = gleichmaessig ? sx : Math.min(Math.max(sx, 0.5), 1.5);
    return { striche: g.striche.map((s) => s.map(([x, y]) => [(x - x0) * sx, mitte + (y - ym) * sy])),
             breite: (Math.max(...xs) - x0) * sx };
  }

  // Von Hand gezeichneter Ersatz für Zeichen, die (noch) nicht in der Bibliothek sind.
  ersatz(c) {
    const striche = ERSATZ[c].map((s) => s.map(([x, y]) => [x + this.zufall.gauss(0, 0.02), y + this.zufall.gauss(0, 0.02)]));
    return { striche, breite: Math.max(...striche.flat().map(([x]) => x)) };
  }

  wort(text) {
    const teile = [];
    let x = 0;
    for (let c of text) {
      const hoch = HOCHGESTELLT[c];                      // cm², m³ – kleine hochgestellte Ziffer
      if (hoch) c = hoch;
      if (c === "−") c = "-";
      let g = !this.glyphen[c] && !UMLAUTE[c] && ERSATZ[c] ? this.ersatz(c) : this.variante(c === "–" ? "-" : c);
      if (!g) continue;
      if (teile.length) x += Math.max(0.12, this.zufall.gauss(this.p.luecke, 0.25 * this.p.luecke_streuung)) * (this.buchstabenabstand ?? 1);
      let faktor = VERSALHOCH.has(c) ? this.versal / Handschrift.hoehe(g) : 1.0;   // einheitliche Ziffernhöhe
      let skala = faktor * this.zufall.gauss(1.0, 0.04);
      let dy = this.zufall.gauss(0.0, 0.05);
      if (/[0-9]/.test(c)) dy -= Math.max(...g.striche.flatMap((s) => s.map(([, y]) => y))) * skala;
      if (hoch) {
        faktor *= 0.55;
        skala *= 0.55;
        dy = -0.75 - Math.max(...g.striche.flatMap((s) => s.map(([, y]) => y))) * skala;
      }
      if ("-–+".includes(c)) {                           // Strich/Plus mittig auf der Zeile
        const laenge = { "-": 0.75, "–": 1.05, "+": 0.95 }[c];
        g = Handschrift.mittig(g, this.zufall.gauss(laenge, 0.06), -0.45, c === "+");
        skala = faktor = 1.0;
        dy = this.zufall.gauss(0.0, 0.03);
      }
      teile.push([x, g, skala, dy]);
      x += g.breite * faktor;
    }
    return [teile, x];
  }

  aufzaehlungszeichen(zeichen) {
    const mitte = -0.4 * this.versal;                    // mittig in der Zeile: halbe Großbuchstabenhöhe
    if (STRICH_MARKEN.includes(zeichen)) {
      const g = this.variante("-");
      if (g) {
        const strich = Handschrift.mittig(g, this.zufall.gauss(1.25, 0.1), mitte);
        return [[[0, strich, 1.0, this.zufall.gauss(0, 0.03)]], strich.breite];
      }
    }
    if (PUNKT_MARKEN.includes(zeichen)) {
      const g = this.variante("·") || this.variante(".");
      if (g) {
        const p = Handschrift.mittig(g, null, mitte);
        return [[[0, p, 1.0, this.zufall.gauss(0, 0.03)]], p.breite];
      }
    }
    return this.wort(zeichen);
  }

  schriftgroesse(papier) {
    const xh = 0.40 * papier.abstand;
    if (papier.art === "kariert") return xh;
    const natur = this.p.x_hoehe_pt;
    return Math.min(Math.max(xh, 0.85 * natur), 1.4 * natur);
  }

  // --- Formeln (Einheiten: x-Höhen, Grundlinie bei y = 0) ---

  static boxAus(teile, breite) {
    let oben = 0, unten = 0;
    for (const [, g, skala, dy] of teile) {
      for (const s of g.striche) for (const [, py] of s) { const y = dy + py * skala; oben = Math.max(oben, -y); unten = Math.max(unten, y); }
    }
    return { teile, breite, oben, unten };
  }

  static versetzt(box, dx, dy, f = 1) {
    return box.teile.map(([gx, g, skala, d]) => [dx + gx * f, g, skala * f, dy + d * f]);
  }

  linie(x0, y0, x1, y1) {                                // gerader Strich mit leichtem Handzittern
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 0.7));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t + this.zufall.gauss(0, 0.01), y0 + (y1 - y0) * t + this.zufall.gauss(0, 0.018)]);
    }
    return pts;
  }

  zeichenBox(c) {
    const g = this.glyphen[c] ? this.variante(c) : null;
    if (g && (c === "=" || c === "·")) {
      const m = c === "=" ? Handschrift.mittig(g, this.zufall.gauss(0.8, 0.05), -0.46) : Handschrift.mittig(g, null, -0.45);
      return Handschrift.boxAus([[0, m, 1, 0]], m.breite);
    }
    if (c === "×" && !g && this.glyphen.x) {
      const m = Handschrift.mittig(this.variante("x"), this.zufall.gauss(0.6, 0.04), -0.46, true);
      return Handschrift.boxAus([[0, m, 1, 0]], m.breite);
    }
    if (!g && ERSATZ[c]) {                               // noch nicht in der Bibliothek: Ersatz von Hand gezeichnet
      const e = this.ersatz(c);
      return Handschrift.boxAus([[0, e, 1, 0]], e.breite);
    }
    const [teile, w] = this.wort(c);
    return Handschrift.boxAus(teile, w);
  }

  matheBox(k) {
    if (k.t === "zeichen") {
      const b = this.zeichenBox(k.c);
      if (!OPERATOREN.has(k.c)) return b;
      // Luft um Rechenzeichen; rechts mehr, weil die Schräglage Zeichen auf Mittelhöhe nach rechts schiebt
      return { ...b, teile: Handschrift.versetzt(b, 0.45, 0), breite: b.breite + 1.15 };
    }
    if (k.t === "folge") {
      const teile = [];
      let x = 0, oben = 0, unten = 0;
      k.kinder.forEach((kind, i) => {
        const b = this.matheBox(kind);
        if (i) x += 0.12;
        teile.push(...Handschrift.versetzt(b, x, 0));
        x += b.breite;
        oben = Math.max(oben, b.oben);
        unten = Math.max(unten, b.unten);
      });
      return { teile, breite: x, oben, unten };
    }
    if (k.t === "hoch" || k.t === "tief") {              // Hochzahl / Index: klein, versetzt
      const b = this.matheBox(k.basis), s = this.matheBox(k.skript), f = 0.55;
      const dy = k.t === "hoch" ? -Math.max(0.72, b.oben * 0.52) : 0.3;
      return { teile: [...b.teile, ...Handschrift.versetzt(s, b.breite + 0.08, dy, f)], breite: b.breite + 0.16 + s.breite * f,
               oben: Math.max(b.oben, f * s.oben - dy), unten: Math.max(b.unten, dy + f * s.unten) };
    }
    if (k.t === "bruch") {                               // klein übereinander, Bruchstrich auf Mittelhöhe
      const z = this.matheBox(k.z), n = this.matheBox(k.n), f = 0.8, strich = -0.48;
      const w = Math.max(z.breite, n.breite) * f + 0.3;
      const dz = strich - 0.2 - z.unten * f, dn = strich + 0.22 + n.oben * f;
      return { teile: [...Handschrift.versetzt(z, (w - z.breite * f) / 2, dz, f), ...Handschrift.versetzt(n, (w - n.breite * f) / 2, dn, f),
                       [0, { striche: [this.linie(0, strich, w, strich)], breite: w }, 1, 0]],
               breite: w, oben: f * z.oben - dz, unten: dn + f * n.unten };
    }
    if (k.t === "wurzel") {                              // echter Haken, an Inhaltshöhe angepasst; Querstrich so lang wie der Inhalt
      const c = this.matheBox(k.inhalt);
      const top = -(Math.max(c.oben, 1) + 0.25), boden = c.unten + 0.12, hoehe = boden - top;
      const g = this.glyphen["√"] ? this.variante("√") : null;
      let haken;
      if (g) {
        const ys = g.striche.flat().map(([, y]) => y);
        const fy = hoehe / Math.max(0.3, -Math.min(...ys)), fx = Math.min(fy, 1.25);
        haken = g.striche[0].map(([x, y]) => [x * fx, boden + y * fy]);
      } else {
        haken = [[0, top + 0.6 * hoehe], [0.15, top + 0.52 * hoehe], [0.4, boden], [0.75, top]];
      }
      const [ex, ey] = haken[haken.length - 1];
      const x0 = ex + 0.12, xe = x0 + c.breite + 0.15;
      return { teile: [[0, { striche: [haken, this.linie(ex, ey, xe, ey)], breite: xe }, 1, 0], ...Handschrift.versetzt(c, x0, 0)],
               breite: xe + 0.05, oben: Math.max(c.oben, -ey + 0.05), unten: Math.max(c.unten, boden) };
    }
    return { teile: [], breite: 0, oben: 0, unten: 0 };
  }

  mathe(quelle) {
    const b = this.matheBox(matheParsen(quelle));
    return [b.teile, b.breite];
  }

  wortOderFormel(tok) {
    const m = /^\$([^$]+)\$(.*)$/.exec(tok);
    if (m) {                                             // $…$ plus angehängtes Satzzeichen
      let [teile, w] = this.mathe(m[1]);
      if (m[2]) {
        const [t2, w2] = this.wort(m[2]);
        teile = teile.concat(t2.map(([gx, g, s, d]) => [gx + w + 0.1, g, s, d]));
        w += 0.1 + w2;
      }
      return [teile, w];
    }
    return MATHE_ERKENNEN.test(tok) ? this.mathe(tok) : this.wort(tok);
  }

  // Setzt den Text auf die Linien des Papiers; liefert Seiten als Strich-Listen (pt).
  // Phase 1 baut die Zeilen (Umbruch, Stichpunkte, Formeln, Regeln aus dem Regelblatt) in ihrer Bahn des Layouts,
  // Phase 2 legt jede Zeile auf die nächste Linie, auf der sie nichts berührt – so überlappt nie etwas.
  setzen(text, papier, optionen = {}) {
    const o = { ...VOREINSTELLUNGEN.normal, ...GLIEDERUNG, ...optionen };
    this.buchstabenabstand = o.buchstabenabstand;
    const xh = this.schriftgroesse(papier) * o.groesse;
    const oben = Math.max(36.0, this.versal * xh + 14);
    const linien = papier.linien.filter((y) => y >= oben && y <= papier.hoehe - 2.2 * xh);
    const wortabst = Math.min(Math.max(this.p.wortabstand, 1.5), 3.5) * o.wortabstand;
    const breite = this.p.strichbreite_pt;
    const B = layoutBahnen(o.layout, papier);
    const skaliert = (teile, f) => teile.map(([gx, g, s, d]) => [gx * f, g, s * f, d * f]);
    // Handgezogene Linie; „weg“ = +1: liegt nie höher als y (Unterstrich), -1: nie tiefer als y (Rahmen-Oberkante).
    const handLinie = (x0, x1, y, zittern = 0.04, weg = 0, neig = this.zufall.gauss(0, 0.006)) => {
      const n = Math.max(2, Math.round((x1 - x0) / (1.5 * xh)));
      const pts = Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y + (x1 - x0) * (i / n) * neig + this.zufall.gauss(0, zittern * xh)]);
      const ys = pts.map(([, py]) => py);
      const dy = weg > 0 ? y - Math.min(...ys) : weg < 0 ? y - Math.max(...ys) : 0;
      return pts.map(([px, py]) => [px, py + dy]);
    };
    const doppelt = (x0, x1, y) => {                     // Ergebnis: doppelt unterstrichen, beide Striche parallel
      const neig = this.zufall.gauss(0, 0.004);
      return [handLinie(x0, x1, y, 0.03, 1, neig), handLinie(x0 + 0.1 * xh, x1 - 0.05 * xh, y + 0.42 * xh, 0.03, 1, neig)];
    };
    const senkrecht = (x, y0, y1) => {                   // Rand, Spaltentrenner, Strich vor Nebenrechnungen
      const n = Math.max(2, Math.round((y1 - y0) / (1.5 * xh))), schief = this.zufall.gauss(0, 0.001) * (y1 - y0);
      return Array.from({ length: n + 1 }, (_, i) => [x + schief * (i / n - 0.5) + this.zufall.gauss(0, 0.012 * xh), y0 + (y1 - y0) * i / n]);
    };

    // --- Phase 1: Zeilen bauen ---
    const zeilen = [];                                   // { frei, bahn, anker, teile, linien, kasten, umbruch }
    let frei = 0, vorher = null, kasten = null, kastenNr = 0, idNr = 0;
    let quelle = anweisungenLesen(textAufbereiten(text)).text;
    if (o.gliedern) quelle = gliedern(quelle, o);
    for (const p of postenBilden(quelle.split("\n"), B)) {
      if (p.befehl) {
        const art = p.befehl;
        if (art === "leer") frei += Math.min(20, Number(p.n ?? 1));
        if (art === "seite") { zeilen.push({ umbruch: true }); frei = 0; vorher = null; }
        if (art === "kasten") { kasten = ++kastenNr; if (vorher) frei = Math.max(frei, 1); vorher = null; }
        if (art === "/kasten" && kasten) { kasten = null; frei = Math.max(frei, 1); vorher = null; }
        continue;
      }
      let roh = p.roh;
      if (!roh.trim()) { frei += 1; vorher = null; continue; }   // Leerzeile = eine Linie frei
      const neben = p.bahn === "neben";
      const [bx0, bx1] = B.bahnen[p.bahn];
      let ausrichtung = p.mitte ? "mitte" : p.rechts ? "rechts" : null;
      if (/^\s*([-*_])\1{2,}\s*$/.test(roh)) {           // --- Trennlinie
        zeilen.push({ frei, kasten, bahn: p.bahn, x0: bx0, x1: bx1, teile: [], linien: [handLinie(bx0, bx1, -0.5 * xh, 0.03)] });
        frei = 0; vorher = "linie";
        continue;
      }
      const formelZeile = /^\s*\$\$(.+)\$\$\s*$/.exec(roh);
      if (formelZeile) { roh = `$${formelZeile[1]}$`; ausrichtung = ausrichtung ?? "mitte"; }
      const ue = formelZeile ? null : ueberschriftErkennen(roh);
      const sp = ue || formelZeile ? null : stichpunktErkennen(roh);
      const nebenStichwort = vorher === "stichwort";     // Cornell: der Inhalt steht neben seinem Stichwort
      if (!neben && vorher && !frei && !nebenStichwort && ((o.abstandStichpunkte && sp && vorher === "stichpunkt") ||
                              (o.abstandUeberschrift && (ue || vorher === "ueberschrift")))) frei += 1;
      const rand = kasten ? 1.0 * xh : 0;                // Text im Kasten etwas eingerückt
      const groesse = (ue && ue.stufe === 1 ? 1.2 : 1.0) * (neben ? 0.9 : 1.0);   // Hauptüberschrift größer, Nebenrechnung kleiner
      // Steht rechts noch etwas (Strich, Spalte, Rand): Platz für die Schräglage der Großbuchstaben lassen
      const ueberhang = bx1 < papier.x_rechts - 1 ? (this.versal * groesse * this.p.neigung_tan + 0.6) * xh : 0;
      const linksRand = bx0 + rand, rechtsRand = bx1 - rand - ueberhang;
      const start = linksRand + this.zufall.uniform(-1.0, 1.5);
      const neueZeile = () => ({ frei: 0, kasten, bahn: p.bahn, x0: bx0, x1: bx1, rechts: rechtsRand, teile: [], linien: [] });
      let zeile = { ...neueZeile(), frei: neben ? 0 : frei, anker: p.anker };
      if (!neben) frei = 0;                              // freie Linien gelten der Hauptspalte, nicht der Nebenrechnung
      const anfang = zeilen.length;
      let x = start, links = start, drift = 0.0, zeilenAnfang = x, xEnde = x, markiert = false, markStart = null;
      const unterkante = () => Math.max(0.3, (zeile.tief ?? 0) + 0.2) * xh + breite + 0.6;   // unter die tiefste Unterlänge
      const markEnde = (bis) => {                        // ==Markierung== wird unterstrichen
        if (markStart !== null) zeile.linien.push(handLinie(markStart - 0.15 * xh, bis + 0.15 * xh, unterkante(), 0.04, 1));
        markStart = null;
      };
      const zeileFertig = () => {
        markEnde(xEnde);
        if (ue && o.unterstreichen && ue.stufe <= 2) zeile.linien.push(handLinie(zeilenAnfang - 0.2 * xh, xEnde + 0.3 * xh, unterkante(), 0.04, 1));
        if (p.ergebnis && zeile.teile.length) zeile.linien.push(...doppelt(zeilenAnfang - 0.15 * xh, xEnde + 0.25 * xh, unterkante()));
        if (ausrichtung) {                               // [mitte] / [rechts] / $$…$$
          const frei2 = rechtsRand - (xEnde - zeilenAnfang) - linksRand;
          const dx = (ausrichtung === "mitte" ? frei2 / 2 : frei2) - (zeilenAnfang - linksRand);
          for (const t of zeile.teile) t.x += dx;
          zeile.linien = zeile.linien.map((l) => l.map(([px, py]) => [px + dx, py]));
          zeile.ausgerichtet = true;
        }
        zeile.ende = xEnde;
        zeilen.push(zeile);
      };
      if (sp) {                                          // Spiegelstrich davor, Folgezeilen bündig eingerückt
        x = start + sp.ebene * 3.2 * xh;
        const [teile, w] = this.aufzaehlungszeichen(sp.marke);
        zeile.teile.push({ x, teile, drift: 0, neigung: this.p.neigung_tan, id: ++idNr });
        x = links = zeilenAnfang = xEnde = x + (w + 1.4) * xh;
      }
      const absatz = ue ? ue.text : sp ? sp.text : roh.trim();
      const tokens = absatz.match(/\$[^$]+\$\S*|\S+/g) || [];
      for (let tok of tokens) {
        let markiertHier = markiert;
        if (tok.startsWith("==") && tok.length > 2) { markiert = markiertHier = true; tok = tok.slice(2); }
        const ende = /==([.,;:!?)]*)$/.exec(tok);
        if (ende && markiert) { tok = tok.slice(0, ende.index) + ende[1]; markiert = false; }
        if (!tok) continue;
        let stuecke = [this.wortOderFormel(tok)];
        const platz = (rechtsRand - links) / xh / groesse;
        if (stuecke[0][1] > platz) stuecke = this.passendMachen(tok, stuecke[0], platz);
        for (let [teile, w] of stuecke) {
          if (!teile.length) continue;
          if (groesse !== 1) { teile = skaliert(teile, groesse); w *= groesse; }
          if (x > links && x + w * xh > rechtsRand) {    // Umbruch
            zeileFertig();
            zeile = neueZeile();
            x = links = sp ? links : linksRand + this.zufall.uniform(-1.0, 1.5);
            zeilenAnfang = x;
            drift = 0.0;
          }
          const neigung = this.p.neigung_tan + this.zufall.gauss(0, 0.03);
          drift = Math.max(-0.08, Math.min(0.08, drift + this.zufall.gauss(0, 0.03)));   // bleibt auf der Linie
          if (zeile.gleichX == null && /^[=≈]$/.test(tok)) zeile.gleichX = x;           // für bündige Rechenschritte
          if (zeile.strichAb == null && tok === "|") zeile.strichAb = zeile.teile.length;
          zeile.teile.push({ x, teile, drift, neigung, id: ++idNr });
          zeile.tief = Math.max(zeile.tief ?? 0, Handschrift.boxAus(teile, w).unten + Math.abs(drift));
          if (markiertHier && markStart === null) markStart = x;
          if (!markiertHier) markEnde(xEnde);
          xEnde = x + w * xh;
          x += (w + (neben ? 0.7 : 1) * Math.max(1.0, this.zufall.gauss(wortabst, 0.35))) * xh;   // Nebenrechnung enger
        }
      }
      zeileFertig();
      if (zeilen.length - anfang === 1) zeilen[anfang].einzeilig = true;
      if (!neben) vorher = p.bahn === "stichwort" ? "stichwort" : ue ? "ueberschrift" : sp ? "stichpunkt" : "text";
    }
    if (o.gliedern && o.gl_ausrichten) rechnungenAusrichten(zeilen);

    // --- Phase 2: auf Linien legen, ohne dass sich etwas berührt ---
    const zeichneZeile = (z, y, dx) => {
      const out = [];
      for (const { x, teile, drift, neigung, id } of z.teile) {
        for (const [gx, g, skala, dy] of teile) {
          const s = xh * skala, basis = y + (drift + dy) * xh;
          for (const strich of g.striche) {
            out.push({ punkte: strich.map(([px, py]) => [dx + x + gx * xh + px * s - py * s * neigung, basis + py * s]), breite, id, grund: y });
          }
        }
      }
      (z.linien || []).forEach((l, i) => out.push({ punkte: l.map(([px, py]) => [dx + px, y + py]), breite, id: `l${z.nr}-${i}` }));
      return out;
    };
    const RASTER = 1.2;                                  // Breite der Prüfstreifen in pt
    const profil = (striche, unten) => {                 // je Streifen höchster bzw. tiefster Tintenpunkt
      const m = new Map();
      const merke = (x, y) => {
        const b = Math.floor(x / RASTER);
        for (const bb of [b - 1, b, b + 1]) {
          const alt = m.get(bb);
          if (alt === undefined || (unten ? y > alt : y < alt)) m.set(bb, y);
        }
      };
      for (const s of striche) {
        const r = s.breite / 2 + 0.4;
        const pts = s.punkte;
        for (let i = 0; i < pts.length; i++) {
          merke(pts[i][0], pts[i][1] + (unten ? r : -r));
          if (i) {                                       // lange Strecken (Bruch-/Unterstriche, senkrechte Striche) abtasten
            const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
            const n = Math.ceil(Math.hypot(bx - ax, by - ay) / RASTER);
            for (let t = 1; t < n; t++) merke(ax + (bx - ax) * t / n, ay + (by - ay) * t / n + (unten ? r : -r));
          }
        }
      }
      return m;
    };
    const beruehrt = (obenProfil, ...karten) => {
      for (const [b, y] of obenProfil) for (const k of karten) if (k.has(b) && y < k.get(b)) return true;
      return false;
    };
    const vereinen = (karte, striche) => { for (const [b, y] of profil(striche, true)) if (!(karte.get(b) >= y)) karte.set(b, y); };
    const ueberlappt = (a, b) => a === b || (B.bahnen[a][0] < B.bahnen[b][1] && B.bahnen[b][0] < B.bahnen[a][1]);

    const seiten = [], sprung = o.zeilenSprung, RAHMEN_NEIGUNG = 0.003;
    const neben = (z) => z.bahn === "neben";
    // Je Seite: Tinte (unten) und Trennstriche (untenBalken) als tiefster Punkt je Streifen, belegte Linien,
    // letzte Linie je Bahn (ks), letzte Hauptzeile für Nebenrechnungen.
    let seite, unten, untenBalken, belegt, ks, kMax, letzteHaupt, spalte, dx, balken, rahmen = null;
    const leeren = () => {
      seite = []; unten = new Map(); untenBalken = new Map(); belegt = new Map(); ks = {}; kMax = -1;
      letzteHaupt = -1; spalte = 0; dx = 0; balken = {};
    };
    leeren();
    const basis = (bahn, f) => {                         // nächste freie Linie unter allem, was in dieser Bahn steht
      let b = bahn === "voll" ? kMax : -1;
      if (bahn !== "voll") for (const [n, k] of Object.entries(ks)) if (ueberlappt(n, bahn)) b = Math.max(b, k);
      return b < 0 ? 0 : b + sprung + f;
    };
    const rahmenSchliessen = () => {                     // handgezeichnetes Rechteck um den Kasten
      if (!rahmen) return;
      const pad = 0.55 * xh, x0 = rahmen.x0 - 0.35 * xh, x1 = rahmen.x1 + 0.35 * xh;
      const y0 = rahmen.min - pad, y1 = rahmen.max + pad;
      const neig = () => Math.max(-RAHMEN_NEIGUNG, Math.min(RAHMEN_NEIGUNG, this.zufall.gauss(0, 0.0015)));
      const striche = [
        { punkte: handLinie(x0, x1, y0, 0.03, -1, neig()), breite, id: "rahmen" },
        { punkte: handLinie(x0, x1, y1, 0.03, 1, neig()), breite, id: "rahmen" },
        { punkte: [[x0, y0], [x0 + this.zufall.gauss(0, 0.3), (y0 + y1) / 2], [x0 + this.zufall.gauss(0, 0.3), y1]], breite, id: "rahmen" },
        { punkte: [[x1, y0], [x1 + this.zufall.gauss(0, 0.3), (y0 + y1) / 2], [x1 + this.zufall.gauss(0, 0.3), y1]], breite, id: "rahmen" },
      ];
      seite.push(...striche);
      vereinen(unten, striche);
      rahmen = null;
    };
    const balkenFuer = (z, y) => {                       // senkrechte Striche, die neben dieser Zeile gebraucht werden
      const r = [], y0 = y - this.versal * xh, y1 = y + 0.45 * xh;
      if (B.trenner != null && B.name !== "rand" && z.bahn !== "voll") r.push({ name: "trenner", x: B.trenner, y0, y1 });
      if (z.bahn === "neben" && B.nrStrich != null) r.push({ name: "nr", x: B.nrStrich + dx, y0, y1, kasten: z.kasten });
      return r;
    };
    const balkenZeichnen = (name) => {
      const b = balken[name];
      if (!b) return;
      seite.push({ punkte: senkrecht(b.x, b.y0, b.y1), breite, id: `b-${name}-${b.y0.toFixed(1)}` });
      delete balken[name];
    };
    const balkenSetzen = (liste, ziel) => {
      for (const r of liste) {
        const a = balken[r.name];                        // Nebenrechnungen: ein Strich je zusammenhängendem Block
        if (a && r.name === "nr" && (ziel > a.k + sprung || Math.abs(a.x - r.x) > 0.5 || a.kasten !== r.kasten)) balkenZeichnen(r.name);
        const b = balken[r.name];
        balken[r.name] = b ? { ...b, y0: Math.min(b.y0, r.y0), y1: Math.max(b.y1, r.y1), k: ziel } : { ...r, k: ziel };
      }
    };
    const seiteAbschliessen = () => {
      rahmenSchliessen();
      for (const name of Object.keys(balken)) balkenZeichnen(name);
      if (B.name === "rand" && seite.length) {           // Rand über die ganze Seite
        seite.push({ punkte: senkrecht(B.trenner, linien[0] - this.versal * xh - 0.4 * xh, linien[linien.length - 1] + 0.5 * xh), breite, id: "rand" });
      }
    };
    const neueSeite = () => { seiteAbschliessen(); seiten.push(seite); leeren(); };
    const spalteWechseln = () => {                       // Zwei Spalten: rechts oben weiter
      rahmenSchliessen();
      balkenZeichnen("nr");
      spalte = 1; dx = B.spalteDx; letzteHaupt = -1;
      ks = ks.voll >= 0 ? { voll: ks.voll } : {};
    };
    const kastenBreite = new Map();                      // ganze Breite je Kasten (auch mit Nebenrechnung darin)
    for (const z of zeilen) {
      if (!z.kasten || (B.name === "rand" && neben(z))) continue;
      const [a, b] = kastenBreite.get(z.kasten) ?? [Infinity, -Infinity];
      kastenBreite.set(z.kasten, [Math.min(a, z.x0), Math.max(b, z.x1)]);
    }
    // Eine Zeile auf die erste passende Linie legen; mindestens() = frühestens diese Linie. Liefert die Linie.
    const platzieren = (z, mindestens = () => -1, frei = z.frei) => {
      if (rahmen && rahmen.nr !== z.kasten && z.bahn !== "stichwort") rahmenSchliessen();
      const zielVon = () => {
        let ziel = Math.max(basis(z.bahn, frei), mindestens());
        if (z.anker === "vorher" && letzteHaupt >= 0) ziel = Math.max(ziel, letzteHaupt);   // Nebenrechnung neben ihre Zeile
        return ziel;
      };
      let ziel = zielVon();
      for (;;) {
        if (ziel >= linien.length) {                     // passt auf dieser Seite (Spalte) nirgends mehr
          if (B.spalteDx && spalte === 0 && z.bahn !== "voll") spalteWechseln(); else neueSeite();
          ziel = zielVon();
          continue;
        }
        const y = linien[ziel];
        const striche = zeichneZeile(z, y, dx);
        let pruef = striche;
        const imRahmen = z.kasten && !(B.name === "rand" && neben(z));   // Nebenrechnungen im Rand stehen außerhalb
        const [x0, x1] = (imRahmen ? kastenBreite.get(z.kasten) : [z.x0, z.x1]).map((v) => v + dx);
        if (imRahmen && (!rahmen || rahmen.nr !== z.kasten)) {   // erste Kastenzeile: künftige Oberkante mitprüfen
          const lo = Math.min(y - this.versal * xh, ...striche.flatMap((s) => s.punkte.map(([, py]) => py)));
          const yk = lo - 0.75 * xh - RAHMEN_NEIGUNG * (x1 - x0 + 2 * xh);   // auch wenn der Strich etwas schräg läuft
          pruef = striche.concat({ punkte: [[x0 - 0.5 * xh, yk], [x1 + 0.5 * xh, yk]], breite });
        }
        const balkenHier = striche.length ? balkenFuer(z, y) : [];
        const balkenStriche = balkenHier.map((b) => ({ punkte: [[b.x, b.y0], [b.x, b.y1]], breite }));
        // Lesereihenfolge: nichts darf über die Grundlinie der vorigen Zeile derselben Lesespalte ragen
        // (sonst wirkt es wie dieselbe Zeile); Zeilen über die ganze Breite zählen für alle Spalten.
        const spur = `${neben(z) || z.bahn === "stichwort" ? z.bahn : "haupt"}${spalte}`;
        const zaehlt = (v) => z.bahn === "voll" ? [...belegt.values()].some((b) => b.has(v)) : belegt.get(spur)?.has(v) || belegt.get("voll")?.has(v);
        let vor = ziel - 1;
        while (vor >= 0 && !zaehlt(vor)) vor--;
        const ys = pruef.flatMap((s) => s.punkte.map(([, py]) => py));
        const ueberGrundlinie = vor >= 0 && ys.length > 0 && Math.min(...ys) < linien[vor] + 0.2 * xh;
        if (ueberGrundlinie || beruehrt(profil(pruef, false), unten, untenBalken) || beruehrt(profil(balkenStriche, false), unten)) {
          ziel += 1;
          continue;
        }
        for (const s of striche) if (s.grund != null) s.spur = spur;   // für die Tests
        seite.push(...striche);
        vereinen(unten, striche);
        vereinen(untenBalken, balkenStriche);
        balkenSetzen(balkenHier, ziel);
        for (const s of z.bahn === "voll" ? [spur, "voll"] : [spur]) {
          if (!belegt.has(s)) belegt.set(s, new Set());
          belegt.get(s).add(ziel);
        }
        ks[z.bahn] = Math.max(ks[z.bahn] ?? -1, ziel);
        kMax = Math.max(kMax, ziel);
        if (z.bahn !== "neben" && z.bahn !== "stichwort") letzteHaupt = ziel;
        if (imRahmen) {
          const tinte = striche.flatMap((s) => s.punkte.map(([, py]) => py));
          const lo = Math.min(y - this.versal * xh, ...tinte), hi = Math.max(y + 0.6 * xh, ...tinte);
          rahmen = rahmen ? { ...rahmen, min: Math.min(rahmen.min, lo), max: Math.max(rahmen.max, hi), x0: Math.min(rahmen.x0, x0), x1: Math.max(rahmen.x1, x1) }
            : { nr: z.kasten, min: lo, max: hi, x0, x1 };
        }
        return ziel;
      }
    };
    // Cornell: ein Stichwort wartet auf seinen Inhalt und kommt dann genau auf dessen erste Linie.
    let wartend = [];
    const stichwortSetzen = (inhaltLinie = null) => {
      wartend.forEach((c, i) => platzieren(c, () => (i ? -1 : inhaltLinie ?? basis("haupt", c.frei))));
      wartend = [];
    };
    for (const [nr, z] of zeilen.entries()) {
      z.nr = nr;
      if (z.bahn === "stichwort") {
        if (z.anker === "nachher" && wartend.length) stichwortSetzen();
        wartend.push(z);
        continue;
      }
      if (wartend.length && (z.bahn === "haupt" || z.bahn === "schmal")) {
        const erstes = wartend[0];
        stichwortSetzen(platzieren(z, () => basis("stichwort", erstes.frei), Math.max(z.frei, erstes.frei)));
        continue;
      }
      if (wartend.length) stichwortSetzen();
      if (z.umbruch) { if (seite.length) neueSeite(); continue; }
      platzieren(z);
    }
    stichwortSetzen();
    seiteAbschliessen();
    if (seite.length) seiten.push(seite);
    return seiten;
  }

  // Zu breit für die Zeile: Wörter mit Trennstrich teilen, Formeln verkleinern.
  passendMachen(tok, [teile, w], platz) {
    if (tok.startsWith("$") || MATHE_ERKENNEN.test(tok)) {
      const f = platz / w;
      return [[teile.map(([gx, g, s, d]) => [gx * f, g, s * f, d * f]), w * f]];
    }
    const stuecke = [];
    let rest = [...tok];
    while (rest.length) {
      let n = rest.length, stueck;
      for (;;) {                                         // das gemessene Stück behalten (neu erzeugt wäre es anders breit)
        stueck = this.wort(rest.slice(0, n).join("") + (n < rest.length ? "-" : ""));
        if (n <= 1 || stueck[1] <= platz) break;
        n--;
      }
      stuecke.push(stueck);
      rest = rest.slice(n);
    }
    return stuecke;
  }
}

// --- Voreinstellungen und regelbasierte Gliederung ---------------------------------------

export const VOREINSTELLUNGEN = {
  kompakt: { abstandStichpunkte: false, abstandUeberschrift: false, unterstreichen: true, zeilenSprung: 1, groesse: 0.95,
             wortabstand: 0.85, buchstabenabstand: 0.95 },
  normal: { abstandStichpunkte: true, abstandUeberschrift: true, unterstreichen: true, zeilenSprung: 1, groesse: 1.0,
            wortabstand: 1.0, buchstabenabstand: 1.0 },
  luftig: { abstandStichpunkte: true, abstandUeberschrift: true, unterstreichen: true, zeilenSprung: 2, groesse: 1.0,
            wortabstand: 1.15, buchstabenabstand: 1.05 },
};

// Layout und Gliederung – unabhängig vom Platz-Preset. Die gl_*-Regeln wirken nur, wenn „gliedern“ an ist.
export const GLIEDERUNG = {
  layout: "standard", gliedern: false, gl_ueberschriften: true, gl_saetze: true, gl_aufzaehlungen: true, gl_begriffe: true,
  gl_merke: true, gl_neben: true, gl_ergebnis: true, gl_ausrichten: true,
};

const ABKUERZUNG = /(?:\b(?:z\.\s?B|d\.\s?h|u\.\s?a|bzw|ca|usw|vgl|Nr|Art|Abs|ggf|evtl|bspw|inkl|etc|Dr|Prof|St|S|Mio|Mrd|Jh|v\.\s?Chr|n\.\s?Chr)|\d)\.$/;

function saetzeTeilen(t) {
  const saetze = [];
  let start = 0, inFormel = false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "$") inFormel = !inFormel;
    if (inFormel || !".!?".includes(t[i]) || t[i + 1] !== " " || !/[A-ZÄÖÜ0-9„"(]/.test(t[i + 2] ?? "")) continue;
    const satz = t.slice(start, i + 1);
    if (t[i] === "." && ABKUERZUNG.test(satz)) continue;
    saetze.push(satz.trim());
    start = i + 2;
  }
  saetze.push(t.slice(start).trim());
  return saetze.filter(Boolean);
}

const MERKWORT = /^(merke|wichtig|achtung|beachte|definition|def\.?|satz|regel|hinweis|tipp|gesetz|lehrsatz)\s*:/i;
const BUCHSTABE = /[A-Za-zÄÖÜäöüßα-ωΔΣΩπ]/;
const ERGEBNIS = /^\$?\s*(?:[A-Za-zα-ωΔ](?:_\{?\w+\}?|\(\w\))?\s*)?[=≈]\s*[-−+]?\s*\d[\d.,]*\s*(?:[a-zA-Zµ°€%]{1,4}[²³]?)?\s*\$?\s*\.?$|^L\s*=\s*\{[^}]*\}$/;
const sonderzeile = (z) => BEFEHL.test(z) || PRAEFIX.test(z) || /^\s*([-*_])\1{2,}\s*$/.test(z) || /^\s*\$\$/.test(z);

// Rechnung: Gleichung/Ungleichung mit höchstens einem richtigen Wort („Lösung: x = 5“, „A = 12 · 7,5“).
function istRechnung(t) {
  const s = t.replace(/==/g, "");
  if (!/[=≈≤≥≠<>]/.test(s)) return false;
  return (s.replace(/\\[a-zA-Z]+/g, "").match(/[A-Za-zÄÖÜäöüß]{4,}/g) || []).length <= 1;
}
// Reine Zahlenrechnung ohne Variablen, z. B. „12 · 7,5 = 90“ – typisch für Nebenrechnungen.
const nurZahlen = (t) => /^[\d\s.,+\-−·*×:/=≈()%]+$/.test(t) && t.includes("=") && /[+\-−·*×:/]/.test(t.replace(/^\s*[-−]/, ""));

// Ohne KI, nur mit festen Regeln (jede einzeln abschaltbar):
// Nebenrechnungen erkennen, Ergebnisse doppelt unterstreichen, Merksätze einrahmen, Überschriften erkennen,
// Aufzählungen im Satz zu Stichpunkten, Absätze aus mehreren Sätzen zu Stichpunkten, Fachbegriffe unterstreichen.
export function gliedern(text, regeln = GLIEDERUNG) {
  const an = (k) => regeln[k] !== false;
  let z = text.split("\n");
  const ue = (l) => ueberschriftErkennen(l);
  const normal = (l) => l.trim() && !sonderzeile(l) && !ue(l);   // gewöhnliche Text- oder Stichpunktzeile

  if (an("gl_neben") || an("gl_ergebnis")) {             // Rechnungen absatzweise
    const bloecke = [];
    let block = [];
    z.forEach((l, i) => { if (!l.trim() || BEFEHL.test(l) || ue(l)) { if (block.length) bloecke.push(block); block = []; } else block.push(i); });
    if (block.length) bloecke.push(block);
    for (const b of bloecke) {
      let variable = false;
      const haupt = [];
      for (const i of b) {
        const t = z[i].trim();
        if (PRAEFIX.test(t) || NEBENRECHNUNG.test(t)) continue;
        const ohneKlammer = /^\((.*)\)$/.exec(t)?.[1].trim() ?? t;
        if (an("gl_neben") && variable && nurZahlen(ohneKlammer)) { z[i] = `[neben] ${ohneKlammer}`; continue; }
        if (!istRechnung(t)) continue;
        haupt.push(i);
        if (BUCHSTABE.test(t.replace(/\\[a-zA-Z]+/g, ""))) variable = true;
      }
      const letzte = haupt[haupt.length - 1];
      if (an("gl_ergebnis") && haupt.length >= 2 && ERGEBNIS.test(z[letzte].trim())) z[letzte] = `[ergebnis] ${z[letzte].trim()}`;
    }
  }

  if (an("gl_merke")) {                                  // „Merke: …“, „Definition: …“ → Kasten
    const aus = [];
    let imKasten = false;
    for (let i = 0; i < z.length; i++) {
      const t = z[i].trim();
      if (/^\[kasten\]$/i.test(t)) imKasten = true;
      if (/^\[\/kasten\]$/i.test(t)) imKasten = false;
      if (imKasten || !MERKWORT.test(t)) { aus.push(z[i]); continue; }
      const nurWort = /:\s*$/.test(t);                   // „Merke:“ allein: bis zur Leerzeile; sonst nur folgende Stichpunkte
      let j = i + 1;
      while (j < z.length && z[j].trim() && !sonderzeile(z[j]) && !/^#/.test(z[j].trim()) && !MERKWORT.test(z[j].trim())
             && (nurWort || stichpunktErkennen(z[j]))) j++;
      aus.push("[kasten]", ...z.slice(i, j), "[/kasten]");
      i = j - 1;
    }
    z = aus;
  }

  if (an("gl_ueberschriften")) {                         // kurze Zeile vor einem Absatz → Überschrift
    const kurz = (t) => /^[A-ZÄÖÜ]/.test(t) && t.length <= 50 && t.split(/\s+/).length <= 6 && /[A-Za-zÄÖÜäöüß]{3}/.test(t)
      && !/[.!?,;:…]$/.test(t) && !/[=$|]/.test(t);
    const erste = z.findIndex((l) => l.trim() && !BEFEHL.test(l));      // erste Zeile mit Inhalt → Titel
    const genug = z.filter(normal).length >= 4;
    z = z.map((l, i) => {
      const t = l.trim();
      if (!normal(l) || stichpunktErkennen(l) || !kurz(t)) return l;
      if (i === erste && genug) return `# ${t}`;
      const davor = i === 0 || !z[i - 1].trim() || BEFEHL.test(z[i - 1]);
      const nach = z[i + 1] ?? "";
      const absatz = normal(nach) && (stichpunktErkennen(nach) || nach.trim().split(/\s+/).length >= 5 || istRechnung(nach));
      return davor && absatz ? `## ${t}` : l;
    });
  }

  if (an("gl_aufzaehlungen")) {                          // „Es gibt drei Arten: A, B und C.“ → Stichpunkte
    z = z.flatMap((l) => {
      if (!normal(l)) return [l];
      const sp = stichpunktErkennen(l);
      const m = /^([^:$=]{3,80}):\s+(.+?)\.?$/.exec(sp ? sp.text : l.trim());
      if (!m || !/,\s/.test(m[2])) return [l];
      const teile = m[2].split(/,\s+|\s+(?:und|oder|sowie)\s+/).map((s) => s.trim()).filter(Boolean);
      if (teile.length < 3 || teile.some((s) => s.split(/\s+/).length > 4 || /[.!?;=$:]/.test(s))) return [l];
      const ebene = sp ? sp.ebene : 0;
      const unter = "  ".repeat(sp ? ebene + 1 : 0);
      return [sp ? `${"  ".repeat(ebene)}${sp.marke} ${m[1]}:` : `${m[1]}:`, ...teile.map((s) => `${unter}- ${s}`)];
    });
  }

  if (an("gl_saetze")) {                                 // Absatz aus mehreren Sätzen → ein Stichpunkt je Satz
    let imKasten = false;
    z = z.flatMap((l) => {
      if (/^\s*\[kasten\]\s*$/i.test(l)) imKasten = true;
      if (/^\s*\[\/kasten\]\s*$/i.test(l)) imKasten = false;
      if (imKasten || !normal(l) || stichpunktErkennen(l) || istRechnung(l) || MERKWORT.test(l.trim())) return [l];
      const saetze = saetzeTeilen(l.trim());
      return saetze.length > 1 ? saetze.map((s) => `- ${s}`) : [l];
    });
  }

  if (an("gl_begriffe")) {                               // „Zellkern: enthält die DNA“ → Begriff unterstreichen
    z = z.map((l) => {
      if (!normal(l)) return l;
      const sp = stichpunktErkennen(l);
      const t = sp ? sp.text : l.trim();
      const m = /^([A-ZÄÖÜ][\wäöüßÄÖÜ-]*(?: [\wäöüßÄÖÜ-]+){0,2})(:\s+|\s[-–]\s+)(\S.*)$/.exec(t);
      if (!m || MERKWORT.test(`${m[1]}:`) || m[3].split(/\s+/).length < 2 || !BUCHSTABE.test(m[3]) || istRechnung(m[3])) return l;
      const neu = `==${m[1]}==${m[2].includes(":") ? ": " : " – "}${m[3]}`;
      return sp ? `${"  ".repeat(sp.ebene)}${sp.marke} ${neu}` : neu;
    });
  }
  return z.join("\n");
}

// --- GoodNotes-Datei ------------------------------------------------------------------

const enc = new TextEncoder();
const GERAET = 1184897455800006800n;                     // Konstanten aus GoodNotes-7.1-Dateien
const APP = 5381, KUGELSCHREIBER = 24;
export const SUCH_STUB = Uint8Array.from([0x04, 0x10, 0x01, 0x1a, 0x00]);

function verbinden(teile) {
  const out = new Uint8Array(teile.reduce((n, t) => n + t.length, 0));
  let o = 0;
  for (const t of teile) { out.set(t, o); o += t.length; }
  return out;
}

function varint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    out.push(v ? b | 0x80 : b);
  } while (v);
  return Uint8Array.from(out);
}
const schluessel = (feld, typ) => varint((feld << 3) | typ);
const fV = (feld, n) => verbinden([schluessel(feld, 0), varint(n)]);
const fB = (feld, b) => verbinden([schluessel(feld, 2), varint(b.length), b]);
const fS = (feld, s) => fB(feld, enc.encode(s));
const fF = (feld, x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return verbinden([schluessel(feld, 5), b]); };
const datensatz = (msg) => verbinden([varint(msg.length), msg]);

function tplKugelschreiber(breite, punkte) {
  const fmt = enc.encode("vuA(v)A(S(uu))A(S(uuuu))vA(f)\0");
  const rest = punkte.slice(1);
  if (rest.length % 2) rest.push(rest[rest.length - 1]);
  const paare = rest.length / 2;
  const body = new DataView(new ArrayBuffer(2 + 4 + 4 + 2 * (paare + 1) + 4 + 8 + 4 + 16 * paare + 2 + 4));
  let o = 0;
  const u16 = (v) => { body.setUint16(o, v, true); o += 2; };
  const u32 = (v) => { body.setUint32(o, v, true); o += 4; };
  const f32 = (v) => { body.setFloat32(o, v, true); o += 4; };
  u16(2); f32(breite);                                   // Version, Strichbreite
  u32(paare + 1); u16(0); for (let i = 0; i < paare; i++) u16(1);   // Stift-Flags
  u32(1); f32(punkte[0][0]); f32(punkte[0][1]);          // Startpunkt
  u32(paare);
  for (let i = 0; i < rest.length; i += 2) { f32(rest[i][0]); f32(rest[i][1]); f32(rest[i + 1][0]); f32(rest[i + 1][1]); }
  u16(1); u32(0);
  const kopf = new DataView(new ArrayBuffer(8));
  kopf.setUint32(0, 0x006c7074, true);                   // "tpl\0"
  kopf.setUint32(4, 8 + fmt.length + body.byteLength, true);
  return verbinden([new Uint8Array(kopf.buffer), fmt, new Uint8Array(body.buffer)]);
}

function lz4Block(src) {
  // Gieriger LZ4-Blockkompressor (gültiges LZ4-Blockformat, wie NSData .lz4 es erwartet).
  const n = src.length, out = [], tabelle = new Map();
  let anker = 0, i = 0;
  const laenge = (r) => { while (r >= 255) { out.push(255); r -= 255; } out.push(r); };
  const ausgeben = (lit0, lit1, treffer, abstand) => {
    const lit = lit1 - lit0;
    const m = treffer === null ? 0 : treffer - 4;
    out.push(((lit >= 15 ? 15 : lit) << 4) | (treffer === null ? 0 : (m >= 15 ? 15 : m)));
    if (lit >= 15) laenge(lit - 15);
    for (let k = lit0; k < lit1; k++) out.push(src[k]);
    if (treffer !== null) {
      out.push(abstand & 0xff, abstand >> 8);
      if (m >= 15) laenge(m - 15);
    }
  };
  while (i < n - 12) {
    const h = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
    const kand = tabelle.get(h);
    tabelle.set(h, i);
    if (kand !== undefined && i - kand <= 0xffff) {
      let m = 4;
      while (i + m < n - 5 && src[kand + m] === src[i + m]) m++;
      ausgeben(anker, i, m, i - kand);
      i += m;
      anker = i;
      continue;
    }
    i++;
  }
  ausgeben(anker, n, null, 0);
  return Uint8Array.from(out);
}

function appleLz4(daten) {
  const teile = [];
  for (let i = 0; i < daten.length; i += 0x10000) {
    const stueck = daten.subarray(i, i + 0x10000);
    const komp = lz4Block(stueck);
    const kopf = new DataView(new ArrayBuffer(12));
    kopf.setUint32(0, 0x31347662, true);                 // "bv41"
    kopf.setUint32(4, stueck.length, true);
    kopf.setUint32(8, komp.length, true);
    teile.push(new Uint8Array(kopf.buffer), komp);
  }
  teile.push(enc.encode("bv4$"));
  return verbinden(teile);
}

const uuid = () => crypto.randomUUID().toUpperCase();

function strichDatensaetze(lz4, zaehler, zeit) {
  const id = uuid();
  const uhr = verbinden([fV(1, 2), fV(2, Math.floor(Math.random() * 2 ** 32))]);
  const meta = verbinden([fS(1, id), fB(2, uhr), fS(6, uuid()), fV(8, GERAET), fV(9, zaehler), fV(14, APP), fV(16, KUGELSCHREIBER)]);
  const rgba = verbinden([fF(1, 0), fF(2, 0), fF(3, 0), fF(4, 1)]);
  const inner = verbinden([fS(1, id), fB(2, lz4), fB(4, rgba), fB(6, new Uint8Array()),
    fB(7, fB(1, verbinden([fV(1, zaehler), fV(2, zeit)]))), fB(9, new Uint8Array()),
    fB(15, uhr), fB(20, new Uint8Array()), fV(21, KUGELSCHREIBER)]);
  return verbinden([datensatz(meta), datensatz(fB(7, inner))]);
}

export function notizStream(striche) {
  const teile = [];
  let zaehler = 3653600;
  const zeit = Date.now();
  for (const s of striche) {
    if (!s.punkte.length) continue;
    zaehler += 1;
    const pts = s.punkte.map(([x, y]) => [x * GN_PRO_PT, y * GN_PRO_PT]);
    if (pts.length === 1) pts.push([pts[0][0] + 0.01, pts[0][1] + 0.01]);
    teile.push(strichDatensaetze(appleLz4(tplKugelschreiber(Math.max(0.5, s.breite * GN_PRO_PT), pts)), zaehler, zeit));
  }
  return verbinden(teile);
}

// --- ZIP (unkomprimiert, wie GoodNotes es akzeptiert) ------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(d) { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function zipStored(eintraege) {
  const teile = [], zentral = [];
  let versatz = 0;
  for (const [name, daten] of eintraege) {
    const n = enc.encode(name), crc = crc32(daten);
    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true); lokal.setUint16(4, 20, true); lokal.setUint16(12, 0x21, true);
    lokal.setUint32(14, crc, true); lokal.setUint32(18, daten.length, true); lokal.setUint32(22, daten.length, true);
    lokal.setUint16(26, n.length, true);
    teile.push(new Uint8Array(lokal.buffer), n, daten);
    const z = new DataView(new ArrayBuffer(46));
    z.setUint32(0, 0x02014b50, true); z.setUint16(4, 20, true); z.setUint16(6, 20, true); z.setUint16(14, 0x21, true);
    z.setUint32(16, crc, true); z.setUint32(20, daten.length, true); z.setUint32(24, daten.length, true);
    z.setUint16(28, n.length, true); z.setUint32(42, versatz, true);
    zentral.push(new Uint8Array(z.buffer), n);
    versatz += 30 + n.length + daten.length;
  }
  const cd = verbinden(zentral);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true); ende.setUint16(8, eintraege.length, true); ende.setUint16(10, eintraege.length, true);
  ende.setUint32(12, cd.length, true); ende.setUint32(16, versatz, true);
  return verbinden([...teile, cd, new Uint8Array(ende.buffer)]);
}

const ausBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// --- Frische Kennungen ------------------------------------------------------------------
// Jede Papier-Vorlage ist eine leere Seite aus GoodNotes mit dessen eigener Vorlage (Kariert, Liniert schmal,
// Liniert breit; A4 und Standard). Ohne Weiteres trüge jede Datei eines Papiers dieselben Dokument-, Seiten-,
// Papier- und Anhangskennungen, und GoodNotes könnte Papier oder Seite einer früher importierten Datei
// wiederverwenden. Darum bekommt jede Datei neue Kennungen.

const KENNUNG = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/g;
const alsZahl = (k) => BigInt(`0x${k.replaceAll("-", "")}`);
function alsKennung(n) {
  const h = n.toString(16).toUpperCase().padStart(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function varintLesen(b, i) {
  let n = 0, faktor = 1;
  for (;;) {
    const x = b[i++];
    n += (x & 0x7f) * faktor;
    faktor *= 128;
    if (!(x & 0x80)) return [n, i];
  }
}

// Felder einer Protobuf-Nachricht: Feldnummer, Inhalt (nur Typ 2) und die Rohbytes des ganzen Felds.
function protoFelder(b) {
  const felder = [];
  for (let i = 0; i < b.length;) {
    const start = i;
    let kopf, n, wert = null;
    [kopf, i] = varintLesen(b, i);
    const typ = kopf & 7;
    if (typ === 0) [, i] = varintLesen(b, i);
    else if (typ === 1) i += 8;
    else if (typ === 5) i += 4;
    else if (typ === 2) { [n, i] = varintLesen(b, i); wert = b.subarray(i, i + n); i += n; }
    else throw new Error(`Unbekannter Protobuf-Typ ${typ}`);
    felder.push({ feld: kopf >>> 3, wert, roh: b.subarray(start, i) });
  }
  return felder;
}

function datensaetze(b) {
  const liste = [];
  for (let i = 0; i < b.length;) {
    let n;
    [n, i] = varintLesen(b, i);
    liste.push(b.subarray(i, i + n));
    i += n;
  }
  return liste;
}

// Kennungen des Dokuments selbst: Dateinamen, Schlüssel der Ereignisse, Ereignis-IDs (Feld 11) und Feld 15 –
// nicht die Verweise auf GoodNotes' Katalog (Vorlage, Cover). Seite und Notizebene haben aufeinanderfolgende
// Kennungen (…502F/…5030); das bleibt so, sonst findet GoodNotes die Striche der Seite nicht.
function frischeKennungen(vorlage) {
  const alt = new Set();
  for (const name of vorlage.keys()) for (const k of name.match(KENNUNG) ?? []) alt.add(k);
  for (const satz of datensaetze(vorlage.get("index.events.pb"))) {
    const [schluessel, inhalt] = protoFelder(satz);
    alt.add(String.fromCharCode(...schluessel.wert));
    for (const f of protoFelder(inhalt.wert)) if ((f.feld === 11 || f.feld === 15) && f.wert?.length === 36) alt.add(String.fromCharCode(...f.wert));
  }
  const karte = new Map();
  for (const k of [...alt].sort()) {                     // sortiert: der Vorgänger ist immer schon vergeben
    const vorgaenger = alsKennung(alsZahl(k) - 1n);
    karte.set(k, karte.has(vorgaenger) ? alsKennung(alsZahl(karte.get(vorgaenger)) + 1n) : uuid());
  }
  return karte;
}

function kennungenTauschen(daten, karte) {
  const aus = daten.slice();
  for (let i = 0; i + 36 <= aus.length; i++) {
    if (aus[i + 8] !== 45 || aus[i + 13] !== 45 || aus[i + 18] !== 45 || aus[i + 23] !== 45) continue;   // 45 = „-“
    const neu = karte.get(String.fromCharCode(...aus.subarray(i, i + 36)));
    if (neu) { aus.set(enc.encode(neu), i); i += 35; }
  }
  return aus;
}

// Einseitige .goodnotes-Datei: Papier und Index der Vorlage, Striche/Suchindex/Vorschaubild neu.
export function goodnotesDatei(striche, papier, vorschauJpeg = null) {
  const vorlage = new Map(papier.eintraege.map(([name, b64]) => [name, ausBase64(b64)]));
  const karte = frischeKennungen(vorlage);
  const neu = { [`notes/${papier.seite}`]: notizStream(striche), [`search/${papier.seite}`]: SUCH_STUB };
  const eintraege = [];
  for (const [name, daten] of vorlage) {
    eintraege.push([name.replace(KENNUNG, (k) => karte.get(k) ?? k), neu[name] ?? kennungenTauschen(daten, karte)]);
    if (name === "index.events.pb" && vorschauJpeg) eintraege.push(["thumbnail.jpg", vorschauJpeg]);
  }
  return zipStored(eintraege);
}
