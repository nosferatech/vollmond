# GitHub heading slugs, captured

This note records what GitHub's Markdown renderer does to headings, captured on 2026-10-09 for issue #8 (I0.7). It compares the
result with the slug algorithm that `docs/draft/vollmond-proposal.md` §6.3 states, and proposes wording for a correction. It does
not change the proposal. The decision belongs to the project owner.

The data is in `docs/research/github-heading-slugs.json`. The conformance suite's fixture format (issue #4) is not settled, so the
data is kept in a neutral form and fixtures are to be generated from it later.

## Summary

GitHub's behavior matches §6.3 for ordinary headings in ASCII, and for most non-Latin letters. It differs from §6.3, or §6.3 is
silent, in eight places. The first two are the ones most likely to matter in practice.

1. GitHub slugs the rendered text of a heading, not its Markdown source. Link URLs, image alt text and HTML tags do not enter the
   slug. §5.3 defines `$title` as inline Markdown source, so a literal reading of §6.3 on `$title` gives different anchors for any
   heading with a link, image, entity or HTML tag.
2. A space written before the trailing `<a id="..."></a>` stays in the text, so the slug ends in a hyphen. The heading
   `## What was done <a id="done" class="decision review"></a>` has the derived anchor `what-was-done-`, not `what-was-done`.
3. "Letter" and "digit" are wider than they sound. GitHub keeps combining marks, letter-like numerals and two joiner characters,
   and removes other numeric symbols.
4. Only U+0020 becomes a hyphen. Tabs, line breaks, no-break spaces and the other Unicode spaces are removed.
5. Lower-casing is done one code point at a time, with no context rules and with recent Unicode data.
6. No Unicode normalization is applied, so the NFC and NFD forms of one word give two different anchors.
7. The repeat rule skips ids that are already taken, which a plain "-1, -2" reading does not say. Headings in block quotes, list
   items and HTML blocks, and raw HTML headings, take part in the numbering.
8. A heading whose slug is empty gets an irregular result.

## What was captured and how

I wrote 47 test documents with 678 cases (a case is one heading, or one small group of lines) and 671 headings. They are in
`docs/research/github-heading-slugs/`, one `.md` file per document. The files cover plain ASCII words, every common punctuation
character both inside a word and between spaces, hyphens and underscores, numbers and section numbers, inline code, emphasis, strong,
links, images, entities and HTML inside headings, `<a>` elements at the start, middle and end of a heading, leading and trailing
spaces and tabs, a CRLF document, Unicode letters from a dozen scripts, NFC and NFD forms of the same text, combining marks,
unusual spaces and format characters, emoji, repeated headings in many arrangements, setext headings, all six levels, empty
headings, headings in containers, raw HTML headings, and headings up to 5000 characters.

Each document was rendered once with

    gh api -X POST /markdown -f mode=markdown -f context=nosferatech/vollmond -F text=@<file>

and the response was saved byte for byte in `docs/research/github-heading-slugs/rendered/`. Roughly 90 requests were made in all, counting the checks below.

I tried `mode=gfm` first. That mode returns headings with no `id` and no permalink anchor at all (a sample is kept in
`rendered/20-repeat-two.mode-gfm.html`). The default `mode=markdown` emits both, so it was used for the capture. The other
variants agree with it.

- `POST /markdown/raw` returned byte-identical output for six documents (01, 07, 08, 12, 13, 43).
- Leaving out `context` returned byte-identical output for five documents (07, 08, 12, 13, 43).
- Rendering documents 08, 32 and 42 a second time returned byte-identical output.

What GitHub returns for a heading is a wrapper, for example

    <div class="markdown-heading"><h2 class="heading-element">Title</h2><a id="user-content-title" class="anchor"
    aria-label="Permalink: Title" href="#title">...</a></div>

The permalink anchor carries the slug. Its `id` has the prefix `user-content-` and its `href` does not. Every `id` and `name`
that appears in the input (for example on an explicit `<a id="x"></a>`) is prefixed the same way.

`docs/research/github-heading-slugs.json` is an array of `{ case, document, markdown, headings }`. Each heading has `level`,
`text` (the text content of the heading element, with whitespace kept exactly), `id` (raw, prefixed), `anchor` (without the
prefix) and `href`. `explicitIds` lists ids found inside the heading element, and `html` is the heading
element's inner HTML. Where GitHub added no permalink anchor, `id`, `anchor` and `href` are null (20 headings). The date of
capture, the API, the field meanings and SHA-256 hashes of every input and output are in
`docs/research/github-heading-slugs.capture.json`.

I compared the data with the algorithm by script. The model was the §6.3 steps applied to the rendered text, with repeats handled in
two ways (a plain count, and GitHub's skip-taken rule). The script is not part of the repository. It used Python 3.9, whose
Unicode data is version 13, which explains four of the six unmatched headings below.

Limits of this capture are as follows.

- It describes the Markdown API on one day. It was not compared with the page GitHub shows for a `.md` file in a repository,
  and not with the browser's handling of the fragment. That comparison is unverified.
- Case names such as `08-html/anchor-end` identify a case. Each case is rendered inside its document, so repeat suffixes depend
  on the other cases in the same document.

## Where GitHub agrees with §6.3

- ASCII letters are lower-cased, and ASCII digits are kept (`01-ascii-words/title-case`, `06-numbers/section-number`).
- Section numbers lose their dots, so `11.4 The tail` becomes `114-the-tail`, and `1.2.3 Deep` becomes `123-deep`.
- Every one of the 30 punctuation characters `.,:;!?'"()[]{}<>/\|@#$%^&*+=~` and the backtick is removed, whether it sits inside a
  word or between spaces (`02-punctuation-each-char`). A removed character between two spaces leaves two hyphens, for
  example `Q00 . x` becomes `q00--x`.
- Hyphens and underscores are kept as written, including repeated, leading and trailing ones (`05-hyphens-underscores`). `a--b`
  stays `a--b`, `-a` stays `-a`, `b-` stays `b-`.
- Each U+0020 becomes exactly one hyphen, so runs of spaces give runs of hyphens (`01-ascii-words/inner-multiple-spaces` gives
  `multiple---inner---spaces`).
- Letters of other scripts are kept and lower-cased where they have case. This holds for accented Latin, Greek, Cyrillic, Han,
  kana, Hangul, Arabic, Hebrew, Thai, Devanagari, Armenian, Georgian and Tamil (`09` to `12`).
- ATX headings are trimmed before slugging, so leading spaces, trailing spaces, tabs next to the `#` marks and a closing `##`
  sequence leave no trace (`43-whitespace`). Setext headings and CRLF files give the same slugs as ATX ones.
- Repeats get `-1`, `-2` and so on in document order, case-insensitively, and across heading levels
  (`20-repeat-two`, `21-repeat-five`, `27-repeat-case-insensitive`, `28-repeat-different-levels`, `34-repeat-thirteen`).
- Very long headings are not truncated. A 5000-character heading and a 1000-character single word give slugs of the same length,
  and two 1000-character words that differ only in the last character stay distinct (`45-long-headings`).

## Where GitHub differs, or §6.3 is silent

Each item is an observation with the case that shows it. Case names are `document/case`.

### 1. The slug comes from rendered text, not from Markdown source

§6.3 says "Lower-case the title". §5.3 defines `$title` as "the heading's inline Markdown source". GitHub does not slug the
source. It slugs the text content of the rendered heading.

- Link text is used and the destination is not. `A [link text](http://example.com/path) here` gives `a-link-text-here`
  (`07-inline-markup/link`). The same holds for titled, relative, reference and nested-emphasis links.
- Image alt text contributes nothing. `F ![alt text](img.png) here` gives `f--here`, and a heading that is only an image gives an
  empty slug (`07-inline-markup/image`, `image-only`, `image-link`).
- Code spans contribute their content without the backticks (`07-inline-markup/code-in-text` gives `use-foo-here`).
- Emphasis, strong and strikethrough delimiters vanish. `_r_` gives `r`, where the source would give `_r_`, because the
  underscore is kept by the character rule (`05-hyphens-underscores/wrapped-underscore`, `wrapped-double-underscore`). `An *emphasised* word`
  and `An _emphasised_ word` give the same slug, so the second counts as a repeat (`07-inline-markup/emphasis-underscore`).
- Intraword underscores stay (`snake_case_word`), and a backslash escape is resolved first (`a\_b` gives `a_b`, kept).
- Character references are decoded before slugging. `fish &amp; chips` gives `fish--chips`, and `a&nbsp;b` gives `ab`
  (`03-punctuation-compound/entity-amp`, `entity-nbsp`). On the source, `amp` and `nbsp` would stay as letters.
- HTML elements disappear and the text inside them stays (`08-html/span`, `bold-html`, `sup-sub`, `kbd`). An `<img>` contributes
  nothing. A comment contributes nothing and leaves its surrounding spaces (`08-html/comment` gives `visible--comment`).
  An unknown tag such as `<notatag>` is removed (`non-tag-angle` gives `-words`), and an unclosed `<b tag` is shown as text.
- An emoji shortcode is slugged as written, before GitHub turns it into an emoji. `M :rocket: shortcode` gives
  `m-rocket-shortcode` (`07-inline-markup/emoji-shortcode`). A heading that is only `:+1:` gives `1`.
- Mentions and issue references are slugged as their plain text (`P @octocat mention` gives `p-octocat-mention`).

Applying the §6.3 steps to the §5.3 `$title` source for the 638 top-level Markdown headings that I could compare gives a
different anchor for 62 of them, counting follow-on repeat suffixes. Most are link, image, entity and HTML cases, and the rest are
the explicit-anchor case in item 2.

### 2. The `<a>` element and the space before it

§5.3 says `$title` is "without the `<a>` element that carries the anchor and tags", and §6.2 puts the element at the end
of the heading. GitHub keeps the text on both sides of the element, and the element adds no text of its own.

- `Title one <a id="x"></a>` gives `title-one-` (`08-html/anchor-end`). `Title two <a id="y" class="a b"></a>` gives
  `title-two-`.
- `Title three<a id="y3"></a>`, with no space before the element, gives `title-three` (`08-html/anchor-end-no-space`).
- The example from §6.2, `What was done <a id="done" class="decision review"></a>`, gives `what-was-done-`
  (`52-proposal-examples/explicit-anchor-example`). The same happens in setext headings and in CRLF files
  (`40-setext/setext-html-anchor`, `46-crlf/crlf-anchor`).
- An element at the start gives a leading hyphen (`<a id="s"></a> Title five` gives `-title-five`). An element in the middle with
  a space on both sides gives a double hyphen (`Title <a id="m2"></a> seven` gives `title--seven`).
- An `<a>` with text, such as `<a id="t10">inner text</a>`, contributes that text (`title-ten-inner-text`). This is outside the
  grammar of §6.2.
- The trailing-hyphen slug is its own slug for repeats. `Corge <a id="corge"></a>`, `Corge`, `Corge <a id="corge-1"></a>`, `Corge`
  give `corge-`, `corge`, `corge--1`, `corge-1` (`30-repeat-with-explicit-anchor`).
- Explicit ids play no part in the numbering. Explicit and derived ids may be equal, which leaves two elements with the same
  `id` in the page (`08-html/anchor-id-equals-later-slug` and `later-heading`; `31-repeat-explicit-anchor-after`). In a browser the
  first one in document order is the one a fragment reaches. That browser behavior is the usual rule and was not tested here.
- Case is kept in explicit ids (`MixedCase`). An explicit id that already starts with `user-content-` is not prefixed twice
  (`08-html/anchor-id-with-user-content`), so `<a id="pre">` and `<a id="user-content-pre">` give the same element id.

This matters because §6.2 tells authors to put the element at the end of the heading, after a space. If vmd computes the derived
anchor from `$title`, it gets `what-was-done`, and a link written against GitHub's anchor, `what-was-done-`, does not resolve.

### 3. What counts as a letter or a digit

§6.3 says "a letter, a digit, a space, `-` or `_`" and does not define letter. The data fits this rule, which I derived from the
cases and checked against all 651 headings that have a permalink anchor (645 match, and the six that do not are explained in the
next paragraph). Keep a code point if it is U+0020, `-`, or any of these.

- Letters, which means general categories L and Nl (`Ⅳ roman` gives `ⅳ-roman`).
- Marks of all kinds (M). This keeps Arabic harakat, Hebrew niqqud, Thai vowel signs, Devanagari and Tamil signs, the combining dot
  above, enclosing marks (`x⃝`) and the emoji variation selector U+FE0F.
- Decimal digits Nd of any script, including Arabic-Indic and fullwidth digits.
- Connector punctuation Pc (`_` is the only one tested).
- The two joiners U+200C and U+200D.

Everything else is removed. That covers Latin-1 and other symbols (`©`, `®`, `°`, `€`, `§`), math, arrows, box drawing, curly and
guillemet quotes, the ellipsis character, the en dash, em dash, U+2010, U+2011 and the minus sign U+2212 (none of them becomes a
hyphen), CJK punctuation, fullwidth punctuation, other numeric symbols (`x²`, `①`, `½`, `❶`, all general category No), `™`, and format
characters other than the two joiners (zero-width space, left-to-right mark, byte order mark, soft hyphen, tag characters). Control
characters are removed (`14-combining-spaces-controls`).

The consequences of a strict reading (letters L and digits Nd only) are visible. Applied to the data, it removes the combining
marks from Arabic with diacritics, Hebrew with points, Thai, Devanagari and Tamil, and from every NFD word (`مَرْحَبا` would lose its
vowel signs and `हिन्दी` would become `हनद`). It also drops Roman numerals.

Emoji themselves are symbols and are removed, but the characters that build emoji sequences stay. `👨‍👩‍👧 family` gives an anchor
with two U+200D characters before `-family`. `❤️ heart vs16` gives an anchor that starts with U+FE0F. `1️⃣ keycap` gives
`1` followed by U+FE0F and U+20E3 (`13-symbols-emoji`). These anchors contain invisible characters.

The six headings the rule does not explain are the two emoji shortcodes from item 1 and four lower-casings of capital letters
that are newer than Unicode 13 (`15-lowercase-unicode-versions`).

### 4. Which characters are spaces

Only U+0020 becomes a hyphen. A tab is removed (`Tab<TAB>inside` gives `tabinside`, `43-whitespace/tab-inside`). A line break inside a
setext heading is removed with no hyphen (`40-setext/setext-multiline` gives `setext-five-line-onesetext-five-line-two`). The no-break
space, en space, em space, thin space, narrow no-break space and ideographic space are all removed
(`14-combining-spaces-controls/nbsp-between` gives `cd-nbsp`). §6.3's "a space" and "replace each space" read correctly only if "space"
means U+0020, and that should be said.

### 5. Case mapping

- Lower-casing is applied per code point with the full mapping. `İstanbul` gives `i̇stanbul`, which is `i` followed by U+0307, and
  U+0307 is then kept as a mark (`09-latin-nfc/dotted-I`). The Kelvin sign gives `k`, `ẞ` gives `ß`, and `ǅ` gives `ǆ`.
- There are no context rules. The Greek capital word `ΟΔΥΣΣΕΥΣ` gives `οδυσσευσ`, ending in a plain sigma, and `ΑΣ` gives `ασ`
  (`12-scripts/greek-upper-final-sigma`, `15-lowercase-unicode-versions/greek-sigma-end-of-word`). A lower-casing that applies the
  final-sigma rule would give `ς`. JavaScript's `toLowerCase` does, per the ECMAScript specification. I read that and did not run it.
- The case data is recent. The Garay capital letter U+10D50, the Cyrillic capital U+1C89 and U+A7CB (all Unicode 16) were lower-cased
  (`15-lowercase-unicode-versions`). A tool with older tables would leave them alone, and its anchors would differ.
- There is no locale handling. A capital `I` always gives `i`.
- `ß`, `ſ` and `ﬁ` are not changed. Fullwidth letters are lower-cased but not folded to ASCII (`ＡＢＣ` gives `ａｂｃ`).

§6.3 says only "lower-case". It should name the mapping and the Unicode version, or say that the suite's fixtures define it.

### 6. No Unicode normalization

The NFC and NFD forms of one text give two different anchors that look the same. `Café au lait` in NFC gives `caf` plus U+00E9, and in
NFD gives `cafe` plus U+0301 (`11-latin-nfc-nfd-mixed/accent-cafe-nfc` and `accent-cafe-nfd`, checked byte by byte). They do not
count as repeats of each other (`35-repeat-nfc-nfd` gives `café`, `café`, `café-1`, with the first two different in bytes and the
third a repeat of the first). There is no compatibility folding either (`ﬁ`, `µ` and fullwidth letters are kept as they are).
A link typed in one form does not reach a heading written in the other, and a record could hold two headings whose anchors look
identical. §6.3 and §5.7 do not say how vmd compares anchors.

### 7. Repeats

- GitHub's rule is "try the slug, and while it is taken, try the slug with `-1`, `-2` and so on". It is not "the n-th repeat gets
  `-n`". The difference shows when a heading's own slug already ends in `-n`.
  - `Foo`, `Foo`, `Foo-1` gives `foo`, `foo-1`, `foo-1-1` (`22-repeat-then-literal-1`). The plain count would give `foo-1` twice.
  - `Foo-1`, `Foo`, `Foo`, `Foo` gives `foo-1`, `foo`, `foo-2`, `foo-3`. The suffix `-1` is skipped because it is taken
    (`23-repeat-literal-1-first`). `Foo`, `Foo-1`, `Foo`, `Foo` gives the same ids (`24-repeat-literal-1-between`).
  - `Bar-1`, `Bar-1`, `Bar-1`, `Bar` gives `bar-1`, `bar-1-1`, `bar-1-2`, `bar` (`25-repeat-of-literal-1`).
  - `Baz`, `Baz`, `Baz-2`, `Baz`, `Baz` gives `baz`, `baz-1`, `baz-2`, `baz-3`, `baz-4` (`26-repeat-literal-2`).
  - A plain count matched GitHub for 637 headings and the skip-taken rule for 645. All eight differences are in documents 22 to 26 and 33.
- The numbering counts headings that vmd does not treat as sections. A heading inside a block quote, a list item or a `<details>`
  block counts, and so does a raw `<h2>Fred</h2>`. `> ## Quill`, `## Quill`, `- ## Quill`, a heading inside `<details>`, `## Quill` give
  `quill` to `quill-4` in order (`53-repeat-container-first`). `## Fred`, `<h2>Fred</h2>`, `## Fred` give `fred`, `fred-1`, `fred-2`
  (`36-repeat-html-heading`). §5.3 makes headings in containers and HTML blocks part of `$body`, so vmd would number the last
  `Quill` as `quill` or `quill-1`, and GitHub numbers it `quill-1` or `quill-4`.
- Headings inside fenced code, indented code, HTML comments and table cells are not headings and do not count
  (`44-containers`).
- A setext heading and an ATX heading with the same text share the numbering (`37-repeat-setext`).
- Because of item 2, `Notes <a id="n"></a>` and `Notes` are not repeats of each other.

### 8. Empty slugs

A heading can have an empty slug, for example when it holds only punctuation, an emoji or an image. The permalink then has `id=""`
and `href="#"`, and later empty-slug headings get `-1`, `-2` (`04-punctuation-only`, `51-empty-slug-punct-only`, where the ids are
`""`, `user-content--1`, `user-content--2`). Two further effects are not regular.

- A heading with no content at all (`##` alone) gets no permalink anchor when it stands alone (`47-empty-slug-alone`).
- When a document holds empty headings and punctuation-only headings together, GitHub emits fewer permalinks than headings. The
  last headings of the empty-slug group lose theirs, though the numbering still counts the empty ones
  (`48-empty-slug-punct-then-empty`, `49-empty-slug-empty-first`, `50-empty-slug-punct-empty-punct`, `42-empty-headings`,
  `32-repeat-empty`). In `48`, the headings `.`, `,`, an empty one and `;` get `""`, `-1`, `-2` and nothing. In
  `04-punctuation-only` the last of 34 empty-slug headings has none, though no heading there is empty, while the same three
  punctuation headings in `51` all have one. I did not find the rule, so I do not trust a model of it.
- A heading made only of a no-break space has text but no permalink in `42-empty-headings/nbsp-char-only`. A heading made only of an
  `<a>` element with an id has none in `42-empty-headings/anchor-only-empty` but has one in `08-html/anchor-only`, so the result
  depends on the rest of the document. One made only of an `<a class>` element renders as an empty `<h2>`
  (`08-html/anchor-only-class`).

A link to `#` or to `#-1` is not a usable address. §6.3 is silent about this.

## What a correction would need

This is proposed wording. It changes nothing in the proposal. It assumes the project keeps the stated principle that vmd follows
GitHub, and so it moves vmd to GitHub's behavior rather than the reverse.

**§6.3, first paragraph, replacement.**

> Every Markdown heading that is a section (§5.3) also has a **derived anchor**: GitHub's heading slug. The slug is computed from the
> heading's rendered text, which is the text a reader sees, found as follows. Markdown and HTML markup is removed and the text inside
> it is kept (link text, emphasis, the content of code spans, the text of HTML elements). Images, HTML comments and unknown tags
> contribute no text. Backslash escapes and character references are resolved before the text is read. The trailing
> `<a id="..." class="..."></a>` element is not part of `$title`, but it stays in place when the slug is computed. It adds no text,
> and the spaces around it remain. The slug is then built from the text in three steps.
>
> 1. Lower-case each code point with the Unicode default full case mapping, using no locale and no context rule (so Greek final sigma
>    is not special), with the Unicode version pinned by the conformance suite.
> 2. Keep U+0020, `-`, `_`, and every code point that is Alphabetic or a combining mark (general category M), a decimal digit (Nd) or
>    connector punctuation (Pc), or one of U+200C and U+200D. Remove every other code point, including tabs, line breaks and every
>    space other than U+0020.
> 3. Replace each U+0020 with `-`.
>
> No Unicode normalization is applied, and anchors are compared code point by code point. Within a record, the slugs are made unique in
> document order. If the slug is already used, the anchor is the slug with `-n` added, where n is the smallest integer of 1 or more
> for which that string is not already used. The ids produced for earlier repeats count as used. A heading whose slug is empty has no
> derived anchor. vmd pins this algorithm as normative and tests it against GitHub's Markdown renderer, since GitHub does not
> formally specify it.

**§6.3, a new paragraph on the numbering.**

> GitHub counts every heading it renders when it numbers repeats, including headings inside block quotes, list items and HTML blocks,
> and HTML heading elements. vmd counts the same headings for this purpose, although it treats only top-level Markdown headings as
> sections (§5.3). Strict mode warns when a derived anchor is shared with a heading that is not a section.

**§5.3, `$title`.** Add after the current sentence, "The derived anchor (§6.3) is computed from the heading with the `<a>` element left
in place."

**§6.2.** Add, "A space between the heading text and the `<a>` element makes the derived anchor end in `-` on GitHub (§6.3)."

Two choices stay with the project owner.

- Whether to accept the trailing hyphen, or to ask authors to write the `<a>` element without a space before it. The latter gives
  `Title<a id="x"></a>`, which renders the same on GitHub, but it conflicts with the example in §6.2 and the current serializer
  output.
- Whether vmd should use GitHub's anchor for a heading with an empty slug. The proposal above says such a heading has none, because
  GitHub's result is irregular and the link target `#` is not usable.

## The `github-slugger` package

The README of `github-slugger` (read at https://github.com/Flet/github-slugger on 2026-10-09; the package was not installed or run)
says the following.

- Its aim is to "emulate the way GitHub handles generating markdown heading anchors as close as possible", and it "ensures slugs are
  unique in the same way GitHub does it".
- Repeated input gets `-1`, `-2`, and so on, as in `slug('foo')` returning `foo`, `foo-1`, `foo-2`.
- Its examples show non-Latin characters kept and lower-cased (`Привет non-latin 你好` gives `привет-non-latin-你好`) and an emoji
  removed, leaving a leading hyphen (`😄 emoji` gives `-emoji`).
- It is "not a markdown or HTML parser", and inline markup in the input is not handled. The caller passes plain heading text.

These statements are consistent with items 1, 3 and 7 above. The README does not say how it treats combining marks, the joiner
characters, Nl and No numerals, normalization, case-mapping context, non-U+0020 spaces, the skip-taken rule for a heading that
already ends in `-n`, or empty slugs. I have not checked any of these against the package, so each is unverified. From memory, and
unverified, its lower-casing is the JavaScript `toLowerCase`, which would differ from GitHub on Greek final sigma (item 5). If the
project adopts it (proposal Appendix C), these cases are the ones to run against it first, and the rendered text, not the Markdown
source, has to be passed in.

## Other observations

These are noted and not acted on.

- The Markdown API with `mode=gfm` is unsuitable for slug fixtures, because it emits no ids, and the plan for this task refers to GFM mode.
- Fixtures will need a decision on which fields to freeze. `text` for headings that begin with raw HTML contains a leading newline that
  GitHub inserts (`08-html/span`), and headings that end with an `<a>` element contain a trailing newline.
- A `<script>` element in a heading is shown as escaped text, and its text enters the slug (`08-html/script-text` gives
  `scriptalert1script-script-words`). An `<a>` with only a class is removed by the sanitizer.
- GitHub's heading wrapper `<div class="markdown-heading">` and the `user-content-` prefix are details of the rendering. A change in
  either would show up as a changed `id` or `href` in every fixture.
- The Unicode data GitHub uses changes over time (Unicode 16 data was in use on the capture date). This is the likeliest cause of a
  future fixture failure, and it argues for keeping the non-ASCII cases in the suite.
- Documents 47 to 53 were added after the first pass, to pin down the empty-slug and container behaviors. Documents 20 to 37 each
  hold one repeat scenario, so that no case affects another.
