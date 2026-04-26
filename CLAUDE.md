# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Install dependencies and launch the Tkinter GUI:

```bash
pip install -r requirements.txt
python main.py
```

There is no test suite, lint config, or build step in this repo.

## Architecture

The app is a desktop Tkinter GUI that wraps PDF operations powered by `PyPDF2` (PDF read/write) and `pdf2image` + Poppler (raster previews). It is organized so that GUI code never imports `PyPDF2` directly — every PDF operation lives in its own module under `pdf_operations/` and is invoked from `gui.py`.

- `main.py` only constructs the `Tk` root and starts `PDFToolApp`.
- `gui.py` (`PDFToolApp`) owns all widgets and state. The selected file path is held on the instance (`self.pdf_path`), and `self.operation_mode` (a `StringVar`) drives which sub-frame is `pack`ed via `show_operation_frame`. Each operation has its own frame that gets toggled via `pack`/`pack_forget`. The single "確定" (Execute) button at the bottom dispatches on `operation_mode` to call into `pdf_operations`.
- `pdf_operations/` is the seam for adding new features. Each module exposes one top-level function (`unlock.unlock_pdf`, `rotate.rotate_pdf`, `preview.preview_pdf`) that takes a path plus operation parameters, writes a sibling file with a suffix (e.g. `_unlocked`, `_rotated`), and reports success/failure via `tkinter.messagebox`. New operations should follow this same shape and be added by:
  1. Creating a new module under `pdf_operations/`.
  2. Importing it from `gui.py` (alongside `unlock`, `rotate`, `preview`).
  3. Adding a Radiobutton + parameter frame in `create_widgets`, wiring it through `show_operation_frame`, and adding a branch in `execute_operation`.
- `pdf_operations/preview.py` is special: for any operation that mutates pages, it re-runs the mutation in-memory into a `BytesIO`, then hands the bytes to `pdf2image.convert_from_bytes` so the preview reflects the post-operation state. Operations that need preview support must mirror their write-path logic here.

## Poppler dependency

`pdf2image` requires Poppler at runtime. The path is hardcoded as `poppler_dir = r"YOUR_PATH"` in `gui.py` (around line 93) and must be edited locally. A bundled Windows build lives in `Release-24.08.0-0/`. If `pdf2image` cannot be imported, `preview.py` sets `convert_from_path`/`convert_from_bytes` to `None` and `gui.py` skips creating the preview button — keep this guard intact when editing preview-related code.

## Conventions

- All user-facing messages and labels are in Japanese; match the existing tone and emoji prefixes (📄, 🔓, 🔄, ✅, ❌, ⚠️) when adding UI strings.
- Output files are always written next to the input with a descriptive suffix; do not prompt the user for a save location.
