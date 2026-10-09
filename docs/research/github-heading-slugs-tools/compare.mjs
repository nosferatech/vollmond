#!/usr/bin/env node
// Compares GitHub's captured heading anchors (../github-heading-slugs.json) with models of the slug algorithm and prints counts.
// Needs Node 18 or later and no packages. The Unicode version behind the regular expression properties and the lower-casing is
// that of the Node in use, and the script prints it, because the counts depend on it.
//
//   node compare.mjs            print the counts
//   node compare.mjs --list     also list every heading where a model differs from GitHub
//
// Models
//   proposed   rendered text, lower-case per code point, keep U+0020 - _ and Alphabetic, M, Nd, Pc and Join_Control, space to
//              hyphen, smallest unused n for repeats, and headings with an empty slug take part in the numbering.
//   plain      the same, but the n-th repeat of a slug gets -n whether or not that string is already used.
//   drop-empty the same as proposed, but headings with an empty slug are left out of the numbering.
//   strict     the same as proposed, but only L and Nd count as letters and digits.
//   source     the proposed steps applied to the Markdown source of the heading (trimmed, without a closing # sequence and
//              without the trailing <a> element), for top-level Markdown headings only, numbering only those headings.

import { readFileSync } from 'node:fs';

const list = process.argv.includes('--list');
const file = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? new URL('../github-heading-slugs.json', import.meta.url);
const cases = JSON.parse(readFileSync(file, 'utf8'));

const KEEP = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control} \-_]$/u;
const KEEP_STRICT = /^[\p{L}\p{Nd} \-_]$/u;

function slugOf(text, keep = KEEP) {
  let out = '';
  for (const ch of text) {
    for (const c of ch.toLowerCase()) {
      if (keep.test(c)) out += c === ' ' ? '-' : c;
    }
  }
  return out;
}

// GitHub turns :name: into an emoji before the text reaches the capture, but slugs the text as written.
// The two cases with a shortcode have no other markup, so the model reads their Markdown source.
const SHORTCODE = /:[a-z0-9_+-]+:/;
function renderedText(c, h) {
  return SHORTCODE.test(c.markdown) ? c.markdown.replace(/^#+\s+/, '') : h.text;
}

function numberer(mode) {
  const used = new Set();
  const seen = new Map();
  return (slug) => {
    if (mode === 'plain') {
      const n = seen.get(slug) ?? 0;
      seen.set(slug, n + 1);
      return n === 0 ? slug : `${slug}-${n}`;
    }
    let cand = slug;
    for (let n = 1; used.has(cand); n++) cand = `${slug}-${n}`;
    used.add(cand);
    return cand;
  };
}

// Returns the heading's inline Markdown source, trimmed, without a closing # sequence and without the <a> element, or null.
function sourceTitle(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/.exec(lines[0]);
  let title;
  if (atx) {
    let body = atx[1] ?? '';
    body = body.replace(/[ \t]+#+[ \t]*$/, '').replace(/^#+[ \t]*$/, '');
    title = body.replace(/^[ \t]+|[ \t]+$/g, '');
  } else if (lines.length >= 2 && /^ {0,3}(=+|-+)[ \t]*$/.test(lines[lines.length - 1]) && lines.slice(0, -1).every((l) => l.trim() !== '')) {
    title = lines.slice(0, -1).map((l) => l.trim()).join('\n');
  } else {
    return null; // not a single top-level heading
  }
  return title.replace(/<a\s+[^>]*><\/a>/g, '').replace(/^[ \t]+|[ \t]+$/g, '');
}

const stats = {};
const diffs = {};
const bump = (k) => (stats[k] = (stats[k] ?? 0) + 1);
const note = (model, c, h, got, want) => (diffs[model] ??= []).push({ case: c.case, text: h.text, github: want, model: got });

const byDoc = new Map();
for (const c of cases) {
  if (!byDoc.has(c.document)) byDoc.set(c.document, []);
  byDoc.get(c.document).push(c);
}

let shortcodeCases = 0;
for (const [doc, cs] of byDoc) {
  const num = { proposed: numberer('skip'), plain: numberer('plain'), dropEmpty: numberer('skip'), strict: numberer('skip'), source: numberer('skip') };
  for (const c of cs) {
    if (c.headings.length && SHORTCODE.test(c.markdown)) shortcodeCases++;
    for (const h of c.headings) {
      bump('headings');
      const text = renderedText(c, h);
      const s = slugOf(text);
      const proposed = num.proposed(s);
      const plain = num.plain(s);
      const dropEmpty = s === '' ? null : num.dropEmpty(s);
      const strict = num.strict(slugOf(text, KEEP_STRICT));
      let source = null;
      const visible = !/^(<|>|-|\d+\.)/.test(c.markdown);
      const title = visible ? sourceTitle(c.markdown) : null;
      if (title !== null) source = num.source(slugOf(title));
      if (h.anchor === null) { bump('withoutPermalink'); continue; }
      bump('withPermalink');
      const want = h.anchor;
      for (const [name, got] of [['proposed', proposed], ['plain', plain], ['dropEmpty', dropEmpty], ['strict', strict]]) {
        if (got === want) bump(`${name}Match`); else note(name, c, h, got, want);
      }
      if (source !== null) {
        bump('sourceCompared');
        if (source === want) bump('sourceMatch'); else note('source', c, h, source, want);
      }
    }
  }
}

// Empty-slug groups. Observed regularity to check: within a document, among the headings whose slug is empty, the last k have no
// permalink, where k is the number of headings with no content at all (empty inner HTML), and the others carry "", -1, -2 and so on.
const groupResults = [];
for (const [doc, cs] of byDoc) {
  const members = [];
  for (const c of cs) for (const h of c.headings) if (slugOf(renderedText(c, h)) === '') members.push({ c, h });
  if (members.length === 0) continue;
  const k = members.filter((m) => m.h.html === '').length;
  const keep = members.length - k;
  let ok = true;
  members.forEach((m, i) => {
    const want = i < keep ? (i === 0 ? '' : `-${i}`) : null;
    if (m.h.anchor !== want) ok = false;
  });
  groupResults.push({ doc, members: members.length, childless: k, ok });
}

console.log(`Node ${process.version}, Unicode ${process.versions.unicode}`);
console.log(`cases ${cases.length}, documents ${byDoc.size}, headings ${stats.headings}, with permalink ${stats.withPermalink}, without ${stats.withoutPermalink}`);
console.log(`shortcode cases read from source ${shortcodeCases}`);
for (const m of ['proposed', 'plain', 'dropEmpty', 'strict']) console.log(`${m.padEnd(10)} matches ${stats[`${m}Match`]} of ${stats.withPermalink}`);
console.log(`source     matches ${stats.sourceMatch} of ${stats.sourceCompared} (top-level Markdown headings with a permalink)`);
console.log(`empty-slug groups ${groupResults.length}, following the rule in ${groupResults.filter((g) => g.ok).length}`);
for (const g of groupResults) console.log(`  ${g.doc} members ${g.members} childless ${g.childless} ${g.ok ? 'rule holds' : 'RULE FAILS'}`);
if (list) {
  for (const [model, ds] of Object.entries(diffs)) {
    console.log(`\n${model} differs on ${ds.length}`);
    for (const d of ds) console.log(`  ${d.case} ${JSON.stringify(d.text).slice(0, 50)} github=${JSON.stringify(d.github)} model=${JSON.stringify(d.model)}`);
  }
}
