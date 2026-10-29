import { Handschrift, goodnotesDatei, VOREINSTELLUNGEN, anweisungenLesen, anweisungenAnwenden } from "./handschrift.js";
import { trainingEinrichten, eigeneLaden, mitEigenen } from "./training.js";
import { REGELBLATT } from "./regelblatt.js";

const $ = (id) => document.getElementById(id);
const SPEICHER = { schluessel: "handschrift-schluessel", entwurf: "handschrift-entwurf" };
const TINTE = "#15181f";

const zustand = { daten: null, art: "kariert-klein", format: "A4", preset: "normal", optionen: { ...VOREINSTELLUNGEN.normal },
                  seed: neuerSeed(), seiten: [], seite: 0, papier: null };
const bilder = new Map();                                // Papierhintergründe, einmal geladen

function neuerSeed() { return Math.floor(Math.random() * 2 ** 31); }

function lies(schluessel, ersatz) {
  try { return JSON.parse(localStorage.getItem(schluessel)) ?? ersatz; } catch { return ersatz; }
}
function schreib(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch { /* privater Modus: egal */ }
}

// --- Entsperren -------------------------------------------------------------------------

async function datenLaden() {
  const antwort = await fetch("daten.bin", { cache: "no-cache" });
  if (!antwort.ok) throw new Error("daten.bin fehlt");
  const roh = new Uint8Array(await antwort.arrayBuffer());
  return { salz: roh.slice(4, 20), iv: roh.slice(20, 32), chiffre: roh.slice(32) };
}

async function schluesselAusPasswort(passwort, salz) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salz, iterations: 250000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}

async function entschluesseln(schluessel, paket) {
  const klar = await crypto.subtle.decrypt({ name: "AES-GCM", iv: paket.iv }, schluessel, paket.chiffre);
  return JSON.parse(new TextDecoder().decode(klar));
}

async function start() {
  const paket = await datenLaden();
  const gemerkt = lies(SPEICHER.schluessel, null);
  if (gemerkt) {
    try {
      const roh = Uint8Array.from(atob(gemerkt), (c) => c.charCodeAt(0));
      const schluessel = await crypto.subtle.importKey("raw", roh, "AES-GCM", false, ["decrypt"]);
      return oeffnen(await entschluesseln(schluessel, paket));
    } catch { localStorage.removeItem(SPEICHER.schluessel); }
  }
  $("sperre-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const knopf = e.submitter;
    knopf.disabled = true;
    $("sperre-fehler").textContent = "";
    try {
      const schluessel = await schluesselAusPasswort($("passwort").value, paket.salz);
      const daten = await entschluesseln(schluessel, paket);
      if ($("merken").checked) {
        const roh = new Uint8Array(await crypto.subtle.exportKey("raw", schluessel));
        schreib(SPEICHER.schluessel, btoa(String.fromCharCode(...roh)));
      }
      oeffnen(daten);
    } catch {
      $("sperre-fehler").textContent = "Das Passwort stimmt nicht.";
      $("passwort").select();
    } finally {
      knopf.disabled = false;
    }
  });
  $("passwort").focus();
}

// --- Oberfläche -------------------------------------------------------------------------

function oeffnen(daten) {
  zustand.basis = daten;
  zustand.daten = mitEigenen(daten, eigeneLaden());          // selbst trainierte Varianten dazu
  const entwurf = lies(SPEICHER.entwurf, {});
  zustand.art = entwurf.art ?? zustand.art;
  zustand.format = entwurf.format ?? zustand.format;
  zustand.optionen = { ...VOREINSTELLUNGEN.normal, ...(entwurf.optionen ?? {}) };
  zustand.preset = passendesPreset();
  for (const feld of document.querySelectorAll("[data-option]")) {       // Einzel-Einstellungen
    feld.addEventListener("input", () => {
      zustand.optionen[feld.dataset.option] = feld.type === "checkbox" ? feld.checked : Number(feld.value);
      zustand.preset = passendesPreset();
      einstellungenZeigen();
      neuSetzen();
    });
  }
  $("anpassen").addEventListener("click", () => {
    const offen = $("feinheiten").hidden;
    $("feinheiten").hidden = !offen;
    $("anpassen").setAttribute("aria-expanded", String(offen));
  });
  $("titel").value = entwurf.titel ?? "";
  $("text").value = entwurf.text ?? "";
  $("sperre").hidden = true;
  $("app").hidden = false;

  for (const gruppe of document.querySelectorAll(".umschalter")) {
    gruppe.addEventListener("click", (e) => {
      const knopf = e.target.closest("button");
      if (!knopf || knopf.hidden) return;
      const art = gruppe.dataset.gruppe, wert = knopf.dataset.wert;
      if (art === "preset") {
        if (!VOREINSTELLUNGEN[wert]) return;
        zustand.optionen = { ...VOREINSTELLUNGEN[wert] };
        zustand.preset = wert;
      } else if (art === "zeilenSprung") {
        zustand.optionen.zeilenSprung = Number(wert);
        zustand.preset = passendesPreset();
      } else {
        zustand[art] = wert;
      }
      einstellungenZeigen();
      neuSetzen();
    });
  }
  einstellungenZeigen();

  let warten;
  const beimTippen = () => { clearTimeout(warten); warten = setTimeout(neuSetzen, 350); };
  $("text").addEventListener("input", beimTippen);
  $("titel").addEventListener("input", entwurfSichern);
  $("wuerfeln").addEventListener("click", () => { zustand.seed = neuerSeed(); neuSetzen(); });
  $("zurueck").addEventListener("click", () => blaettern(-1));
  $("weiter").addEventListener("click", () => blaettern(1));
  $("teilen").addEventListener("click", teilen);
  $("laden").addEventListener("click", herunterladen);
  $("sperren").addEventListener("click", () => { localStorage.removeItem(SPEICHER.schluessel); location.reload(); });
  trainingEinrichten({
    daten: () => zustand.daten,
    zaehlerAus: () => Object.fromEntries(Object.entries(zustand.daten.glyphen).map(([c, l]) => [c, l.length])),
    geaendert: () => { zustand.daten = mitEigenen(zustand.basis, eigeneLaden()); neuSetzen(); },
    teilen: dateienTeilen,
  });
  $("regeln-text").textContent = REGELBLATT;
  $("regeln").addEventListener("click", () => $("regeln-dialog").showModal());
  $("regeln-schliessen").addEventListener("click", () => $("regeln-dialog").close());
  $("regeln-kopieren").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(REGELBLATT); $("regeln-status").textContent = "Kopiert – jetzt in der KI einfügen."; }
    catch { getSelection().selectAllChildren($("regeln-text")); $("regeln-status").textContent = "Markiert – bitte mit Kopieren übernehmen."; }
  });
  addEventListener("resize", () => zeichnen());
  neuSetzen();
}

function passendesPreset() {
  const o = zustand.optionen;
  return Object.keys(VOREINSTELLUNGEN).find((n) => Object.entries(VOREINSTELLUNGEN[n]).every(([k, v]) => o[k] === v)) ?? "eigene";
}

function einstellungenZeigen() {
  const werte = { art: zustand.art, format: zustand.format, preset: zustand.preset, zeilenSprung: String(zustand.optionen.zeilenSprung) };
  for (const gruppe of document.querySelectorAll(".umschalter")) {
    for (const knopf of gruppe.querySelectorAll("button")) {
      knopf.setAttribute("aria-checked", String(knopf.dataset.wert === werte[gruppe.dataset.gruppe]));
    }
  }
  $("preset-eigene").hidden = zustand.preset !== "eigene";
  for (const feld of document.querySelectorAll("[data-option]")) {
    const wert = zustand.optionen[feld.dataset.option];
    if (feld.type === "checkbox") feld.checked = wert; else feld.value = wert;
  }
  for (const a of document.querySelectorAll("[data-anzeige]")) a.textContent = `${Math.round(zustand.optionen[a.dataset.anzeige] * 100)} %`;
  const name = `${zustand.art}_${zustand.format}`;
  zustand.papier = zustand.daten.papiere.find((p) => p.name === name) ?? zustand.daten.papiere[0];
}

function entwurfSichern() {
  schreib(SPEICHER.entwurf, { text: $("text").value, titel: $("titel").value, art: zustand.art, format: zustand.format,
                              optionen: zustand.optionen });
}

function neuSetzen() {
  entwurfSichern();
  const text = $("text").value;
  const hat = text.trim().length > 0;
  for (const id of ["teilen", "laden", "wuerfeln"]) $(id).disabled = !hat;
  $("leer").hidden = hat;
  if (!hat) {
    zustand.seiten = [];
    status("");
    return zeichnen();
  }
  const { anweisungen } = anweisungenLesen(text);              // @papier, @platz … aus dem Text (z. B. von einer KI)
  const vonText = Object.keys(anweisungen).length > 0;
  if (vonText) {
    const neu = anweisungenAnwenden(anweisungen, { art: zustand.art, format: zustand.format, optionen: zustand.optionen, titel: $("titel").value });
    Object.assign(zustand, { art: neu.art, format: neu.format, optionen: neu.optionen });
    if (neu.titel && neu.titel !== $("titel").value) $("titel").value = neu.titel;
    zustand.preset = passendesPreset();
    einstellungenZeigen();
  }
  const hand = new Handschrift(zustand.daten, zustand.seed);
  zustand.seiten = hand.setzen(text, zustand.papier, zustand.optionen);
  zustand.seite = Math.max(0, Math.min(zustand.seite, zustand.seiten.length - 1));
  for (const id of ["teilen", "laden"]) $(id).disabled = !zustand.seiten.length;
  const fehlend = [...hand.fehlend];
  const n = zustand.seiten.length;
  status(fehlend.length ? `Nicht in deiner Schrift vorhanden, weggelassen: ${fehlend.join(" ")}`
    : n ? `${n} ${n === 1 ? "Seite" : "Seiten"} · ${zustand.papier.anzeige}${vonText ? " · Einstellungen aus dem Text" : ""}`
      : "Nichts Schreibbares im Text.", fehlend.length > 0 || !n);
  zeichnen();
}

function status(text, warnung = false) {
  $("status").textContent = text;
  $("status").classList.toggle("warnung", warnung);
}

function blaettern(schritt) {
  const n = zustand.seiten.length;
  if (n) { zustand.seite = (zustand.seite + schritt + n) % n; zeichnen(); }
}

function papierBild(papier) {
  if (!bilder.has(papier.name)) {
    const bild = new Image();
    bild.src = `data:image/png;base64,${papier.bild}`;
    bild.onload = () => zeichnen();
    bilder.set(papier.name, bild);
  }
  return bilder.get(papier.name);
}

function seiteMalen(ctx, papier, striche, skala) {
  const bild = papierBild(papier);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, papier.breite * skala, papier.hoehe * skala);
  if (bild.complete && bild.naturalWidth) ctx.drawImage(bild, 0, 0, papier.breite * skala, papier.hoehe * skala);
  ctx.strokeStyle = ctx.fillStyle = TINTE;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const s of striche) {
    ctx.lineWidth = Math.max(1, s.breite * skala);
    ctx.beginPath();
    s.punkte.forEach(([x, y], i) => (i ? ctx.lineTo(x * skala, y * skala) : ctx.moveTo(x * skala, y * skala)));
    if (s.punkte.length === 1) ctx.lineTo(s.punkte[0][0] * skala + 0.01, s.punkte[0][1] * skala);
    ctx.stroke();
  }
}

function zeichnen() {
  const papier = zustand.papier;
  if (!papier) return;
  const canvas = $("blatt");
  const breite = $("blatt-rahmen").clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const skala = (breite / papier.breite) * dpr;
  canvas.width = Math.round(papier.breite * skala);
  canvas.height = Math.round(papier.hoehe * skala);
  seiteMalen(canvas.getContext("2d"), papier, zustand.seiten[zustand.seite] ?? [], skala);
  const n = zustand.seiten.length;
  $("seiten").hidden = n < 2;
  $("seitenzahl").textContent = `Seite ${zustand.seite + 1} von ${n}`;
}

// --- Dateien ----------------------------------------------------------------------------

async function vorschauJpeg(papier, striche) {
  const c = document.createElement("canvas");
  c.width = Math.round(papier.breite * 0.5);
  c.height = Math.round(papier.hoehe * 0.5);
  seiteMalen(c.getContext("2d"), papier, striche, 0.5);
  const blob = await new Promise((fertig) => c.toBlob(fertig, "image/jpeg", 0.8));
  return new Uint8Array(await blob.arrayBuffer());
}

function dateiname() {
  const roh = $("titel").value.trim() || $("text").value.trim().split(/\s+/).slice(0, 5).join(" ") || "Handschrift";
  return roh.replace(/[\\/:*?"<>|]+/g, "").slice(0, 60).trim() || "Handschrift";
}

async function dateienErzeugen() {
  const name = dateiname(), n = zustand.seiten.length, dateien = [];
  for (let i = 0; i < n; i++) {
    const striche = zustand.seiten[i];
    const inhalt = goodnotesDatei(striche, zustand.papier, await vorschauJpeg(zustand.papier, striche));
    const datei = n === 1 ? `${name}.goodnotes` : `${name} – Seite ${i + 1}.goodnotes`;
    dateien.push(new File([inhalt], datei, { type: "application/octet-stream" }));
  }
  return dateien;
}

async function teilen() {
  if (zustand.seiten.length) dateienTeilen(await dateienErzeugen(), dateiname());
}

async function dateienTeilen(dateien, titel = "Handschrift") {
  if (navigator.canShare?.({ files: dateien })) {
    try {
      await navigator.share({ files: dateien, title: titel });
      status("Geteilt – in der Liste die Ziel-App (z. B. GoodNotes) wählen.");
    } catch (e) {
      if (e.name !== "AbortError") status(`Teilen ging nicht: ${e.message}`, true);
    }
    return;
  }
  speichern(dateien);
  status("Teilen wird hier nicht unterstützt – Datei wurde heruntergeladen.");
}

async function herunterladen() {
  speichern(await dateienErzeugen());
}

function speichern(dateien) {
  dateien.forEach((datei, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(datei);
    a.download = datei.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, i * 400));
}

start().catch((fehler) => { $("sperre-fehler").textContent = `Laden fehlgeschlagen: ${fehler.message}`; });
