from PyPDF2 import PdfReader, PdfWriter
from tkinter import messagebox
import os

def rotate_pdf(pdf_path, direction, count):
    try:
        reader = PdfReader(pdf_path)
        writer = PdfWriter()
        for page in reader.pages:
            # PyPDF2 3.0.0以降は rotate() を利用。正の値は時計回り、負は反時計回り
            if direction == "right":
                page.rotate(90 * count)
            else:
                page.rotate(-90 * count)
            writer.add_page(page)
        base, ext = os.path.splitext(pdf_path)
        output_path = base + "_rotated" + ext
        with open(output_path, "wb") as f_out:
            writer.write(f_out)
        messagebox.showinfo("✅ 完了", f"回転済みPDFを保存しました:\n{output_path}")
        return output_path
    except Exception as e:
        messagebox.showerror("❌ エラー", f"PDFの回転に失敗しました: {e}")
        return None
