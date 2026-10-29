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
    .replace(/\*\*|__|`/g, "")                            // Fett/Code; „* “ als Stichpunkt bleibt
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
  if (t.length <= 45 && /:$/.test(t) && !/[.!?;]/.test(t.slice(0, -1)) && t.split(/\s+/).length <= 6) return { text: t, stufe: 3 };
  return null;
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
  "…": [[[0.1, -0.05], [0.12, -0.03]], [[0.5, -0.05], [0.52, -0.03]], [[0.9, -0.05], [0.92, -0.03]]],
};

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

  wort(text) {
    const teile = [];
    let x = 0;
    for (const c of text) {
      let g = this.variante(c === "–" ? "-" : c);
      if (!g) continue;
      if (teile.length) x += Math.max(0.12, this.zufall.gauss(this.p.luecke, 0.25 * this.p.luecke_streuung)) * (this.buchstabenabstand ?? 1);
      let faktor = VERSALHOCH.has(c) ? this.versal / Handschrift.hoehe(g) : 1.0;   // einheitliche Ziffernhöhe
      let skala = faktor * this.zufall.gauss(1.0, 0.04);
      let dy = this.zufall.gauss(0.0, 0.05);
      if (/[0-9]/.test(c)) dy -= Math.max(...g.striche.flatMap((s) => s.map(([, y]) => y))) * skala;
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
      const striche = ERSATZ[c].map((s) => s.map(([x, y]) => [x + this.zufall.gauss(0, 0.02), y + this.zufall.gauss(0, 0.02)]));
      const breite = Math.max(...striche.flat().map(([x]) => x));
      return Handschrift.boxAus([[0, { striche, breite }, 1, 0]], breite);
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
  // Phase 1 baut die Zeilen (Umbruch, Stichpunkte, Formeln), Phase 2 legt jede Zeile auf die nächste Linie,
  // auf der sie nichts berührt – so überlappt nie etwas (Hochzahlen, Brüche, Unterstriche, Unterlängen).
  setzen(text, papier, optionen = {}) {
    const o = { ...VOREINSTELLUNGEN.normal, ...optionen };
    this.buchstabenabstand = o.buchstabenabstand;
    const xh = this.schriftgroesse(papier) * o.groesse;
    const oben = Math.max(36.0, this.versal * xh + 14);
    const linien = papier.linien.filter((y) => y >= oben && y <= papier.hoehe - 2.2 * xh);
    const wortabst = Math.min(Math.max(this.p.wortabstand, 1.5), 3.5) * o.wortabstand;
    const breite = this.p.strichbreite_pt;

    // --- Phase 1: Zeilen bauen ---
    const zeilen = [];                                   // { frei, teile: [{x, teile, drift, neigung}], unterstrich }
    let frei = 0, vorher = null;                         // vorher: "text" | "stichpunkt" | "ueberschrift"
    let quelle = textAufbereiten(text);
    if (o.gliedern) quelle = gliedern(quelle);
    for (const roh of quelle.split("\n")) {
      if (!roh.trim()) { frei += 1; vorher = null; continue; }   // Leerzeile = eine Linie frei
      const ue = ueberschriftErkennen(roh);
      const sp = ue ? null : stichpunktErkennen(roh);
      if (vorher && !frei && ((o.abstandStichpunkte && sp && vorher === "stichpunkt") ||
                              (o.abstandUeberschrift && (ue || vorher === "ueberschrift")))) frei += 1;
      const start = papier.x_links + this.zufall.uniform(-1.0, 1.5);
      let zeile = { frei, teile: [], unterstrich: null };
      frei = 0;
      let x = start, links = start, drift = 0.0, zeilenAnfang = x, xEnde = x;
      const unterstreichen = () => {
        if (!(ue && o.unterstreichen)) return;
        const x0 = zeilenAnfang - 0.2 * xh, x1 = xEnde + 0.3 * xh, n = Math.max(2, Math.round((x1 - x0) / (1.5 * xh)));
        const neig = this.zufall.gauss(0, 0.01);
        zeile.unterstrich = Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n,
          0.3 * xh + (x1 - x0) * (i / n) * neig + this.zufall.gauss(0, 0.04 * xh)]);
      };
      if (sp) {                                          // Spiegelstrich davor, Folgezeilen bündig eingerückt
        x = start + sp.ebene * 3.2 * xh;
        const [teile, w] = this.aufzaehlungszeichen(sp.marke);
        zeile.teile.push({ x, teile, drift: 0, neigung: this.p.neigung_tan });
        x = links = zeilenAnfang = xEnde = x + (w + 1.4) * xh;
      }
      const absatz = ue ? ue.text : sp ? sp.text : roh.trim();
      for (const tok of absatz.match(/\$[^$]+\$\S*|\S+/g) || []) {
        const [teile, w] = this.wortOderFormel(tok);
        if (!teile.length) continue;
        if (x > links && x + w * xh > papier.x_rechts) {   // Umbruch
          unterstreichen();
          zeilen.push(zeile);
          zeile = { frei: 0, teile: [], unterstrich: null };
          x = links = sp ? links : papier.x_links + this.zufall.uniform(-1.0, 1.5);
          zeilenAnfang = x;
          drift = 0.0;
        }
        const neigung = this.p.neigung_tan + this.zufall.gauss(0, 0.03);
        drift = Math.max(-0.08, Math.min(0.08, drift + this.zufall.gauss(0, 0.03)));   // bleibt auf der Linie
        zeile.teile.push({ x, teile, drift, neigung });
        xEnde = x + w * xh;
        x += (w + Math.max(1.0, this.zufall.gauss(wortabst, 0.35))) * xh;
      }
      unterstreichen();
      zeilen.push(zeile);
      vorher = ue ? "ueberschrift" : sp ? "stichpunkt" : "text";
    }

    // --- Phase 2: auf Linien legen, ohne dass sich etwas berührt ---
    const zeichneZeile = (z, y) => {
      const out = [];
      for (const { x, teile, drift, neigung } of z.teile) {
        for (const [gx, g, skala, dy] of teile) {
          const s = xh * skala, basis = y + (drift + dy) * xh;
          for (const strich of g.striche) {
            out.push({ punkte: strich.map(([px, py]) => [x + gx * xh + px * s - py * s * neigung, basis + py * s]), breite });
          }
        }
      }
      if (z.unterstrich) out.push({ punkte: z.unterstrich.map(([px, py]) => [px, y + py]), breite });
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
          if (i) {                                       // lange Strecken (Bruch-/Unterstriche) abtasten
            const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
            const n = Math.ceil(Math.hypot(bx - ax, by - ay) / RASTER);
            for (let t = 1; t < n; t++) merke(ax + (bx - ax) * t / n, ay + (by - ay) * t / n + (unten ? r : -r));
          }
        }
      }
      return m;
    };
    const beruehrt = (obenProfil, untenProfile) => {
      for (const [b, y] of obenProfil) for (const u of untenProfile) if (u.has(b) && y < u.get(b)) return true;
      return false;
    };

    const seiten = [];
    let seite = [], darueber = [], k = -1;
    for (const z of zeilen) {
      let ziel = k < 0 ? 0 : k + o.zeilenSprung * (1 + z.frei);
      for (;;) {
        if (ziel >= linien.length) {                     // neue Seite
          seiten.push(seite);
          seite = []; darueber = []; k = -1; ziel = 0;
        }
        const striche = zeichneZeile(z, linien[ziel]);
        if (darueber.length && beruehrt(profil(striche, false), darueber) && ziel + 1 < linien.length) { ziel += 1; continue; }
        seite.push(...striche);
        darueber = [profil(striche, true), darueber[0]].filter(Boolean);
        k = ziel;
        break;
      }
    }
    if (seite.length) seiten.push(seite);
    return seiten;
  }
}

// --- Voreinstellungen und regelbasierte Gliederung ---------------------------------------

export const VOREINSTELLUNGEN = {
  kompakt: { abstandStichpunkte: false, abstandUeberschrift: false, unterstreichen: true, zeilenSprung: 1, groesse: 0.95,
             wortabstand: 0.85, buchstabenabstand: 0.95, gliedern: false },
  normal: { abstandStichpunkte: true, abstandUeberschrift: true, unterstreichen: true, zeilenSprung: 1, groesse: 1.0,
            wortabstand: 1.0, buchstabenabstand: 1.0, gliedern: false },
  luftig: { abstandStichpunkte: true, abstandUeberschrift: true, unterstreichen: true, zeilenSprung: 2, groesse: 1.0,
            wortabstand: 1.15, buchstabenabstand: 1.05, gliedern: false },
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

// Ohne KI: Absätze aus mehreren Sätzen werden zu Stichpunkten (ein Satz je Punkt); Überschriften,
// vorhandene Stichpunkte und einzelne Sätze bleiben, wie sie sind.
export function gliedern(text) {
  return text.split("\n").map((zeile) => {
    if (!zeile.trim() || ueberschriftErkennen(zeile) || stichpunktErkennen(zeile)) return zeile;
    const saetze = saetzeTeilen(zeile.trim());
    return saetze.length > 1 ? saetze.map((s) => `- ${s}`).join("\n") : zeile;
  }).join("\n");
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

// Einseitige .goodnotes-Datei: Papier und Index der Vorlage, Striche/Suchindex/Vorschaubild neu.
export function goodnotesDatei(striche, papier, vorschauJpeg = null) {
  const neu = { [`notes/${papier.seite}`]: notizStream(striche), [`search/${papier.seite}`]: SUCH_STUB };
  const eintraege = [];
  for (const [name, b64] of papier.eintraege) {
    eintraege.push([name, neu[name] ?? ausBase64(b64)]);
    if (name === "index.events.pb" && vorschauJpeg) eintraege.push(["thumbnail.jpg", vorschauJpeg]);
  }
  return zipStored(eintraege);
}
