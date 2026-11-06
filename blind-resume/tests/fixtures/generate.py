import io
import json
import os
import random
import sys
from pathlib import Path

import img2pdf
import pikepdf
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A3, A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
OUT = HERE / "pdf"
FONT_PATH = os.environ.get("FIXTURE_FONT", "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf")
EMBEDDED = "IPAGothic"
SCAN_DPI = 200

PERSONA = {
    "name": "見本 太郎",
    "name_compact": "見本太郎",
    "kana": "みほん たろう",
    "katakana": "ミホン タロウ",
    "romaji": "Taro Mihon",
    "email": "taro.mihon@example.com",
    "phone": "090-0000-1234",
    "phone_fullwidth": "０９０－００００－５６７８",
    "url": "https://example.com/mihon-taro",
    "postal": "〒000-0001",
    "address": "東京都見本区見本町1-2-3",
    "birth": "1990年4月1日",
    "age": "満35歳",
    "station": "見本線 見本駅",
    "school": "見本大学",
}

FORBIDDEN_STRINGS = [
    "見本",
    "太郎",
    "花子",
    "みほん",
    "ミホン",
    "Mihon",
    "MIHON",
    "taro.mihon",
    "example.com",
    "0000-1234",
    "000-0001",
]

JIS_B5 = (182 * mm, 257 * mm)

manifest = {"persona": PERSONA, "forbiddenStrings": FORBIDDEN_STRINGS, "fixtures": {}}


def register_fonts():
    pdfmetrics.registerFont(TTFont(EMBEDDED, FONT_PATH))
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiKakuGo-W5"))
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3"))


def rnd(values):
    return [round(v, 2) for v in values]


class PageRecorder:
    def __init__(self, media_box, crop_box=None, rotate=0):
        self.media_box = list(media_box)
        self.crop_box = list(crop_box or media_box)
        self.rotate = rotate
        self.targets = []

    def text(self, c, font, size, x, y, text, target_id=None, part=None):
        c.setFont(font, size)
        c.drawString(x, y, text)
        if target_id is None:
            return
        part = part or text
        start = text.index(part)
        offset = pdfmetrics.stringWidth(text[:start], font, size)
        width = pdfmetrics.stringWidth(part, font, size)
        self.add(target_id, part, [x + offset, y - 0.2 * size, x + offset + width, y + 0.9 * size])

    def add(self, target_id, text, bbox):
        self.targets.append({"id": target_id, "text": text, "bbox": rnd(bbox)})

    def shifted(self, dx, dy):
        for t in self.targets:
            x0, y0, x1, y1 = t["bbox"]
            t["bbox"] = rnd([x0 + dx, y0 + dy, x1 + dx, y1 + dy])

    def to_json(self):
        return {"mediaBox": rnd(self.media_box), "cropBox": rnd(self.crop_box), "rotate": self.rotate, "targets": self.targets}


def record(name, description, pages, has_text=True, password=None, extra=None):
    entry = {"description": description, "hasText": has_text, "password": password, "pages": [p.to_json() for p in pages]}
    if extra:
        entry.update(extra)
    manifest["fixtures"][name] = entry


def dummy_photo(width_px=300, height_px=400):
    img = Image.new("RGB", (width_px, height_px), (214, 222, 232))
    d = ImageDraw.Draw(img)
    cx = width_px // 2
    d.ellipse([cx - 70, 70, cx + 70, 230], fill=(150, 160, 175))
    d.rounded_rectangle([cx - 130, 250, cx + 130, height_px + 60], radius=90, fill=(150, 160, 175))
    d.text((12, 12), "DUMMY", fill=(90, 100, 115))
    return img


def new_canvas(path, size):
    c = canvas.Canvas(str(path), pagesize=size, invariant=1)
    c.setAuthor("")
    c.setTitle("")
    c.setSubject("")
    c.setCreator("blind-resume fixtures")
    return c


def header_footer(c, rec, page_no, total, width, height):
    rec.text(c, EMBEDDED, 9, 40, height - 28, f"履歴書・職務経歴書　{PERSONA['name']}", f"header-name-p{page_no}", PERSONA["name"])
    rec.text(c, EMBEDDED, 8, 40, 22, f"{PERSONA['name']}　{page_no} / {total}", f"footer-name-p{page_no}", PERSONA["name"])


def fixture_01():
    name = "01_embedded_resume.pdf"
    w, h = A4
    c = new_canvas(OUT / name, A4)
    pages = []
    rec = PageRecorder([0, 0, w, h])
    header_footer(c, rec, 1, 2, w, h)
    rec.text(c, EMBEDDED, 22, 230, h - 80, "履　歴　書")
    rows = [
        ("ふりがな", PERSONA["kana"], "kana"),
        ("氏名", PERSONA["name"], "name"),
        ("生年月日", f"{PERSONA['birth']}（{PERSONA['age']}）", "birth"),
        ("性別", "男", "gender"),
        ("現住所", f"{PERSONA['postal']}　{PERSONA['address']}", "address"),
        ("最寄り駅", PERSONA["station"], "station"),
        ("電話", PERSONA["phone"], "phone"),
        ("メール", PERSONA["email"], "email"),
        ("URL", PERSONA["url"], "url"),
    ]
    y = h - 140
    for label, value, key in rows:
        c.setLineWidth(0.5)
        c.line(40, y - 8, 420, y - 8)
        rec.text(c, EMBEDDED, 9, 44, y, label)
        size = 18 if key == "name" else 11
        rec.text(c, EMBEDDED, size, 120, y, value, f"p1-{key}")
        y -= 34
    photo_box = [440, h - 280, 440 + 30 * mm, h - 280 + 40 * mm]
    c.rect(photo_box[0], photo_box[1], photo_box[2] - photo_box[0], photo_box[3] - photo_box[1])
    c.drawImage(ImageReader(dummy_photo()), photo_box[0] + 2, photo_box[1] + 2, photo_box[2] - photo_box[0] - 4, photo_box[3] - photo_box[1] - 4)
    rec.add("p1-photo", "写真", photo_box)
    y -= 10
    rec.text(c, EMBEDDED, 12, 44, y, "学歴・職歴")
    for line in ["2009年3月　見本高等学校　卒業", f"2013年3月　{PERSONA['school']}　経済学部　卒業", "2013年4月　株式会社見本商事　入社"]:
        y -= 22
        rec.text(c, EMBEDDED, 10, 60, y, line, f"p1-history-{len(rec.targets)}", "見本")
    c.showPage()
    pages.append(rec)

    rec = PageRecorder([0, 0, w, h])
    header_footer(c, rec, 2, 2, w, h)
    rec.text(c, EMBEDDED, 14, 44, h - 80, "自己PR")
    y = h - 110
    pr_lines = [
        (f"私、{PERSONA['name_compact']}（{PERSONA['kana']}）は、営業企画の仕事に携わってきました。", PERSONA["name_compact"], "pr-name"),
        (f"英語表記では {PERSONA['romaji']} と名乗り、海外の取引先とも連絡を取ってきました。", PERSONA["romaji"], "pr-romaji"),
        (f"ご連絡は {PERSONA['email']} か、{PERSONA['phone_fullwidth']} までお願いします。", PERSONA["phone_fullwidth"], "pr-phone-fullwidth"),
        (f"{PERSONA['school']}では統計を学び、データに基づく提案を得意としています。", PERSONA["school"], "pr-school"),
    ]
    for text, part, key in pr_lines:
        rec.text(c, EMBEDDED, 10.5, 44, y, text, f"p2-{key}", part)
        y -= 22
    rec.text(c, EMBEDDED, 14, 44, y - 20, "志望動機")
    rec.text(c, EMBEDDED, 10.5, 44, y - 46, "株式会社見本商事での経験を生かし、貴社の事業に貢献したいと考えています。", "p2-company", "見本商事")
    c.showPage()
    pages.append(rec)
    c.save()
    record(name, "フォントを埋め込んだ 2 ページの履歴書。全ページのヘッダーとフッターに氏名がある", pages)


def fixture_02():
    name = "02_nonembedded.pdf"
    w, h = A4
    c = new_canvas(OUT / name, A4)
    rec = PageRecorder([0, 0, w, h])
    rec.text(c, "HeiseiMin-W3", 20, 60, h - 80, "履歴書（日本語フォント非埋め込み）")
    rec.text(c, "HeiseiKakuGo-W5", 16, 60, h - 130, f"氏名：{PERSONA['name']}", "name", PERSONA["name"])
    rec.text(c, "HeiseiMin-W3", 12, 60, h - 160, f"ふりがな：{PERSONA['kana']}", "kana", PERSONA["kana"])
    rec.text(c, "HeiseiKakuGo-W5", 12, 60, h - 190, f"住所：{PERSONA['postal']} {PERSONA['address']}", "address", PERSONA["address"])
    rec.text(c, "HeiseiMin-W3", 12, 60, h - 220, f"電話：{PERSONA['phone_fullwidth']}", "phone", PERSONA["phone_fullwidth"])
    rec.text(c, "Helvetica", 12, 60, h - 250, f"Email: {PERSONA['email']}", "email", PERSONA["email"])
    rec.text(c, "Times-Roman", 12, 60, h - 275, f"Name: {PERSONA['romaji']}", "romaji", PERSONA["romaji"])
    c.showPage()
    c.save()
    record(name, "日本語フォント（HeiseiKakuGo-W5、HeiseiMin-W3）と欧文の標準フォントを埋め込んでいない", [rec])


def fixture_03():
    name = "03_spaced_name.pdf"
    w, h = A4
    c = new_canvas(OUT / name, A4)
    rec = PageRecorder([0, 0, w, h])
    rec.text(c, EMBEDDED, 12, 60, h - 100, "氏名（1 文字ずつ別々に配置）")
    x = 260
    for ch in PERSONA["name_compact"]:
        rec.text(c, EMBEDDED, 16, x, h - 100, ch, f"spaced-char-{ch}")
        x += 40
    rec.add("spaced-name", PERSONA["name_compact"], [260, h - 100 - 3.2, 260 + 40 * 3 + 16, h - 100 + 14.4])
    rec.text(c, EMBEDDED, 12, 60, h - 150, "氏名（字間指定）")
    c.saveState()
    t = c.beginText(260, h - 150)
    t.setFont(EMBEDDED, 16)
    t.setCharSpace(18)
    t.textOut("見本花子")
    c.drawText(t)
    c.restoreState()
    rec.add("charspace-name", "見本花子", [260, h - 150 - 3.2, 260 + 4 * 16 + 3 * 18, h - 150 + 14.4])
    rec.text(c, EMBEDDED, 12, 60, h - 200, "氏名（全角空白）")
    rec.text(c, EMBEDDED, 16, 260, h - 200, "見　本　太　郎", "ideographic-space-name")
    rec.text(c, EMBEDDED, 12, 60, h - 250, "フリガナ（1 文字ずつ）")
    x = 260
    for ch in "ミホンタロウ":
        rec.text(c, EMBEDDED, 12, x, h - 250, ch)
        x += 22
    rec.add("spaced-katakana", "ミホンタロウ", [260, h - 250 - 2.4, 260 + 22 * 5 + 12, h - 250 + 10.8])
    rec.text(c, EMBEDDED, 12, 60, h - 300, "半角カナ", None)
    rec.text(c, EMBEDDED, 12, 260, h - 300, "ﾐﾎﾝ ﾀﾛｳ", "halfwidth-katakana")
    rec.text(c, EMBEDDED, 12, 60, h - 330, "濁点つき半角カナ", None)
    rec.text(c, EMBEDDED, 12, 260, h - 330, "ﾐﾎﾝｶﾞｸｴﾝ", "halfwidth-dakuten")
    rec.text(c, EMBEDDED, 12, 60, h - 360, "字間の空いた半角カナ", None)
    spaced = "ﾐﾎﾝﾀﾞｲｶﾞｸ"
    widths = [pdfmetrics.stringWidth(ch, EMBEDDED, 12) for ch in spaced]
    c.saveState()
    t = c.beginText(260, h - 360)
    t.setFont(EMBEDDED, 12)
    t.setCharSpace(9)
    t.textOut(spaced)
    c.drawText(t)
    c.restoreState()
    rec.add("halfwidth-dakuten-charspace", spaced, [260, h - 360 - 2.4, 260 + sum(widths) + 9 * (len(spaced) - 1), h - 360 + 10.8])
    c.showPage()
    c.save()
    record(name, "均等割り付けで 1 文字ずつ離れた氏名、字間指定、全角空白、半角カナを含む", [rec])


def fixture_04():
    name = "04_rotated_sizes.pdf"
    tmp = OUT / f".{name}.tmp"
    specs = [
        ("A4 縦", A4, 0),
        ("A4 縦", A4, 90),
        ("A4 縦", A4, 270),
        ("A4 横", (A4[1], A4[0]), 0),
        ("JIS B5 縦", JIS_B5, 0),
        ("A3 縦", A3, 0),
        ("A4 縦", A4, 180),
    ]
    c = new_canvas(tmp, A4)
    pages = []
    for i, (label, size, rotate) in enumerate(specs, start=1):
        w, h = size
        c.setPageSize(size)
        rec = PageRecorder([0, 0, w, h], rotate=rotate)
        rec.text(c, EMBEDDED, 10, 36, h - 36, f"氏名：{PERSONA['name']}", f"p{i}-header-name", PERSONA["name"])
        rec.text(c, EMBEDDED, 14, 60, h / 2, f"ページ {i}：{label}、/Rotate {rotate}")
        c.setStrokeColorRGB(0.8, 0.1, 0.1)
        c.rect(w - 120, 40, 80, 40)
        c.setStrokeColorRGB(0, 0, 0)
        rec.add(f"p{i}-marker", "marker", [w - 120, 40, w - 40, 80])
        c.showPage()
        pages.append(rec)
    c.save()
    with pikepdf.open(tmp) as pdf:
        for page, (_, _, rotate) in zip(pdf.pages, specs):
            if rotate:
                page.obj["/Rotate"] = rotate
        pdf.save(OUT / name, deterministic_id=True)
    tmp.unlink()
    record(name, "回転（90、180、270）、横向き、JIS B5、A3 のページが混ざっている", pages)


def fixture_05():
    name = "05_cropbox.pdf"
    tmp = OUT / f".{name}.tmp"
    c = new_canvas(tmp, (700, 1000))
    p1 = PageRecorder([0, 0, 700, 1000], crop_box=[50, 80, 645, 922])
    p1.text(c, EMBEDDED, 14, 80, 880, f"氏名：{PERSONA['name']}（CropBox の内側）", "p1-name", PERSONA["name"])
    p1.text(c, EMBEDDED, 12, 80, 120, f"電話：{PERSONA['phone']}", "p1-phone", PERSONA["phone"])
    p1.text(c, EMBEDDED, 12, 60, 30, "クロップ外の見本テキスト（画面に出ない）", "p1-outside", "見本")
    c.showPage()
    c.setPageSize((595, 842))
    p2 = PageRecorder([-100, -100, 495, 742])
    p2.text(c, EMBEDDED, 14, 60, 780, f"氏名：{PERSONA['name']}（原点が負の MediaBox）", "p2-name", PERSONA["name"])
    p2.text(c, EMBEDDED, 12, 60, 80, f"メール：{PERSONA['email']}", "p2-email", PERSONA["email"])
    c.showPage()
    c.setPageSize((700, 1000))
    p3 = PageRecorder([0, 0, 700, 1000], crop_box=[50, 80, 645, 922], rotate=90)
    p3.text(c, EMBEDDED, 14, 80, 880, f"氏名：{PERSONA['name']}（CropBox と /Rotate 90）", "p3-name", PERSONA["name"])
    c.showPage()
    c.save()
    with pikepdf.open(tmp) as pdf:
        pdf.pages[0].obj["/CropBox"] = pikepdf.Array([50, 80, 645, 922])
        page2 = pdf.pages[1]
        page2.obj["/MediaBox"] = pikepdf.Array([-100, -100, 495, 742])
        page2.contents_add(pikepdf.Stream(pdf, b"q 1 0 0 1 -100 -100 cm"), prepend=True)
        page2.contents_add(pikepdf.Stream(pdf, b"Q"), prepend=False)
        pdf.pages[2].obj["/CropBox"] = pikepdf.Array([50, 80, 645, 922])
        pdf.pages[2].obj["/Rotate"] = 90
        pdf.save(OUT / name, deterministic_id=True)
    tmp.unlink()
    p2.shifted(-100, -100)
    record(name, "CropBox が MediaBox と異なるページ、原点が負のページ、CropBox と回転の組み合わせ", [p1, p2, p3])


def fixture_06():
    name = "06_metadata_annots.pdf"
    tmp = OUT / f".{name}.tmp"
    w, h = A4
    c = new_canvas(tmp, A4)
    rec = PageRecorder([0, 0, w, h])
    rec.text(c, EMBEDDED, 16, 60, h - 80, "注釈・フォーム・添付ファイルの確認用")
    rec.text(c, EMBEDDED, 12, 60, h - 120, "応募者名（フォーム）：")
    c.acroForm.textfield(name="candidate_name", value=PERSONA["romaji"], x=200, y=h - 128, width=180, height=20, fontName="Helvetica", fontSize=11, borderWidth=1)
    rec.add("form-name", PERSONA["romaji"], [200, h - 128, 380, h - 108])
    c.setFillColorRGB(1, 1, 1)
    c.setFont(EMBEDDED, 12)
    c.drawString(60, h - 300, f"白い文字の{PERSONA['name_compact']}")
    c.setFillColorRGB(0, 0, 0)
    rec.text(c, EMBEDDED, 12, 60, h - 200, "下に隠しレイヤーの文字があります（画面に出ない）")
    c.showPage()
    c.save()
    with pikepdf.open(tmp) as pdf:
        page = pdf.pages[0]
        acro = pdf.Root.AcroForm
        field_ja = pdf.make_indirect(pikepdf.Dictionary(
            FT=pikepdf.Name.Tx,
            T=pikepdf.String("candidate_name_ja"),
            V=pikepdf.String(PERSONA["name"]),
            Rect=pikepdf.Array([200, h - 160, 380, h - 140]),
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.Widget,
            F=4,
            P=page.obj,
        ))
        acro.Fields.append(field_ja)
        helv = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
        note = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.Text,
            Rect=pikepdf.Array([420, h - 90, 444, h - 66]),
            Contents=pikepdf.String(f"{PERSONA['name_compact']}さんの面接メモ（ダミー）"),
            T=pikepdf.String(PERSONA["name"]),
            F=4,
        ))
        free_ap = pikepdf.Stream(pdf, b"BT /Helv 11 Tf 2 6 Td (Comment: Taro Mihon) Tj ET")
        free_ap.Type = pikepdf.Name.XObject
        free_ap.Subtype = pikepdf.Name.Form
        free_ap.BBox = pikepdf.Array([0, 0, 200, 22])
        free_ap.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(Helv=helv))
        free = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.FreeText,
            Rect=pikepdf.Array([60, h - 260, 260, h - 238]),
            Contents=pikepdf.String("Comment: Taro Mihon"),
            DA=pikepdf.String("/Helv 11 Tf 0 g"),
            F=4,
            AP=pikepdf.Dictionary(N=free_ap),
        ))
        link = pdf.make_indirect(pikepdf.Dictionary(
            Type=pikepdf.Name.Annot,
            Subtype=pikepdf.Name.Link,
            Rect=pikepdf.Array([60, h - 120 - 4, 190, h - 120 + 12]),
            Border=pikepdf.Array([0, 0, 0]),
            A=pikepdf.Dictionary(S=pikepdf.Name.URI, URI=pikepdf.String(PERSONA["url"])),
        ))
        annots = page.obj.get("/Annots")
        if annots is None:
            page.obj["/Annots"] = pikepdf.Array()
            annots = page.obj["/Annots"]
        for a in (field_ja, note, free, link):
            annots.append(a)
        ocg = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.OCG, Name=pikepdf.String("隠しレイヤー")))
        pdf.Root.OCProperties = pikepdf.Dictionary(
            OCGs=pikepdf.Array([ocg]),
            D=pikepdf.Dictionary(Order=pikepdf.Array([ocg]), OFF=pikepdf.Array([ocg])),
        )
        res = page.obj.Resources
        if "/Properties" not in res:
            res.Properties = pikepdf.Dictionary()
        res.Properties.oc1 = ocg
        if "/Font" not in res:
            res.Font = pikepdf.Dictionary()
        res.Font.HelvHidden = helv
        page.contents_add(pikepdf.Stream(pdf, b"/OC /oc1 BDC BT /HelvHidden 14 Tf 60 520 Td (Hidden layer: Taro Mihon) Tj ET EMC"), prepend=False)
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            meta["dc:title"] = f"{PERSONA['name_compact']}の履歴書"
            meta["dc:creator"] = [PERSONA["name"]]
            meta["dc:description"] = f"{PERSONA['romaji']} resume"
        pdf.docinfo["/Title"] = pikepdf.String(f"{PERSONA['name_compact']}の履歴書")
        pdf.docinfo["/Author"] = pikepdf.String(PERSONA["name"])
        pdf.docinfo["/Subject"] = pikepdf.String(f"{PERSONA['romaji']} / {PERSONA['email']}")
        pdf.docinfo["/Keywords"] = pikepdf.String(f"{PERSONA['name_compact']}, MIHON")
        pdf.docinfo["/Creator"] = pikepdf.String(f"{PERSONA['name']} のパソコン")
        spec = pikepdf.AttachedFileSpec(pdf, f"{PERSONA['name_compact']}の職務経歴（ダミー）".encode("utf-8"), description=PERSONA["name"], filename="mihon_taro_career.txt", mime_type="text/plain")
        pdf.attachments["mihon_taro_career.txt"] = spec
        with pdf.open_outline() as outline:
            outline.root.append(pikepdf.OutlineItem(f"{PERSONA['name_compact']}の履歴書", 0))
        js = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String(f"app.alert('{PERSONA['name_compact']}');")))
        names = pdf.Root.get("/Names")
        if names is None:
            pdf.Root.Names = pikepdf.Dictionary()
            names = pdf.Root.Names
        names.JavaScript = pikepdf.Dictionary(Names=pikepdf.Array([pikepdf.String("init"), js]))
        pdf.Root.OpenAction = js
        pdf.save(OUT / name, deterministic_id=True)
    tmp.unlink()
    record(
        name,
        "文書情報・XMP・注釈（コメント、FreeText、リンク）・フォームの入力値・添付ファイル・しおり・JavaScript・隠しレイヤー・白い文字にダミーの氏名がある",
        [rec],
        extra={"hiddenStrings": ["Hidden layer: Taro Mihon", f"白い文字の{PERSONA['name_compact']}"]},
    )


def scan_page_image(persona_name, seed):
    width_px, height_px = int(210 / 25.4 * SCAN_DPI), int(297 / 25.4 * SCAN_DPI)
    img = Image.new("L", (width_px, height_px), 255)
    d = ImageDraw.Draw(img)
    targets = []

    def put(x_mm, y_mm, size_pt, text, target_id=None):
        size_px = int(size_pt / 72 * SCAN_DPI)
        font = ImageFont.truetype(FONT_PATH, size_px)
        x_px, y_px = int(x_mm / 25.4 * SCAN_DPI), int(y_mm / 25.4 * SCAN_DPI)
        d.text((x_px, y_px), text, fill=0, font=font)
        ascent, _ = font.getmetrics()
        if target_id:
            l, t, r, b = d.textbbox((x_px, y_px), text, font=font)
            targets.append({"id": target_id, "text": text, "bboxPx": [l, t, r, b], "sizePt": size_pt, "originPx": [x_px, y_px + ascent]})

    put(20, 18, 9, f"履歴書・職務経歴書　{persona_name}", "scan-header")
    put(80, 30, 20, "履　歴　書")
    put(20, 50, 16, persona_name, "scan-name")
    put(20, 62, 11, f"電話：{PERSONA['phone']}", "scan-phone")
    put(20, 72, 11, f"メール：{PERSONA['email']}", "scan-email")
    put(20, 82, 11, f"住所：{PERSONA['postal']} {PERSONA['address']}", "scan-address")
    put(20, 110, 11, "自己PR：営業企画の経験を生かし、貴社に貢献したいと考えています。")
    box = [int(150 / 25.4 * SCAN_DPI), int(40 / 25.4 * SCAN_DPI), int(180 / 25.4 * SCAN_DPI), int(80 / 25.4 * SCAN_DPI)]
    photo = dummy_photo().convert("L").resize((box[2] - box[0], box[3] - box[1]))
    img.paste(photo, (box[0], box[1]))
    d.rectangle(box, outline=0, width=3)
    targets.append({"id": "scan-photo", "text": "写真", "bboxPx": box})
    rng = random.Random(seed)
    for _ in range(4000):
        x, y = rng.randrange(width_px), rng.randrange(height_px)
        img.putpixel((x, y), rng.choice([0, 200]))
    img = img.rotate(0.4, resample=Image.BICUBIC, fillcolor=255)
    return img, targets


def px_bbox_to_pt(bbox_px, height_px):
    k = 72 / SCAN_DPI
    l, t, r, b = bbox_px
    return rnd([l * k, (height_px - b) * k, r * k, (height_px - t) * k])


def scan_recorder(targets, width_px, height_px):
    w_pt, h_pt = width_px * 72 / SCAN_DPI, height_px * 72 / SCAN_DPI
    rec = PageRecorder([0, 0, w_pt, h_pt])
    for t in targets:
        rec.add(t["id"], t["text"], px_bbox_to_pt(t["bboxPx"], height_px))
    return rec


def fixture_07():
    name = "07_scan_image_only.pdf"
    images = []
    pages = []
    gray, targets = scan_page_image(PERSONA["name"], 1)
    bw = gray.point(lambda v: 0 if v < 160 else 255, mode="1")
    buf = io.BytesIO()
    bw.save(buf, format="TIFF", compression="group4", dpi=(SCAN_DPI, SCAN_DPI))
    images.append(buf.getvalue())
    pages.append(scan_recorder(targets, gray.width, gray.height))
    gray2, targets2 = scan_page_image("見本 花子", 2)
    gray2 = gray2.filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    gray2.save(buf, format="JPEG", quality=85, dpi=(SCAN_DPI, SCAN_DPI))
    images.append(buf.getvalue())
    pages.append(scan_recorder(targets2, gray2.width, gray2.height))
    gray3, targets3 = scan_page_image(PERSONA["name"], 3)
    color = Image.merge("RGB", (gray3, gray3, gray3.point(lambda v: min(255, v + 12))))
    buf = io.BytesIO()
    color.save(buf, format="JPEG2000", quality_mode="rates", quality_layers=[20], dpi=(SCAN_DPI, SCAN_DPI))
    images.append(buf.getvalue())
    pages.append(scan_recorder(targets3, gray3.width, gray3.height))
    layout = img2pdf.get_fixed_dpi_layout_fun((SCAN_DPI, SCAN_DPI))
    raw = img2pdf.convert(images, layout_fun=layout, nodate=True)
    with pikepdf.open(io.BytesIO(raw)) as pdf:
        if "/ID" in pdf.trailer:
            del pdf.trailer["/ID"]
        pdf.save(OUT / name, deterministic_id=True)
    record(name, "画像だけのスキャン PDF（1 ページ目 CCITT G4、2 ページ目 JPEG、3 ページ目 JPEG 2000）", pages, has_text=False)


def fixture_08():
    name = "08_scan_with_text_layer.pdf"
    gray, targets = scan_page_image(PERSONA["name"], 4)
    w, h = gray.width * 72 / SCAN_DPI, gray.height * 72 / SCAN_DPI
    buf = io.BytesIO()
    gray.save(buf, format="JPEG", quality=85)
    c = new_canvas(OUT / name, (w, h))
    c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), 0, 0, w, h)
    k = 72 / SCAN_DPI
    for t in targets:
        if "originPx" not in t:
            continue
        x_pt = t["originPx"][0] * k
        y_pt = h - t["originPx"][1] * k
        text = c.beginText(x_pt, y_pt)
        text.setFont(EMBEDDED, t["sizePt"])
        text.setTextRenderMode(3)
        text.textOut(t["text"])
        c.drawText(text)
    c.showPage()
    c.save()
    rec = scan_recorder(targets, gray.width, gray.height)
    record(name, "スキャン画像に、透明なテキスト層（描画モード 3）が付いている", [rec])


def fixture_09():
    name = "09_password.pdf"
    tmp = OUT / f".{name}.tmp"
    w, h = A4
    c = new_canvas(tmp, A4)
    rec = PageRecorder([0, 0, w, h])
    rec.text(c, EMBEDDED, 16, 60, h - 100, f"氏名：{PERSONA['name']}（パスワード付き）", "name", PERSONA["name"])
    c.showPage()
    c.save()
    if "--force-encrypted" in sys.argv or not (OUT / name).exists():
        with pikepdf.open(tmp) as pdf:
            pdf.save(OUT / name, encryption=pikepdf.Encryption(user="mihon-pass", owner="mihon-owner", R=6), static_id=True)
    tmp.unlink()
    record(name, "パスワード付き（AES-256）。パスワードは mihon-pass", [rec], password="mihon-pass")


def fixture_10():
    name = "10_large_page.pdf"
    size = (841 * mm, 1189 * mm)
    c = new_canvas(OUT / name, size)
    w, h = size
    rec = PageRecorder([0, 0, w, h])
    rec.text(c, EMBEDDED, 48, 100, h - 160, f"氏名：{PERSONA['name']}（A0 サイズ）", "name", PERSONA["name"])
    c.showPage()
    c.save()
    record(name, "A0 サイズの大きなページ（高い解像度ではブラウザの描画の上限を超える）", [rec])


def main():
    if not Path(FONT_PATH).exists():
        sys.exit(f"フォントが見つかりません: {FONT_PATH}（環境変数 FIXTURE_FONT で指定できます）")
    OUT.mkdir(parents=True, exist_ok=True)
    register_fonts()
    for fn in (fixture_01, fixture_02, fixture_03, fixture_04, fixture_05, fixture_06, fixture_07, fixture_08, fixture_09, fixture_10):
        fn()
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(manifest['fixtures'])} fixtures in {OUT}")


if __name__ == "__main__":
    main()
