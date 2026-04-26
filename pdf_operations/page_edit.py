from PyPDF2 import PdfReader, PdfWriter
from tkinter import messagebox
import os
import re


def parse_page_spec(spec, total_pages):
    """
    "1,3,5-7" のような1始まりのページ指定文字列を、0始まりのページインデックスの
    集合に変換する。範囲外・不正な値は ValueError を投げる。
    """
    if spec is None:
        raise ValueError("ページ指定が空です。")
    cleaned = spec.replace(" ", "").replace("　", "")
    if not cleaned:
        raise ValueError("ページ指定が空です。")
    if not re.fullmatch(r"[0-9,\-]+", cleaned):
        raise ValueError(f"使用できない文字が含まれています: {spec}")

    indices = set()
    for token in cleaned.split(","):
        if not token:
            continue
        if "-" in token:
            parts = token.split("-")
            if len(parts) != 2 or not parts[0] or not parts[1]:
                raise ValueError(f"範囲指定が不正です: {token}")
            start, end = int(parts[0]), int(parts[1])
            if start > end:
                start, end = end, start
            for page in range(start, end + 1):
                _validate_page(page, total_pages)
                indices.add(page - 1)
        else:
            page = int(token)
            _validate_page(page, total_pages)
            indices.add(page - 1)
    return indices


def _validate_page(page, total_pages):
    if page < 1 or page > total_pages:
        raise ValueError(
            f"ページ番号 {page} は範囲外です (このPDFは {total_pages} ページです)。"
        )


def edit_pdf_pages(pdf_path, pages_to_delete_spec):
    """
    指定したページを削除した新しいPDFを書き出す。
    pages_to_delete_spec は "1,3,5-7" のような1始まりの文字列。
    例: 5ページのPDFで "5" を指定すると、ページ 1,2,3,4 だけの新しいPDFが
    元ファイルと同じフォルダに `_edited` 付きで保存される。
    """
    try:
        reader = PdfReader(pdf_path)
        total_pages = len(reader.pages)
        if total_pages == 0:
            messagebox.showerror("❌ エラー", "PDFにページが存在しません。")
            return None

        delete_set = parse_page_spec(pages_to_delete_spec, total_pages)
        kept_indices = [i for i in range(total_pages) if i not in delete_set]

        if not kept_indices:
            messagebox.showerror(
                "❌ エラー",
                "全てのページが削除対象です。少なくとも1ページは残す必要があります。",
            )
            return None

        writer = PdfWriter()
        for i in kept_indices:
            writer.add_page(reader.pages[i])

        base, ext = os.path.splitext(pdf_path)
        output_path = base + "_edited" + ext
        with open(output_path, "wb") as f_out:
            writer.write(f_out)

        kept_human = ", ".join(str(i + 1) for i in kept_indices)
        messagebox.showinfo(
            "✅ 完了",
            f"編集済みPDFを保存しました:\n{output_path}\n\n残したページ: {kept_human}",
        )
        return output_path
    except ValueError as ve:
        messagebox.showerror("❌ エラー", str(ve))
        return None
    except Exception as e:
        messagebox.showerror("❌ エラー", f"PDFのページ編集に失敗しました: {e}")
        return None
