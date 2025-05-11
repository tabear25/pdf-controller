import os
from PyPDF2 import PdfReader, PdfWriter

def delete_pages(pdf_path: str, pages_to_delete: list[int]) -> None:
    """
    任意のページを削除する関数
    """
    reader = PdfReader(pdf_path)
    writer = PdfWriter()
    total_pages = len(reader.pages)
    
    # Validate page numbers
    pages_set = set(pages_to_delete)
    invalid = [p for p in pages_set if p < 1 or p > total_pages]
    if invalid:
        print(f"⚠️ Warning: Invalid page numbers {invalid} ignored.")
    
    # Build new PDF without the deleted pages
    for i in range(total_pages):
        if (i + 1) not in pages_set:
            writer.add_page(reader.pages[i])

    # Save output
    base, ext = os.path.splitext(pdf_path)
    output_path = f"{base}_pages_deleted{ext}"
    with open(output_path, "wb") as f:
        writer.write(f)

    print(f"✅ Deleted pages {sorted(pages_set - set(invalid))}. Saved to: {output_path}")
