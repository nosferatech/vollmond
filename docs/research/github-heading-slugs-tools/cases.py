# Case definitions. Each document is a list of (name, markdown, n_headings).
import unicodedata

def C(name, md, n=1):
    return (name, md, n)

docs = {}
footers = {}

# 01 plain ASCII words
docs["01-ascii-words"] = [
    C("lowercase-word", "# hello"),
    C("title-case", "## Title Case Words"),
    C("upper-case", "## UPPER CASE WORDS"),
    C("mixed-case", "## mIxEd cAsE"),
    C("inner-multiple-spaces", "## multiple   inner   spaces"),
    C("single-letter-lower", "## a"),
    C("single-letter-upper", "## Z"),
    C("sentence", "## The quick brown fox jumps over the lazy dog"),
    C("what-is-confirmed", "## What is confirmed"),
    C("flusher-title", "# Flusher stalls under load"),
]

# 02 punctuation embedded, one character at a time
chars = list(".,:;!?'\"()[]{}<>/\\|@#$%^&*+=~") + ["`", "-", "_"]
d = []
for i, c in enumerate(chars):
    d.append(C("embedded-%02d" % i, "## P%02d%sx" % (i, c)))
for i, c in enumerate(chars):
    d.append(C("spaced-%02d" % i, "## Q%02d %s x" % (i, c)))
docs["02-punctuation-each-char"] = d

# 03 punctuation compounds
docs["03-punctuation-compound"] = [
    C("parens", "## (parenthesised) words"),
    C("brackets", "## [bracketed] words"),
    C("braces", "## {braced} words"),
    C("angle-not-tag", "## a <= b >= c"),
    C("angle-tag-like", "## see <angle> here"),
    C("double-quotes", '## "double quoted" words'),
    C("single-quotes", "## 'single quoted' words"),
    C("apostrophe", "## It's the user's choice"),
    C("dollar-math", "## inline $x+y$ math"),
    C("dollar-math-block", "## display $$x+y$$ math"),
    C("slash-path", "## a/b/c path"),
    C("backslash-path", "## C:\\dir\\file path"),
    C("email", "## write to user@example.com now"),
    C("percent", "## 50% off"),
    C("ampersand-qa", "## Q&A session"),
    C("ampersand-spaced", "## Salt & pepper"),
    C("ampersand-att", "## AT&T and R&D"),
    C("question-bang", "## what?!"),
    C("ellipsis-ascii", "## wait... what"),
    C("dotted", "## a.b.c dotted"),
    C("eg", "## e.g. this, i.e. that"),
    C("equation", "## x = y + z"),
    C("comparison", "## a == b and a != b"),
    C("arrows-ascii", "## a -> b => c <- d"),
    C("pipes", "## a|b|c"),
    C("tildes", "## ~tilde~ words"),
    C("carets", "## ^caret^ words"),
    C("call", "## foo(bar) call"),
    C("empty-call", "## baz() call"),
    C("index", "## array[0] access"),
    C("colon-title", "## Note: read this"),
    C("semicolon", "## one; two; three"),
    C("hash-inside", "## C# and F# languages"),
    C("at-sign", "## the @ sign"),
    C("plus", "## C++ and A+B"),
    C("backslash-escape-bang", "## escaped\\! mark"),
    C("backslash-escape-dot", "## esc\\.aped dot"),
    C("backslash-escape-star", "## \\*not emphasis\\*"),
    C("backslash-before-letter", "## back\\slash letter"),
    C("entity-amp", "## fish &amp; chips"),
    C("entity-lt-gt", "## &lt;tag&gt; entity"),
    C("entity-quot", "## &quot;quoted&quot; entity"),
    C("entity-numeric", "## hex &#x26; dec &#38; entity"),
    C("entity-copy", "## &copy; 2026 entity"),
    C("entity-nbsp", "## a&nbsp;b entity"),
    C("backtick-unmatched", "## stray ` backtick"),
    C("asterisk-unmatched", "## stray * asterisk"),
    C("underscore-unmatched", "## stray _ underscore"),
]

# 04 punctuation only headings
d = []
for i, c in enumerate(chars):
    d.append(C("alone-%02d" % i, "## %s" % c))
d += [C("triple-bang", "## !!!"), C("triple-q", "## ???"), C("triple-dot", "## ..."), C("mixed-punct", "## ?!.,;:")]
docs["04-punctuation-only"] = d

# 05 hyphens and underscores
docs["05-hyphens-underscores"] = [
    C("single-hyphen", "## a-b"),
    C("double-hyphen", "## a--b"),
    C("triple-hyphen", "## a---b"),
    C("leading-hyphen", "## -a"),
    C("leading-double-hyphen", "## --a"),
    C("trailing-hyphen", "## b-"),
    C("trailing-double-hyphen", "## c--"),
    C("hyphen-only", "## -"),
    C("double-hyphen-only", "## --"),
    C("hyphen-spaced", "## d - e"),
    C("double-hyphen-spaced", "## f -- g"),
    C("hyphen-leading-space", "## - h"),
    C("hyphen-trailing-space", "## i -"),
    C("underscore-only", "## _"),
    C("double-underscore-only", "## __"),
    C("single-underscore", "## j_k"),
    C("double-underscore", "## l__m"),
    C("triple-underscore", "## n___o"),
    C("leading-underscore", "## _p"),
    C("trailing-underscore", "## q_"),
    C("wrapped-underscore", "## _r_"),
    C("wrapped-double-underscore", "## __s__"),
    C("snake-case", "## snake_case_word"),
    C("kebab-case", "## kebab-case-word"),
    C("hyphen-underscore-mix", "## t-_-u"),
    C("underscore-spaced", "## v _ w"),
    C("en-dash", "## x \u2013 y"),
    C("em-dash", "## z \u2014 a2"),
    C("unicode-hyphen", "## b2\u2010c2"),
    C("non-breaking-hyphen", "## d2\u2011e2"),
    C("minus-sign", "## f2\u2212g2"),
    C("hyphen-between-digits", "## 1-2-3"),
    C("hyphen-and-punct", "## h2-!-i2"),
    C("dot-hyphen", "## j2.-k2"),
]

# 06 numbers
docs["06-numbers"] = [
    C("section-number", "## 11.4 The tail"),
    C("section-number-3", "### 1.2.3 Deep"),
    C("numbered-list-style", "## 1. Intro"),
    C("paren-number", "## 2) Item"),
    C("date", "## 2024-01-05 release"),
    C("decimal", "## 3.14 pi"),
    C("version", "## v1.0.0"),
    C("version-pre", "## v2.0.0-rc.1+build.5"),
    C("only-digits", "## 4"),
    C("zero", "## 0"),
    C("leading-zero", "## 007"),
    C("hash-number", "## #1 priority"),
    C("percent-number", "## 100%"),
    C("currency", "## $5.00 price"),
    C("thousands", "## 1,000 items"),
    C("number-word", "## 5 words here"),
    C("fraction-ascii", "## 1/2 cup"),
    C("range", "## 10-20 range"),
    C("time", "## 12:30 PM"),
    C("ordinal", "## 1st place"),
    C("negative", "## -5 degrees"),
    C("plus-number", "## +5 degrees"),
]

# 07 inline markup
docs["07-inline-markup"] = [
    C("code-only", "## `code`"),
    C("code-in-text", "## Use `foo` here"),
    C("code-with-punct", "## Call `a.b()` now"),
    C("code-with-space", "## The `two words` span"),
    C("code-with-hyphen", "## The `some-flag` option"),
    C("code-uppercase", "## The `CamelCase` type"),
    C("code-double-backtick", "## Show `` a ` b `` literal"),
    C("code-punct-only", "## Operator `->` arrow"),
    C("emphasis-star", "## An *emphasised* word"),
    C("emphasis-underscore", "## An _emphasised_ word"),
    C("strong-star", "## A **strong** word"),
    C("strong-underscore", "## A __strong__ word"),
    C("strong-emphasis", "## A ***both*** word"),
    C("strikethrough", "## A ~~struck~~ word"),
    C("emphasis-only", "## *only emphasis*"),
    C("strong-only", "## **only strong**"),
    C("intraword-star", "## intra*word*emphasis"),
    C("intraword-underscore", "## intra_word_not_emphasis"),
    C("arithmetic-stars", "## 2*3*4 product"),
    C("link", "## A [link text](http://example.com/path) here"),
    C("link-only", "## [only link](http://example.com/only)"),
    C("link-with-title", '## B [titled](http://example.com/t "the title") here'),
    C("link-relative", "## C [relative](other.md#frag) here"),
    C("link-reference", "## D [reference][ref1] here"),
    C("link-emphasis-inside", "## E [*em* inside](http://example.com/e) here"),
    C("image", "## F ![alt text](img.png) here"),
    C("image-only", "## ![only image](img2.png)"),
    C("image-link", "## G [![badge](b.png)](http://example.com/b) here"),
    C("autolink-angle", "## H <http://example.com/auto> here"),
    C("autolink-bare", "## I https://example.com/bare here"),
    C("autolink-www", "## J www.example.com here"),
    C("escaped-star", "## K \\*literal\\* stars"),
    C("escaped-underscore", "## L a\\_b literal"),
    C("emoji-shortcode", "## M :rocket: shortcode"),
    C("emoji-shortcode-only", "## :+1:"),
    C("issue-ref", "## N see #8 issue"),
    C("repo-issue-ref", "## O nosferatech/vollmond#8 ref"),
    C("mention", "## P @octocat mention"),
    C("sha", "## Q commit 5b0819b ref"),
    C("task-text", "## R [ ] checkbox text"),
    C("footnote-like", "## S note[^1] marker"),
    C("hard-break-backslash", "## T line\\\nU break"),
]
footers["07-inline-markup"] = "[ref1]: http://example.com/ref1\n"

# 08 html in headings
def H(name, text, n=1):
    return C(name, "## " + text, n)

docs["08-html"] = [
    H("anchor-end", 'Title one <a id="x"></a>'),
    H("anchor-end-class", 'Title two <a id="y" class="a b"></a>'),
    H("anchor-end-no-space", 'Title three<a id="y3"></a>'),
    H("anchor-end-trailing-space", 'Title four <a id="z"></a> '),
    H("anchor-start", '<a id="s"></a> Title five'),
    H("anchor-middle", 'Ti<a id="m"></a>tle six'),
    H("anchor-middle-spaced", 'Title <a id="m2"></a> seven'),
    H("anchor-only", '<a id="o"></a>'),
    H("anchor-only-class", '<a class="only"></a>'),
    H("anchor-name", 'Title eight <a name="nm"></a>'),
    H("anchor-empty-attrs", 'Title nine <a></a>'),
    H("anchor-with-text", 'Title ten <a id="t10">inner text</a>'),
    H("anchor-href", 'Title eleven <a href="#q">link text</a>'),
    H("anchor-id-with-uppercase", 'Title twelve <a id="MixedCase"></a>'),
    H("anchor-id-with-punct", 'Title thirteen <a id="a.b_c-d"></a>'),
    H("anchor-id-equals-own-slug", 'Same as anchor <a id="same-as-anchor"></a>'),
    H("anchor-id-equals-later-slug", 'First has anchor <a id="later-heading"></a>'),
    H("later-heading", "Later heading"),
    H("anchor-id-equals-earlier-slug", 'Third has anchor <a id="earlier-heading"></a>'),
    H("anchor-id-with-user-content", 'Title fourteen <a id="user-content-pre"></a>'),
    H("two-anchors", 'Title fifteen <a id="a15"></a><a id="b15"></a>'),
    H("span", "<span>Span</span> words"),
    H("bold-html", "<b>Bold</b> html words"),
    H("em-html", "<em>Emphasis</em> html words"),
    H("code-html", "<code>Code</code> html words"),
    H("img-html", '<img src="x.png" alt="alt text"> image words'),
    H("kbd", "Press <kbd>Ctrl</kbd>+<kbd>C</kbd>"),
    H("br", "Line<br>break words"),
    H("comment", "Visible <!-- hidden --> comment"),
    H("comment-only", "<!-- hidden only -->"),
    H("unclosed-tag", "Unclosed <b tag"),
    H("sup-sub", "H<sub>2</sub>O and x<sup>2</sup>"),
    H("div", "<div>Div</div> words"),
    H("details-tag", "<details>Details tag</details>"),
    H("script-text", "<script>alert(1)</script> script words"),
    H("non-tag-angle", "<notatag> words"),
    H("entity-tag", "&lt;b&gt;escaped&lt;/b&gt; words"),
]

# 09..11 Unicode letters, NFC and NFD
latin = [
    ("accent-cafe", "Caf\u00e9 au lait"),
    ("accent-creme", "Cr\u00e8me br\u00fbl\u00e9e"),
    ("accent-naive", "Na\u00efve r\u00e9sum\u00e9"),
    ("accent-angstrom", "\u00c5ngstr\u00f6m"),
    ("accent-upper", "\u00c0\u00c9\u00ce\u00d5\u00dc upper"),
    ("sharp-s", "Stra\u00dfe"),
    ("capital-sharp-s", "GRO\u1e9eE"),
    ("o-slash", "\u00d8re og \u00e6ble"),
    ("l-stroke", "\u0141\u00f3d\u017a"),
    ("n-tilde", "Se\u00f1or Ni\u00f1o"),
    ("c-cedilla", "Fran\u00e7ais"),
    ("dotted-I", "\u0130stanbul"),
    ("dotless-i", "\u0131 dotless"),
    ("titlecase-dz", "\u01c5 titlecase"),
    ("vietnamese", "Ti\u1ebfng Vi\u1ec7t"),
    ("long-s", "\u017fhort s"),
    ("plain-k-after-normalization", "\u212a kelvin"),  # U+212A has a canonical decomposition to K, so NFC and NFD both give K
    ("ligature-fi", "\ufb01 ligature"),
    ("ligature-ae", "\u00c6sop"),
    ("eszett-lower-final", "ma\u00dfe"),
]
docs["09-latin-nfc"] = [C(n, "## " + unicodedata.normalize("NFC", t)) for n, t in latin]
def _same(t):
    return unicodedata.normalize("NFC", t) == unicodedata.normalize("NFD", t)
# A case whose NFD form has the same bytes as its NFC form is not an NFD test; its name says so.
docs["10-latin-nfd"] = [C(n + ("-same-as-nfc" if _same(t) else ""), "## " + unicodedata.normalize("NFD", t)) for n, t in latin]
mixed = []
for n, t in latin[:10]:
    mixed.append(C(n + "-nfc", "## " + unicodedata.normalize("NFC", t)))
    mixed.append(C(n + ("-nfd-same-as-nfc" if _same(t) else "-nfd"), "## " + unicodedata.normalize("NFD", t)))
docs["11-latin-nfc-nfd-mixed"] = mixed

# 12 scripts
docs["12-scripts"] = [
    C("greek", "## \u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac \u03b3\u03c1\u03ac\u03bc\u03bc\u03b1\u03c4\u03b1"),
    C("greek-upper-final-sigma", "## \u039f\u0394\u03a5\u03a3\u03a3\u0395\u03a5\u03a3"),
    C("greek-lower-final-sigma", "## \u03bf\u03b4\u03c5\u03c3\u03c3\u03b5\u03c5\u03c2"),
    C("greek-tonos", "## \u03ac\u03ad\u03ae\u03af\u03cc\u03cd\u03ce tonos"),
    C("cyrillic", "## \u041f\u0440\u0438\u0432\u0435\u0442 \u043c\u0438\u0440"),
    C("cyrillic-yo", "## \u0401\u0416 \u0451\u0436"),
    C("han-simplified", "## \u4e2d\u6587\u6807\u9898"),
    C("han-with-spaces", "## \u65e5\u672c\u8a9e \u306e \u898b\u51fa\u3057"),
    C("hiragana", "## \u3072\u3089\u304c\u306a"),
    C("katakana", "## \u30ab\u30bf\u30ab\u30ca"),
    C("katakana-prolonged", "## \u30b3\u30fc\u30d2\u30fc"),
    C("hangul", "## \ud55c\uad6d\uc5b4 \uc81c\ubaa9"),
    C("arabic", "## \u0645\u0631\u062d\u0628\u0627 \u0628\u0627\u0644\u0639\u0627\u0644\u0645"),
    C("arabic-diacritics", "## \u0645\u064e\u0631\u0652\u062d\u064e\u0628\u0627"),
    C("arabic-indic-digits", "## \u0663\u0664\u0665 digits"),
    C("hebrew", "## \u05e9\u05dc\u05d5\u05dd \u05e2\u05d5\u05dc\u05dd"),
    C("hebrew-niqqud", "## \u05e9\u05b8\u05c1\u05dc\u05d5\u05b9\u05dd"),
    C("thai", "## \u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35"),
    C("devanagari", "## \u0939\u093f\u0928\u094d\u0926\u0940"),
    C("armenian", "## \u0540\u0561\u0575\u0565\u0580\u0565\u0576"),
    C("georgian", "## \u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8"),
    C("tamil", "## \u0ba4\u0bae\u0bbf\u0bb4\u0bcd"),
    C("mixed-script", "## Hello \u4e16\u754c \u043c\u0438\u0440"),
    C("fullwidth-latin", "## \uff21\uff22\uff23 \uff41\uff42\uff43"),
    C("fullwidth-digits", "## \uff11\uff12\uff13"),
    C("math-script-capital", "## \U0001d49c math script"),
    C("han-extension-b", "## \U00020000 ext b"),
    C("deseret", "## \U00010400\U00010428 deseret"),
    C("superscript-two", "## x\u00b2 squared"),
    C("circled-digit", "## \u2460 circled"),
    C("roman-numeral", "## \u2163 roman"),
    C("vulgar-fraction", "## \u00bd cup"),
    C("letterlike-trademark", "## Product\u2122 name"),
    C("ordinal-indicator", "## 1\u00ba place"),
    C("micro-sign", "## 5 \u00b5m size"),
    C("ohm-sign", "## 5 \u2126 resistor"),
]

# 13 symbols and emoji
docs["13-symbols-emoji"] = [
    C("emoji-leading", "## \U0001f680 Launch"),
    C("emoji-trailing", "## Land \U0001f680"),
    C("emoji-only", "## \U0001f44d"),
    C("emoji-middle", "## a \U0001f680 b"),
    C("emoji-adjacent-word", "## c\U0001f680d"),
    C("emoji-heart-vs16", "## \u2764\ufe0f heart vs16"),
    C("emoji-heart-text", "## \u2764 heart text"),
    C("emoji-zwj-family", "## \U0001f468\u200d\U0001f469\u200d\U0001f467 family"),
    C("emoji-flag", "## \U0001f1e9\U0001f1ea flag"),
    C("emoji-keycap", "## 1\ufe0f\u20e3 keycap"),
    C("emoji-skin-tone", "## \U0001f44b\U0001f3fd wave"),
    C("check-mark", "## \u2714 done"),
    C("warning-sign", "## \u26a0 warning"),
    C("black-star", "## \u2605 star"),
    C("copyright", "## \u00a9 copyright"),
    C("registered", "## \u00ae registered"),
    C("degree", "## 20\u00b0 degrees"),
    C("currency-euro", "## \u20ac euro"),
    C("currency-pound-yen", "## \u00a3 pound \u00a5 yen"),
    C("math-symbols", "## \u2211 sum \u221e infinity \u2260 neq"),
    C("arrows", "## left \u2190 right \u2192 arrows"),
    C("box-drawing", "## \u2500\u2502\u250c box"),
    C("ellipsis-char", "## wait\u2026 what"),
    C("curly-double", "## \u201ccurly\u201d quotes"),
    C("curly-single", "## \u2018curly\u2019 quotes"),
    C("guillemets", "## \u00abfrench\u00bb quotes"),
    C("inverted-punct", "## \u00bfQu\u00e9? \u00a1Hola!"),
    C("middle-dot", "## a\u00b7b dot"),
    C("bullet", "## \u2022 bullet"),
    C("cjk-punct", "## \u300c\u62ec\u5f27\u300d\u3002"),
    C("fullwidth-punct", "## \uff01\uff1f\uff0c fullwidth"),
    C("section-sign", "## \u00a7 section"),
    C("pilcrow", "## \u00b6 pilcrow"),
    C("dagger", "## \u2020 dagger"),
    C("per-mille", "## 5\u2030 permille"),
    C("music-note", "## \u266a note"),
    C("dingbat-digit", "## \u2776 dingbat"),
    C("private-use", "## \ue000 private use"),
    C("replacement-char", "## \ufffd replacement"),
]

# 14 combining marks, spaces, special characters
docs["14-combining-spaces-controls"] = [
    C("combining-acute-alone", "## e\u0301"),
    C("combining-stack", "## a\u0308\u0301 stacked"),
    C("combining-after-digit", "## 1\u0301 digit mark"),
    C("combining-after-space", "## b \u0301 spaced mark"),
    C("combining-enclosing", "## x\u20dd enclosed"),
    C("combining-zalgo", "## Z\u0353a\u035blgo"),
    C("combining-leading", "## \u0301lead mark"),
    C("combining-only", "## \u0301\u0302"),
    C("nbsp-between", "## c\u00a0d nbsp"),
    C("nbsp-leading", "## \u00a0e nbsp lead"),
    C("nbsp-trailing", "## f nbsp trail\u00a0"),
    C("en-space", "## g\u2002h en space"),
    C("em-space", "## i\u2003j em space"),
    C("thin-space", "## k\u2009l thin space"),
    C("ideographic-space", "## m\u3000n ideographic space"),
    C("narrow-nbsp", "## o\u202fp narrow nbsp"),
    C("zero-width-space", "## q\u200br zws"),
    C("zero-width-joiner", "## s\u200dt zwj"),
    C("zero-width-non-joiner", "## u\u200cv zwnj"),
    C("bom-inside", "## w\ufeffx bom"),
    C("soft-hyphen", "## y\u00adz soft hyphen"),
    C("bidi-mark", "## c1\u200ed1 lrm"),
    C("variation-selector", "## e1\ufe0ff1 vs16"),
    C("tag-character", "## g1\U000e0041h1 tag a"),
    C("control-bell", "## i1\u0007j1 bell"),
    C("vertical-tab", "## k1\u000bl1 vt"),
    C("form-feed", "## m1\u000cn1 ff"),
]

# 20.. repeats (one scenario per document)
docs["20-repeat-two"] = [C("notes-1st", "## Notes"), C("notes-2nd", "## Notes")]
docs["21-repeat-five"] = [C("plan-%d" % i, "## Plan") for i in range(1, 6)]
docs["22-repeat-then-literal-1"] = [C("foo", "## Foo"), C("foo-again", "## Foo"), C("foo-1-literal", "## Foo-1")]
docs["23-repeat-literal-1-first"] = [C("foo-1-literal", "## Foo-1"), C("foo", "## Foo"), C("foo-again", "## Foo"), C("foo-third", "## Foo")]
docs["24-repeat-literal-1-between"] = [C("foo", "## Foo"), C("foo-1-literal", "## Foo-1"), C("foo-again", "## Foo"), C("foo-third", "## Foo")]
docs["25-repeat-of-literal-1"] = [C("bar-1-literal", "## Bar-1"), C("bar-1-literal-again", "## Bar-1"), C("bar-1-literal-third", "## Bar-1"), C("bar", "## Bar")]
docs["26-repeat-literal-2"] = [C("baz", "## Baz"), C("baz-again", "## Baz"), C("baz-2-literal", "## Baz-2"), C("baz-third", "## Baz"), C("baz-fourth", "## Baz")]
docs["27-repeat-case-insensitive"] = [C("qux-lower", "## qux"), C("qux-title", "## Qux"), C("qux-upper", "## QUX")]
docs["28-repeat-different-levels"] = [C("level1", "# Same"), C("level2", "## Same"), C("level3", "### Same"), C("level6", "###### Same")]
docs["29-repeat-via-punctuation"] = [C("plain", "## Quux"), C("bang", "## Quux!"), C("question", "## Quux?"), C("spaced-punct", "## Quux ?"), C("code", "## `Quux`")]
docs["30-repeat-with-explicit-anchor"] = [C("anchored-first", '## Corge <a id="corge"></a>'), C("plain-same-slug", "## Corge"), C("anchored-again", '## Corge <a id="corge-1"></a>'), C("plain-third", "## Corge")]
docs["31-repeat-explicit-anchor-after"] = [C("plain-first", "## Grault"), C("anchored-same-anchor", '## Other <a id="grault"></a>'), C("plain-second", "## Grault"), C("plain-other", "## Other")]
docs["32-repeat-empty"] = [C("empty-1", "##"), C("empty-2", "##"), C("empty-3", "##"), C("punct-only", "## !!!"), C("hyphen-only-1", "## -"), C("hyphen-only-2", "## -")]
docs["33-repeat-numeric"] = [C("n1", "## 1"), C("n1-again", "## 1"), C("n1-literal-1", "## 1-1"), C("n1-third", "## 1")]
docs["34-repeat-thirteen"] = [C("w%02d" % i, "## Waldo") for i in range(1, 14)]
docs["35-repeat-nfc-nfd"] = [C("nfc", "## Caf\u00e9"), C("nfd", "## Cafe\u0301"), C("nfc-again", "## Caf\u00e9"), C("ascii", "## Cafe")]
docs["36-repeat-html-heading"] = [C("markdown-first", "## Fred"), C("html-heading", "<h2>Fred</h2>"), C("markdown-after", "## Fred")]
docs["37-repeat-setext"] = [C("setext-first", "Plugh\n====="), C("atx-same", "## Plugh"), C("setext-h2", "Plugh\n-----")]

# 40 setext
docs["40-setext"] = [
    C("setext-h1", "Setext one\n=========="),
    C("setext-h2", "Setext two\n----------"),
    C("setext-short-underline", "Setext three\n="),
    C("setext-long-underline", "Setext four\n----------------------------"),
    C("setext-multiline", "Setext five line one\nsetext five line two\n====="),
    C("setext-multiline-h2", "Setext six line one\nsetext six line two\n-----"),
    C("setext-trailing-spaces", "Setext seven   \n====="),
    C("setext-leading-spaces", "   Setext eight\n====="),
    C("setext-indented-underline", "Setext nine\n   ====="),
    C("setext-inline-markup", "Setext *ten* and `code`\n-----"),
    C("setext-hard-break-spaces", "Setext eleven a  \nsetext eleven b\n====="),
    C("setext-hard-break-backslash", "Setext twelve a\\\nsetext twelve b\n====="),
    C("setext-punct", "Setext thirteen, with: punct!\n====="),
    C("setext-html-anchor", 'Setext fourteen <a id="s14"></a>\n====='),
    C("setext-unicode", "Setext f\u00fcnfzehn\n====="),
    C("setext-trailing-hashes", "Setext sixteen ##\n====="),
    C("setext-escaped-hash", "\\# Setext seventeen\n====="),
    C("setext-tab", "Setext\teighteen\n====="),
]

# 41 levels
docs["41-levels"] = [
    C("level-1", "# Level one"),
    C("level-2", "## Level two"),
    C("level-3", "### Level three"),
    C("level-4", "#### Level four"),
    C("level-5", "##### Level five"),
    C("level-6", "###### Level six"),
    C("level-7-not-heading", "####### Level seven", 0),
    C("no-space-not-heading", "#NoSpace", 0),
    C("tab-after-hashes", "#\tTab after hash"),
]

# 42 empty headings
docs["42-empty-headings"] = [
    C("hash-only-1", "#"),
    C("hash-only-2", "##"),
    C("hash-space", "# "),
    C("hash-spaces", "#     "),
    C("hash-closing-only", "# #"),
    C("hash-closing-only-2", "## ##"),
    C("hash-closing-spaced", "###   ###   "),
    C("anchor-only-empty", '# <a id="e"></a>'),
    C("nbsp-entity-only", "# &nbsp;"),
    C("nbsp-char-only", "# \u00a0"),
    C("tab-only", "#\t"),
    C("empty-code", "# ` `"),
]

# 43 whitespace
docs["43-whitespace"] = [
    C("one-leading-space", " # Lead one"),
    C("two-leading-spaces", "  ## Lead two"),
    C("three-leading-spaces", "   ### Lead three"),
    C("four-leading-spaces-code", "    #### Lead four", 0),
    C("space-after-hash-many", "#      Many spaces after"),
    C("trailing-spaces", "# Trail one   "),
    C("trailing-tab", "# Trail two\t"),
    C("leading-and-trailing", "#    Both sides    "),
    C("tab-inside", "## Tab\tinside"),
    C("tabs-inside-many", "## Tabs\t\tinside"),
    C("tab-after-hashes", "##\tTab after hashes"),
    C("tab-spaces-mixed", "## Mixed \t spaces tab"),
    C("closing-hashes", "## Closing one ##"),
    C("closing-hashes-many", "## Closing two #######"),
    C("closing-hashes-trailing-space", "## Closing three ##   "),
    C("hash-not-closing", "## Hash four #notclosing"),
    C("hash-escaped-closing", "## Hash five \\#"),
    C("hash-no-space-closing", "## Hash six#"),
    C("trailing-space-markup", "## Trail `code`  "),
    C("trailing-space-emphasis", "## Trail *em*  "),
    C("space-before-punct", "## Space before , comma"),
    C("space-after-punct", "## Dot.  Two spaces after"),
    C("space-then-hyphen", "## Spaced - hyphen - words"),
    C("entity-newline", "## Entity&#10;newline"),
]

# 44 containers and non-ATX headings
docs["44-containers"] = [
    C("top-level", "## Top level"),
    C("blockquote", "> ## Quoted heading"),
    C("blockquote-nested", "> > ### Nested quoted heading"),
    C("list-item", "- ## List item heading"),
    C("ordered-list-item", "1. ## Ordered item heading"),
    C("details-block", "<details>\n<summary>Summary</summary>\n\n## Inside details\n\n</details>"),
    C("html-h2", "<h2>Raw html heading</h2>"),
    C("html-h3-with-id", '<h3 id="rawid">Raw html heading with id</h3>'),
    C("html-h1-attrs", '<h1 class="c" align="center">Raw html with attrs</h1>'),
    C("html-h2-nested-markup", "<h2><em>Raw</em> <code>nested</code> markup</h2>"),
    C("fenced-code", "```\n## Not a heading in fence\n```", 0),
    C("indented-code", "    ## Not a heading indented", 0),
    C("html-comment-block", "<!--\n## Not a heading in comment\n-->", 0),
    C("table-cell", "| col |\n|---|\n| ## in cell |", 0),
    C("paragraph-continuation", "Paragraph start\n## heading ends paragraph"),
    C("thematic-then-heading", "***\n\n## After thematic"),
]

# 45 long headings
_words = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua " * 100).split()
def long_words(n):
    return " ".join(_words)[:n].rstrip()
docs["45-long-headings"] = [
    C("len-100", "## A" + long_words(99)),
    C("len-255", "## B" + long_words(254)),
    C("len-256", "## C" + long_words(255)),
    C("len-257", "## D" + long_words(256)),
    C("len-1000", "## E" + long_words(999)),
    C("len-5000", "## F" + long_words(4999)),
    C("one-word-300", "## " + "g" * 300),
    C("one-word-1000", "## " + "h" * 1000),
    C("cjk-1000", "## " + "\u6f22" * 1000),
    C("emoji-300", "## i" + "\U0001f680" * 300),
    C("hyphens-300", "## i" + "-" * 300 + "j"),
    C("spaces-300", "## k" + " " * 300 + "l"),
    C("differ-at-end-a", "## " + "m" * 1000 + "1"),
    C("differ-at-end-b", "## " + "m" * 1000 + "2"),
    C("identical-long-1", "## " + "n" * 1000),
    C("identical-long-2", "## " + "n" * 1000),
]

# 46 CRLF document
docs["46-crlf"] = [
    C("crlf-plain", "## Crlf plain"),
    C("crlf-trailing-space", "## Crlf trailing space  "),
    C("crlf-setext", "Crlf setext\n----------"),
    C("crlf-anchor", '## Crlf anchor <a id="crlf"></a>'),
    C("crlf-closing", "## Crlf closing ##"),
]
crlf_docs = {"46-crlf"}

# 15 case mapping across Unicode versions
docs["15-lowercase-unicode-versions"] = [
    C("georgian-mtavruli", "## ᲐᲑ mtavruli"),
    C("cherokee-capital", "## ᎠᎡ cherokee"),
    C("latin-extended-d-unicode8", "## Ꞵ unicode8"),
    C("latin-unicode11", "## Ꞹ unicode11"),
    C("latin-unicode14", "## Ꟁ unicode14"),
    C("cyrillic-tje-unicode16", "## Ᲊ unicode16"),
    C("latin-unicode16", "## Ɤ unicode16b"),
    C("garay-capital-unicode16", "## \U00010d50 garay"),
    C("greek-final-sigma-context", "## ΣΑΣ sas"),
    C("greek-sigma-end-of-word", "## ΑΣ as"),
    C("turkish-dotless-capital", "## I and İ"),
    C("lithuanian-dot", "## Į́ lt"),
    C("special-casing-ligature", "## ﬃ ffi"),
    C("special-casing-n-apostrophe", "## ŉ napos"),
    C("special-casing-j-caron", "## ǰ jcaron"),
]

# 47.. empty slug behaviour
docs["47-empty-slug-alone"] = [C("e1", "##"), C("e2", "##"), C("e3", "##")]
docs["48-empty-slug-punct-then-empty"] = [C("p1", "## ."), C("p2", "## ,"), C("e", "##"), C("p3", "## ;")]
docs["49-empty-slug-empty-first"] = [C("e", "##"), C("p1", "## ."), C("p2", "## ;")]
docs["50-empty-slug-punct-empty-punct"] = [C("p1", "## ."), C("e", "##"), C("p2", "## ;"), C("a", "## a")]
docs["51-empty-slug-punct-only"] = [C("p1", "## ."), C("p2", "## ,"), C("p3", "## ;")]

# 52 examples taken from the proposal
docs["52-proposal-examples"] = [
    C("title-heading", "# Flusher stalls under load"),
    C("section-heading", "## What is confirmed"),
    C("explicit-anchor-example", '## What was done <a id="done" class="decision review"></a>'),
    C("section-number-example", "## 11.4 The tail"),
    C("retitle-example", "## Notes"),
    C("retitle-example-repeat", "## Notes"),
]

# 53 repeats where earlier same-slug headings sit in containers or HTML blocks
docs["53-repeat-container-first"] = [
    C("in-blockquote", "> ## Quill"),
    C("top-level-after-quote", "## Quill"),
    C("in-list", "- ## Quill"),
    C("in-details", "<details>\n\n## Quill\n\n</details>"),
    C("top-level-last", "## Quill"),
]

# 54 other alphabetic symbols and decimal digits of several scripts
docs["54-alphabetic-and-digits"] = [
    C("other-alphabetic-pair", "## \u24b6x \u249cy"),
    C("circled-capital-a", "## \u24b6 circled capital"),
    C("circled-small-a", "## \u24d0 circled small"),
    C("parenthesized-a", "## \u249c parenthesized"),
    C("roman-small-numeral", "## \u2170 small roman"),
    C("devanagari-digits", "## \u0967\u0968\u0969 digits"),
    C("thai-digits", "## \u0e51\u0e52\u0e53 digits"),
    C("bengali-digits", "## \u09e7\u09e8\u09e9 digits"),
    C("extended-arabic-indic-digits", "## \u06f1\u06f2\u06f3 digits"),
    C("mathematical-bold-digits", "## \U0001d7ce\U0001d7cf digits"),
    C("superscript-letter", "## x\u1d43 modifier letter"),
    C("squared-latin-capital", "## \U0001f130 squared"),
]

# 55 case-mapping singletons (kept as written, without normalization)
docs["55-case-mapping-singletons"] = [
    C("kelvin-sign", "## \u212a kelvin"),
    C("angstrom-sign", "## \u212b angstrom"),
    C("ohm-sign", "## \u2126 ohm"),
    C("unicode17-beria-erfe", "## \U00016ea0 unicode17"),
]

# 56 empty slug consumed by a later literal slug
docs["56-empty-slug-then-literal-suffix"] = [C("p1", "## ."), C("p2", "## ."), C("literal-minus-1", "## -1"), C("tail", "## tail")]

# 57 explicit ids that already carry the prefix
docs["57-explicit-id-prefix"] = [C("plain-id", '## One <a id="pre2"></a>'), C("prefixed-id", '## Two <a id="user-content-pre2"></a>')]
