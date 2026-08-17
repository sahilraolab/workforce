const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const { verhoeffChecksum } = require('../utils/verhoeff');

// Tesseract's language data is downloaded once and cached here instead of
// the project root (its default), so repeated cold starts don't re-fetch it.
const CACHE_DIR = path.join(__dirname, '..', '.ocr-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const OCR_MIMES = ['image/jpeg', 'image/png'];

// Below this, a "line" Tesseract reported is more likely to be a card's
// background watermark, emblem, or QR-code bleed-through than real printed
// text — genuinely printed text on a phone photo of an ID card routinely
// scores in the 80s-90s even when the photo isn't great.
const MIN_LINE_CONFIDENCE = 45;
// Field values that get typed straight into the worker's record (name,
// numbers) require a higher bar than merely "not obviously noise" — this is
// the threshold used to pick the *candidate* line for those fields.
const MIN_FIELD_CONFIDENCE = 60;

function isOcrSupported(mimeType) {
  return OCR_MIMES.includes(mimeType);
}

// Single shared worker, lazily started and reused across requests — spinning
// one up per scan costs ~1-2s just for engine init.
let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { cachePath: CACHE_DIR, logger: () => {} });
  }
  return workerPromise;
}

// Phone photos of ID cards are the norm here, not flatbed scans — uneven
// lighting, low contrast against the card's background pattern, and small
// print. Normalizing contrast, grayscaling, sharpening, and upscaling small
// images measurably cuts OCR noise on these compared to feeding the raw JPEG.
async function preprocess(input) {
  try {
    const pipeline = sharp(input).rotate(); // auto-orient from EXIF
    const meta = await pipeline.metadata();
    const targetWidth = meta.width && meta.width < 1600 ? 1600 : meta.width;
    return await pipeline
      .resize({ width: targetWidth, withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .toFormat('png')
      .toBuffer();
  } catch (err) {
    console.error('OCR preprocess failed, falling back to original image:', err.message);
    return input;
  }
}

// Runs OCR and returns the per-line text with Tesseract's own confidence
// score for each line (0-100). Confidence, not just regex shape, is what
// lets the parsers below tell a real printed field apart from a plausible-
// looking string of noise — the root cause of the "wrong info" autofill
// bugs this file used to have when it only looked at raw concatenated text.
// `input` can be a file path or a Buffer.
async function extractLines(input, mimeType) {
  if (mimeType && !isOcrSupported(mimeType)) return null;
  const image = await preprocess(input);
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return (data.lines || [])
    .map(l => ({ text: (l.text || '').trim(), confidence: l.confidence }))
    .filter(l => l.text.length > 0);
}

function joinedText(lines) {
  return lines.map(l => l.text).join('\n');
}

function onlyDigits(s) {
  return (s || '').replace(/[^0-9]/g, '');
}

// True if a line looks like real printed text rather than OCR noise picked
// up from a card's background watermark, emblem, or QR code — i.e. it's
// mostly letters/digits/spaces/basic punctuation.
function isCleanLine(line) {
  const trimmed = line.trim();
  if (trimmed.length < 2) return false;
  // Symbols that never belong in a postal address — a strong signal the
  // line is background-pattern/watermark bleed-through, not real text.
  if (/[{}[\]|\\~^*_<>@#]/.test(trimmed)) return false;
  const goodChars = (trimmed.match(/[A-Za-z0-9,.\-/\s]/g) || []).length;
  return goodChars / trimmed.length >= 0.9;
}

function isLikelyPersonName(line) {
  const words = line.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every(w => /^[A-Za-z][A-Za-z.]*$/.test(w) && w.length >= 2);
}

const BOILERPLATE = /government of india|\bgovt\b|unique identification|aadhaar|authority of india|income tax|permanent account|\bdepartment\b|d0b|date of birth|year of birth|father|\bmale\b|\bfemale\b|\baddress\b|www\.|gov\.in|download date|to\b|signature/i;

// Best-effort field extraction from Aadhaar OCR text. Aadhaar layouts vary
// (state, language panel, print era, front vs. back) so this is heuristic,
// not exhaustive — the caller must treat results as suggestions for a human
// to confirm, never as verified truth.
function parseAadhaarFields(lines) {
  const fields = {};
  const reliable = lines.filter(l => l.confidence >= MIN_LINE_CONFIDENCE);
  const cleaned = joinedText(reliable);
  const cleanedLines = reliable.map(l => l.text);

  // Aadhaar number — try every reliably-read 12-digit candidate and keep the
  // first one that passes the Verhoeff checksum every real Aadhaar number
  // carries. A checksum-invalid candidate is almost always a misread digit;
  // better to leave the field blank for the worker to type than to fill in
  // a wrong number silently.
  const aadhaarCandidates = reliable
    .filter(l => l.confidence >= MIN_FIELD_CONFIDENCE)
    .flatMap(l => [...l.text.matchAll(/\b(\d{4}\s?\d{4}\s?\d{4})\b/g)].map(m => onlyDigits(m[1])));
  fields.aadhaar = aadhaarCandidates.find(verhoeffChecksum) || null;
  if (!fields.aadhaar) delete fields.aadhaar;

  const dobMatch = cleaned.match(/(?:DOB|Date of Birth|D0B)[:\s]*([0-3]?\d[/\-][01]?\d[/\-]\d{4})/i)
    || cleaned.match(/\b([0-3]?\d[/\-][01]?\d[/\-]\d{4})\b/);
  let dobLineIdx = -1;
  if (dobMatch) {
    const [d, m, y] = dobMatch[1].split(/[/\-]/);
    fields.dob = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    dobLineIdx = cleanedLines.findIndex(l => l.includes(dobMatch[1]));
  } else {
    const yobMatch = cleaned.match(/Year of Birth[:\s]*(\d{4})/i);
    if (yobMatch) {
      fields.yob = yobMatch[1];
      dobLineIdx = cleanedLines.findIndex(l => l.includes(yobMatch[1]));
    }
  }

  if (/\bFemale\b/i.test(cleaned)) fields.gender = 'Female';
  else if (/\bMale\b/i.test(cleaned)) fields.gender = 'Male';

  // Name: on Aadhaar cards the printed English name is almost always the
  // line immediately preceding DOB/Year of Birth. Anchoring on that instead
  // of scanning the whole card avoids picking up noise from the photo,
  // emblem, or watermark that happens to look word-shaped. Only lines the
  // OCR itself was confident about are eligible.
  const reliableFieldLines = reliable.filter(l => l.confidence >= MIN_FIELD_CONFIDENCE);
  let nameCandidate = null;
  if (dobLineIdx > 0) {
    for (let i = dobLineIdx - 1; i >= Math.max(0, dobLineIdx - 4); i--) {
      const l = cleanedLines[i];
      const conf = reliable[i] ? reliable[i].confidence : 0;
      if (conf >= MIN_FIELD_CONFIDENCE && isLikelyPersonName(l) && !BOILERPLATE.test(l)) { nameCandidate = l; break; }
    }
  }
  if (!nameCandidate) {
    const hit = reliableFieldLines.find(l => isLikelyPersonName(l.text) && !BOILERPLATE.test(l.text));
    if (hit) nameCandidate = hit.text;
  }
  if (nameCandidate) fields.name = nameCandidate.replace(/\s+/g, ' ').trim();

  // Address: Aadhaar back-side layout prints it as a real paragraph after
  // the word "Address". Take clean lines following that keyword, stopping
  // at the first noisy line (background pattern bleed-through) or once a
  // 6-digit PIN code is reached (Indian addresses end with one).
  const addrKeywordIdx = cleanedLines.findIndex(l => /^address[:\s]*/i.test(l) || /address[:\s]/i.test(l));
  if (addrKeywordIdx !== -1) {
    const addrLines = [];
    const firstLine = cleanedLines[addrKeywordIdx].replace(/^.*?address[:\s]*/i, '').trim();
    if (firstLine) addrLines.push(firstLine);
    for (let i = addrKeywordIdx + 1; i < cleanedLines.length && i < addrKeywordIdx + 10; i++) {
      const l = cleanedLines[i];
      if (BOILERPLATE.test(l) || /\d{4}\s?\d{4}\s?\d{4}/.test(l)) break;
      if (!isCleanLine(l)) continue; // skip a noisy line but keep scanning
      addrLines.push(l);
      if (/\b\d{6}\b/.test(l)) break; // reached the PIN code — address is complete
    }
    const address = addrLines.join(', ').replace(/\s{2,}/g, ' ').replace(/\s*,\s*/g, ', ').trim();
    if (address.length >= 8) fields.address = address;
  }

  return fields;
}

// Best-effort field extraction from a bank passbook / cancelled cheque photo.
function parseBankPassbookFields(lines) {
  const fields = {};
  const reliable = lines.filter(l => l.confidence >= MIN_LINE_CONFIDENCE);
  const cleaned = joinedText(reliable);

  // IFSC's 5th character is always a literal zero, but OCR frequently reads
  // it as the letter O (near-identical glyphs in most fonts) — accept either
  // and normalize back to the digit, since that's what a real IFSC needs.
  // Only trust a reliably-read line for this.
  for (const l of reliable) {
    if (l.confidence < MIN_FIELD_CONFIDENCE) continue;
    const m = l.text.match(/\b([A-Z]{4})[0O]([A-Z0-9]{6})\b/);
    if (m) { fields.ifsc_code = `${m[1]}0${m[2]}`; break; }
  }

  for (const l of reliable) {
    if (l.confidence < MIN_FIELD_CONFIDENCE) continue;
    const m = l.text.match(/(?:A\/?C\.?\s?No\.?|Account\s?No\.?|Account Number)[:\s]*([0-9]{9,18})/i)
      || l.text.match(/\b(\d{9,18})\b/);
    if (m) { fields.bank_account = onlyDigits(m[1]); break; }
  }

  const bankNameMatch = cleaned.match(/^(.*(?:Bank|Sahakari)[^\n]*)$/im);
  if (bankNameMatch) fields.bank_name = bankNameMatch[1].trim();

  return fields;
}

// PAN format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). The 4th
// letter encodes the holder type — 'P' means individual, which every
// worker's own PAN should be — so a candidate with 'P' there is preferred
// over one without when more than one plausible match turns up.
function parsePanFields(lines) {
  const fields = {};
  const reliable = lines.filter(l => l.confidence >= MIN_LINE_CONFIDENCE);
  const cleaned = joinedText(reliable);
  const cleanedLines = reliable.map(l => l.text);

  const candidates = reliable
    .filter(l => l.confidence >= MIN_FIELD_CONFIDENCE)
    .flatMap(l => [...l.text.matchAll(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/g)].map(m => m[1]));
  if (candidates.length > 0) {
    fields.pan_number = candidates.find(c => c[3] === 'P') || candidates[0];
  }

  const panLineIdx = cleanedLines.findIndex(l => fields.pan_number && l.includes(fields.pan_number));

  const dobMatch = cleaned.match(/(?:DOB|Date of Birth)[:\s]*([0-3]?\d[/\-][01]?\d[/\-]\d{4})/i)
    || cleaned.match(/\b([0-3]?\d[/\-][01]?\d[/\-]\d{4})\b/);
  if (dobMatch) {
    const [d, m, y] = dobMatch[1].split(/[/\-]/);
    fields.dob = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Name: PAN cards print "Income Tax Department" / "Permanent Account
  // Number Card" boilerplate, then Name, then Father's Name, then DOB —
  // the name is reliably the first name-shaped line before the PAN number
  // (or before DOB if the number wasn't confidently read).
  const anchorIdx = panLineIdx !== -1 ? panLineIdx
    : cleanedLines.findIndex(l => /date of birth|dob/i.test(l));
  let nameCandidate = null;
  if (anchorIdx > 0) {
    for (let i = 0; i < anchorIdx; i++) {
      const l = cleanedLines[i];
      const conf = reliable[i] ? reliable[i].confidence : 0;
      if (conf >= MIN_FIELD_CONFIDENCE && isLikelyPersonName(l) && !BOILERPLATE.test(l)) { nameCandidate = l; break; }
    }
  }
  if (nameCandidate) fields.name = nameCandidate.replace(/\s+/g, ' ').trim();

  return fields;
}

module.exports = { isOcrSupported, extractLines, parseAadhaarFields, parseBankPassbookFields, parsePanFields };
