import io
from tkinter import messagebox
from PyPDF2 import PdfReader, PdfWriter
try:
    from pdf2image import convert_from_path, convert_from_bytes
except ImportError:
    convert_from_path = None
    convert_from_bytes = None

try:
    from pdf2image import convert_from_path, convert_from_bytes
except ImportError:
    convert_from_path = None
    convert_from_bytes = None

__all__ = ['convert_from_path', 'convert_from_bytes', 'preview_pdf']


def preview_pdf(pdf_path, mode, rotation_direction=None, rotation_count=1, poppler_path=None):
    """
    mode: "unlock" または "rotate"
    回転の場合は、rotation_direction ("right" or "left") と rotation_count (整数) を指定
    """
    if mode not in ("unlock", "rotate"):
        messagebox.showerror("❌ エラー", "不正なモードです。")
        return None
    
    try:
        if mode == "rotate":
            # 回転処理をメモリ上で実施してから画像変換
            reader = PdfReader(pdf_path)
            writer = PdfWriter()
            for page in reader.pages:
                if rotation_direction == "right":
                    page.rotate(90 * rotation_count)
                else:
                    page.rotate(-90 * rotation_count)
                writer.add_page(page)
            pdf_bytes = io.BytesIO()
            writer.write(pdf_bytes)
            pdf_bytes.seek(0)
            images = convert_from_bytes(pdf_bytes.read(), first_page=1, last_page=1, poppler_path=poppler_path)
        else:
            images = convert_from_path(pdf_path, first_page=1, last_page=1, poppler_path=poppler_path)
        return images
    except Exception as e:
        messagebox.showerror("❌ エラー", f"プレビューの表示に失敗しました: {e}")
        return None
