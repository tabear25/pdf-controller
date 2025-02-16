from PyPDF2 import PdfReader, PdfWriter
from tkinter import messagebox
import os

def unlock_pdf(pdf_path, password):
    try:
        reader = PdfReader(pdf_path)
        if reader.is_encrypted:
            if not reader.decrypt(password):
                messagebox.showerror("❌ エラー", "パスワードが正しくありません。")
                return None
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        base, ext = os.path.splitext(pdf_path)
        output_path = base + "_unlocked" + ext
        with open(output_path, "wb") as f_out:
            writer.write(f_out)
        messagebox.showinfo("✅ 完了", f"パスワード解除済みPDFを保存しました:\n{output_path}")
        return output_path
    except Exception as e:
        messagebox.showerror("❌ エラー", f"PDFのパスワード解除に失敗しました: {e}")
        return None