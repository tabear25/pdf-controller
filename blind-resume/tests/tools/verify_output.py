import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import pikepdf
from PIL import Image
from pypdf import PdfReader

ALLOWED_PAGE_KEYS = {"/Type", "/Parent", "/MediaBox", "/Resources", "/Contents"}
ALLOWED_ROOT_KEYS = {"/Type", "/Pages"}
ALLOWED_IMAGE_KEYS = {"/Type", "/Subtype", "/Width", "/Height", "/BitsPerComponent", "/ColorSpace", "/Filter", "/Length"}
DARK_THRESHOLD = 80
RENDER_DPI = 100


def variants(text):
    out = set()
    for enc in ("utf-8", "utf-16-be", "utf-16-le"):
        b = text.encode(enc)
        out.add(b)
        out.add(b.hex().encode())
        out.add(b.hex().upper().encode())
    try:
        out.add(text.encode("shift_jis"))
        out.add(text.encode("euc_jp"))
    except UnicodeEncodeError:
        pass
    out.add("".join(f"#{b:02X}" for b in text.encode("utf-8")).encode())
    return out


def find_strings(blob, strings):
    found = set()
    lower = blob.lower()
    for s in strings:
        for v in variants(s):
            if v in blob or (s.isascii() and v.lower() in lower):
                found.add(s)
                break
    return found


def jpeg_metadata_markers(data):
    markers = []
    if data[:2] != b"\xff\xd8":
        return ["not-jpeg"]
    i = 2
    while i + 3 < len(data):
        if data[i] != 0xFF:
            return markers + ["broken"]
        marker = data[i + 1]
        if marker in (0x01,) or 0xD0 <= marker <= 0xD9:
            i += 2
            continue
        length = (data[i + 2] << 8) | data[i + 3]
        if marker == 0xFE or 0xE1 <= marker <= 0xEF:
            markers.append(f"0x{marker:02X}")
        if marker == 0xE0 and data[i + 4 : i + 9] != b"JFIF\x00":
            markers.append("APP0-non-JFIF")
        if marker == 0xDA:
            return markers
        i += 2 + length
    return markers + ["no-scan"]


def scan_pdf(path, strings, password=None):
    found = set()
    structure = []
    jpeg_issues = []
    with pikepdf.open(path, password=password or "") as pdf:
        raw = Path(path).read_bytes()
        stripped = raw
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Stream):
                is_image = obj.get("/Subtype") == "/Image"
                if is_image and obj.get("/Filter") == "/DCTDecode":
                    data = obj.read_raw_bytes()
                    jpeg_issues.extend(jpeg_metadata_markers(data))
                    stripped = stripped.replace(data, b"")
                else:
                    try:
                        found |= find_strings(obj.read_bytes(), strings)
                    except Exception:
                        found |= find_strings(obj.read_raw_bytes(), strings)
                found |= find_strings(obj.stream_dict.unparse(resolved=True), strings)
            else:
                try:
                    found |= find_strings(obj.unparse(resolved=True), strings)
                except Exception:
                    pass
        found |= find_strings(stripped, strings)
        found |= find_strings(pdf.trailer.unparse(resolved=True), strings)
        if "/Info" in pdf.trailer:
            structure.append("trailer has /Info")
        if "/Encrypt" in pdf.trailer and password is None:
            structure.append("trailer has /Encrypt")
        root_keys = set(pdf.Root.keys())
        if not root_keys <= ALLOWED_ROOT_KEYS:
            structure.append(f"catalog keys {sorted(root_keys - ALLOWED_ROOT_KEYS)}")
        sizes = []
        for n, page in enumerate(pdf.pages):
            keys = set(page.obj.keys())
            if not keys <= ALLOWED_PAGE_KEYS:
                structure.append(f"page {n + 1} keys {sorted(keys - ALLOWED_PAGE_KEYS)}")
            res = page.obj.get("/Resources")
            if res is not None and not set(res.keys()) <= {"/XObject"}:
                structure.append(f"page {n + 1} resources {sorted(set(res.keys()) - {'/XObject'})}")
            for name, xobj in (res.get("/XObject", {}) if res is not None else {}).items():
                if xobj.get("/Subtype") != "/Image":
                    structure.append(f"page {n + 1} xobject {name} is not an image")
                elif not set(xobj.keys()) <= ALLOWED_IMAGE_KEYS:
                    structure.append(f"page {n + 1} image keys {sorted(set(xobj.keys()) - ALLOWED_IMAGE_KEYS)}")
            mb = [float(v) for v in page.mediabox]
            sizes.append([mb[2] - mb[0], mb[3] - mb[1], int(page.obj.get("/Rotate", 0))])
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Dictionary) or isinstance(obj, pikepdf.Stream):
                t = obj.get("/Type")
                if t is not None and str(t) not in ("/Catalog", "/Pages", "/Page", "/XObject"):
                    structure.append(f"unexpected object type {t}")
    return {"forbidden": sorted(found), "structure": structure, "jpeg_metadata": jpeg_issues, "page_sizes": sizes}


def extract_text(path, password=None):
    reader = PdfReader(path)
    if reader.is_encrypted:
        reader.decrypt(password or "")
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception as error:
            parts.append(f"[extract error: {error}]")
    return "\n".join(parts)


def visible_box(page):
    m = page["mediaBox"]
    c = page["cropBox"]
    return [max(m[0], c[0]), max(m[1], c[1]), min(m[2], c[2]), min(m[3], c[3])]


def to_display(page, x, y):
    vx0, vy0, vx1, vy1 = visible_box(page)
    r = page["rotate"] % 360
    if r == 90:
        return y - vy0, x - vx0
    if r == 180:
        return vx1 - x, y - vy0
    if r == 270:
        return vy1 - y, vx1 - x
    return x - vx0, vy1 - y


def box_to_display(page, bbox):
    pts = [to_display(page, bbox[0], bbox[1]), to_display(page, bbox[2], bbox[1]), to_display(page, bbox[0], bbox[3]), to_display(page, bbox[2], bbox[3])]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def check_targets(output, fixture, skip_ids):
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", str(RENDER_DPI), "-png", output, str(Path(tmp) / "p")], check=True)
        files = sorted(Path(tmp).glob("p-*.png"))
        for index, page in enumerate(fixture["pages"]):
            if index >= len(files):
                results.append({"page": index, "id": "*", "error": "page missing"})
                continue
            image = Image.open(files[index]).convert("RGB")
            k = RENDER_DPI / 72
            for target in page["targets"]:
                if any(s in target["id"] for s in skip_ids):
                    continue
                x0, y0, x1, y1 = box_to_display(page, target["bbox"])
                box = (int(x0 * k) + 1, int(y0 * k) + 1, int(x1 * k + 0.999) - 1, int(y1 * k + 0.999) - 1)
                if box[2] <= box[0] or box[3] <= box[1]:
                    continue
                data = image.crop(box).tobytes()
                count = len(data) // 3
                dark = sum(1 for i in range(count) if max(data[3 * i], data[3 * i + 1], data[3 * i + 2]) < DARK_THRESHOLD)
                results.append({"page": index, "id": target["id"], "dark_ratio": dark / count})
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--password")
    parser.add_argument("--skip-ids", default="outside")
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    fixture = manifest["fixtures"][args.fixture]
    strings = manifest["forbiddenStrings"]
    skip_ids = [s for s in args.skip_ids.split(",") if s]
    report = {
        "output": scan_pdf(args.output, strings),
        "output_text": extract_text(args.output).strip(),
        "input": scan_pdf(args.input, strings, args.password),
        "input_text": extract_text(args.input, args.password),
        "targets": check_targets(args.output, fixture, skip_ids),
    }
    json.dump(report, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
