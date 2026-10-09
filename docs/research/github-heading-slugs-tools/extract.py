import html as htmllib
from html.parser import HTMLParser

PREFIX = "user-content-"


def line_offsets(s):
    offs = [0]
    for i, ch in enumerate(s):
        if ch == "\n":
            offs.append(i + 1)
    return offs


class P(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.src = src
        self.offs = line_offsets(src)
        self.headings = []
        self.cur = None      # heading being read
        self.wrapper = None  # open markdown-heading wrapper
        self.wdepth = 0
        self.depth_in_h = 0

    def off(self):
        l, c = self.getpos()
        return self.offs[l - 1] + c

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        start = self.off()
        end = start + len(self.get_starttag_text())
        if tag == "div" and "markdown-heading" in (a.get("class") or "").split() and self.wrapper is None and self.cur is None:
            self.wrapper = {"heading": None}
            self.wdepth = 1
            return
        if self.wrapper is not None and tag == "div":
            self.wdepth += 1
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self.cur is None:
            self.cur = {"level": int(tag[1]), "tag": tag, "attrs": a, "text": [], "start": end, "ids": [], "wrapped": self.wrapper is not None}
            if "id" in a:
                self.cur["ids"].append(a["id"])
            self.depth_in_h = 1
            return
        if self.cur is not None:
            if tag == self.cur["tag"]:
                self.depth_in_h += 1
            if "id" in a:
                self.cur["ids"].append(a["id"])
            if "name" in a:
                self.cur["ids"].append("name=" + a["name"])
            if tag == "br":
                pass
            return
        if self.wrapper is not None and tag == "a" and "anchor" in (a.get("class") or "").split():
            h = self.wrapper["heading"]
            if h is not None:
                h["raw_id"] = a.get("id")
                h["href"] = a.get("href")
                h["label"] = a.get("aria-label")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.cur is not None and tag == self.cur["tag"]:
            self.depth_in_h -= 1
            if self.depth_in_h == 0:
                h = self.cur
                h["inner"] = self.src[h["start"]:self.off()]
                h["text"] = "".join(h["text"])
                self.cur = None
                rec = {"level": h["level"], "text": h["text"], "inner": h["inner"], "ids": h["ids"], "wrapped": h["wrapped"], "raw_id": None, "href": None, "label": None}
                self.headings.append(rec)
                if self.wrapper is not None:
                    self.wrapper["heading"] = rec
            return
        if self.wrapper is not None and self.cur is None and tag == "div":
            self.wdepth -= 1
            if self.wdepth == 0:
                self.wrapper = None

    def handle_data(self, data):
        if self.cur is not None:
            self.cur["text"].append(data)


def extract(src):
    p = P(src)
    p.feed(src)
    p.close()
    out = []
    for h in p.headings:
        rid = h["raw_id"]
        anchor = None
        if rid is not None:
            anchor = rid[len(PREFIX):] if rid.startswith(PREFIX) else rid
        href = h["href"]
        out.append({
            "level": h["level"],
            "text": h["text"],
            "id": rid,
            "anchor": anchor,
            "href": href,
            "explicitIds": h["ids"],
            "html": h["inner"],
        })
    return out
