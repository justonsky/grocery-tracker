"""Minimal XLSX reader (stdlib only): values + per-cell fill colors."""
import zipfile, re
import xml.etree.ElementTree as ET

NS = {
    'm': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'pr': 'http://schemas.openxmlformats.org/package/2006/relationships',
}

# Legacy indexed color palette (ECMA-376 defaults)
INDEXED = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
 '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
 '800000','008000','000080','808000','800080','008080','C0C0C0','808080',
 '9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF',
 '000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF',
 '00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99',
 '3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696',
 '003366','339966','003300','333300','993300','993366','333399','333333']


def col_to_num(ref):
    m = re.match(r'([A-Z]+)', ref)
    n = 0
    for ch in m.group(1):
        n = n * 26 + (ord(ch) - 64)
    return n


def row_of(ref):
    return int(re.search(r'(\d+)', ref).group(1))


class Workbook:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self._shared()
        self._styles()
        self._theme()
        self._sheets()

    def _shared(self):
        self.shared = []
        try:
            root = ET.fromstring(self.z.read('xl/sharedStrings.xml'))
        except KeyError:
            return
        for si in root.findall('m:si', NS):
            self.shared.append(''.join(t.text or '' for t in si.iter(f"{{{NS['m']}}}t")))

    def _theme(self):
        self.theme = []
        try:
            root = ET.fromstring(self.z.read('xl/theme/theme1.xml'))
        except KeyError:
            return
        ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        scheme = root.find('.//a:clrScheme', ns)
        if scheme is None:
            return
        for child in scheme:
            srgb = child.find('a:srgbClr', ns)
            sysclr = child.find('a:sysClr', ns)
            if srgb is not None:
                self.theme.append(srgb.get('val'))
            elif sysclr is not None:
                self.theme.append(sysclr.get('lastClr'))
            else:
                self.theme.append('000000')
        # Excel swaps the first two pairs (lt1/dk1, lt2/dk2)
        if len(self.theme) >= 4:
            t = self.theme
            t[0], t[1], t[2], t[3] = t[1], t[0], t[3], t[2]

    def _resolve(self, el):
        """Resolve a color element -> 'RRGGBB' or None."""
        if el is None:
            return None
        if el.get('rgb'):
            v = el.get('rgb')
            return v[-6:].upper()
        if el.get('theme') is not None:
            idx = int(el.get('theme'))
            base = self.theme[idx] if idx < len(self.theme) else None
            if base is None:
                return None
            tint = el.get('tint')
            return apply_tint(base, float(tint)) if tint else base.upper()
        if el.get('indexed') is not None:
            idx = int(el.get('indexed'))
            return INDEXED[idx] if idx < len(INDEXED) else None
        return None

    def _styles(self):
        root = ET.fromstring(self.z.read('xl/styles.xml'))
        fills = []
        for f in root.findall('m:fills/m:fill', NS):
            pf = f.find('m:patternFill', NS)
            if pf is None or pf.get('patternType') in (None, 'none'):
                fills.append(None)
                continue
            fills.append(('_pending', pf.find('m:fgColor', NS), pf.find('m:bgColor', NS)))
        self._raw_fills = fills
        self.xf_fill = []
        for xf in root.findall('m:cellXfs/m:xf', NS):
            self.xf_fill.append(int(xf.get('fillId', 0)))

    def fill_of_style(self, sidx):
        if sidx is None or sidx >= len(self.xf_fill):
            return None
        fid = self.xf_fill[sidx]
        if fid >= len(self._raw_fills):
            return None
        raw = self._raw_fills[fid]
        if raw is None:
            return None
        _, fg, bg = raw
        return self._resolve(fg) or self._resolve(bg)

    def _sheets(self):
        rels = {}
        root = ET.fromstring(self.z.read('xl/_rels/workbook.xml.rels'))
        for rel in root:
            rels[rel.get('Id')] = rel.get('Target').lstrip('/')
        wb = ET.fromstring(self.z.read('xl/workbook.xml'))
        self.sheets = []  # (name, path)
        for sh in wb.findall('m:sheets/m:sheet', NS):
            rid = sh.get(f"{{{NS['r']}}}id")
            tgt = rels.get(rid, '')
            if not tgt.startswith('xl/'):
                tgt = 'xl/' + tgt
            self.sheets.append((sh.get('name'), tgt))

    def read_sheet(self, path):
        """-> {(row, col): {'v': value, 'fill': 'RRGGBB'|None}}"""
        root = ET.fromstring(self.z.read(path))
        cells = {}
        for c in root.iter(f"{{{NS['m']}}}c"):
            ref = c.get('r')
            if not ref:
                continue
            t = c.get('t')
            sidx = c.get('s')
            sidx = int(sidx) if sidx is not None else None
            v = None
            if t == 'inlineStr':
                is_el = c.find('m:is', NS)
                if is_el is not None:
                    v = ''.join(x.text or '' for x in is_el.iter(f"{{{NS['m']}}}t"))
            else:
                ve = c.find('m:v', NS)
                if ve is not None and ve.text is not None:
                    if t == 's':
                        v = self.shared[int(ve.text)]
                    elif t in ('str', 'e'):
                        v = ve.text
                    else:
                        try:
                            v = float(ve.text)
                        except ValueError:
                            v = ve.text
            cells[(row_of(ref), col_to_num(ref))] = {'v': v, 'fill': self.fill_of_style(sidx)}
        return cells


def apply_tint(hexrgb, tint):
    r = int(hexrgb[0:2], 16); g = int(hexrgb[2:4], 16); b = int(hexrgb[4:6], 16)
    def ap(c):
        c = c / 255.0
        c = c * (1 + tint) if tint < 0 else c * (1 - tint) + tint
        return max(0, min(255, round(c * 255)))
    return '%02X%02X%02X' % (ap(r), ap(g), ap(b))
