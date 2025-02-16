import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PyPDF2 import PdfReader, PdfWriter
try:
    from pdf2image import convert_from_path
except ImportError:
    convert_from_path = None

class PDFToolApp:
    def __init__(self, master):
        self.master = master
        master.title("📄 PDFコントローラー")
        master.geometry("600x450")
        
        self.pdf_path = None
        
        self.operation_mode = tk.StringVar(value="unlock")
        
        self.create_widgets()
    
    def create_widgets(self):
        file_frame = ttk.LabelFrame(self.master, text="📁 PDFファイル選択")
        file_frame.pack(padx=10, pady=10, fill="x")
        
        self.file_label = ttk.Label(file_frame, text="📄 ファイル未選択")
        self.file_label.pack(side="left", padx=5, pady=5, expand=True, fill="x")
        
        select_button = ttk.Button(file_frame, text="🔍 ファイルを選択", command=self.select_file)
        select_button.pack(side="right", padx=5, pady=5)
        
        op_frame = ttk.LabelFrame(self.master, text="🔧 操作選択")
        op_frame.pack(padx=10, pady=10, fill="x")
        
        unlock_radio = ttk.Radiobutton(
            op_frame, text="🔓 パスワード解除", 
            variable=self.operation_mode, value="unlock", 
            command=self.show_operation_frame)
        unlock_radio.grid(row=0, column=0, padx=10, pady=5, sticky="w")
        
        rotate_radio = ttk.Radiobutton(
            op_frame, text="🔄 PDF回転", 
            variable=self.operation_mode, value="rotate", 
            command=self.show_operation_frame)
        rotate_radio.grid(row=0, column=1, padx=10, pady=5, sticky="w")
        
        # パスワード解除フレーム
        self.unlock_frame = ttk.Frame(self.master)
        self.unlock_frame.pack(padx=10, pady=5, fill="x")
        ttk.Label(self.unlock_frame, text="🔑 PDFパスワード:").pack(side="left", padx=5)
        self.password_entry = ttk.Entry(self.unlock_frame, show="*")
        self.password_entry.pack(side="left", padx=5, fill="x", expand=True)
        
        # PDF回転フレーム
        self.rotate_frame = ttk.Frame(self.master)
        # 初期状態は非表示
        self.rotate_frame.pack_forget()
        
        # 回転方向の選択
        ttk.Label(self.rotate_frame, text="↪️ 回転方向:").grid(row=0, column=0, padx=5, pady=5, sticky="w")
        self.direction = tk.StringVar(value="right")
        ttk.Radiobutton(self.rotate_frame, text="➡️ 右回転", variable=self.direction, value="right").grid(row=0, column=1, padx=5, pady=5)
        ttk.Radiobutton(self.rotate_frame, text="⬅️ 左回転", variable=self.direction, value="left").grid(row=0, column=2, padx=5, pady=5)
        
        # 回転回数の選択（90度単位）
        ttk.Label(self.rotate_frame, text="🔢 回転回数 (90度単位):").grid(row=1, column=0, padx=5, pady=5, sticky="w")
        self.rotation_count = tk.IntVar(value=1)
        spin = ttk.Spinbox(self.rotate_frame, from_=1, to=10, textvariable=self.rotation_count, width=5)
        spin.grid(row=1, column=1, padx=5, pady=5, sticky="w")
        
        # プレビュー（pdf2imageが利用可能な場合のみ）
        if convert_from_path is not None:
            preview_button = ttk.Button(self.rotate_frame, text="👁️ プレビュー表示", command=self.show_preview)
            preview_button.grid(row=2, column=0, padx=5, pady=5, sticky="w")
        
        # 実行ボタン
        execute_button = ttk.Button(self.master, text="✅ 確定", command=self.execute_operation)
        execute_button.pack(pady=20)
        
    def select_file(self):
        # ファイルエクスプローラーでPDFファイル選択
        filetypes = [("PDF Files", "*.pdf")]
        filepath = filedialog.askopenfilename(title="PDFファイルを選択", filetypes=filetypes)
        if filepath:
            self.pdf_path = filepath
            self.file_label.config(text="📄 " + os.path.basename(filepath))
    
    def show_operation_frame(self):
        # 選択された操作に応じて表示するフレームを切り替え
        mode = self.operation_mode.get()
        if mode == "unlock":
            self.rotate_frame.pack_forget()
            self.unlock_frame.pack(padx=10, pady=5, fill="x")
        elif mode == "rotate":
            self.unlock_frame.pack_forget()
            self.rotate_frame.pack(padx=10, pady=5, fill="x")
    
    def show_preview(self):
        if not self.pdf_path:
            messagebox.showwarning("⚠️ 警告", "先にPDFファイルを選択してください。")
            return
        if convert_from_path is None:
            messagebox.showinfo("情報", "pdf2imageライブラリがインストールされていません。")
            return
        
        try:
            poppler_dir = r"C:\Users\str06\private_workplace\pdf-controller\Release-24.08.0-0\poppler-24.08.0\Library\bin"
            images = convert_from_path(
                self.pdf_path, 
                first_page=1, 
                last_page=1, 
                poppler_path=poppler_dir
            )
            preview_window = tk.Toplevel(self.master)
            preview_window.title("👁️ プレビュー(回転前の状態を表示)")

            from PIL import ImageTk
            img = images[0]
            img.thumbnail((400, 400))
            photo = ImageTk.PhotoImage(img)
            label = ttk.Label(preview_window, image=photo)
            label.image = photo
            label.pack(padx=10, pady=10)
        except Exception as e:
            messagebox.showerror("❌ エラー", f"プレビューの表示に失敗しました: {e}")
            
    def execute_operation(self):
        if not self.pdf_path:
            messagebox.showwarning("⚠️ 警告", "PDFファイルを選択してください。")
            return
        
        mode = self.operation_mode.get()
        if mode == "unlock":
            self.unlock_pdf()
        elif mode == "rotate":
            self.rotate_pdf()
    
    def unlock_pdf(self):
        try:
            from Crypto.Cipher import AES
        except ImportError:
            messagebox.showerror("❌ エラー", "AESアルゴリズムのためにPyCryptodomeが必要です。pip install pycryptodome でインストールしてください。")
            return
        
        password = self.password_entry.get()
        if not password:
            messagebox.showwarning("⚠️ 警告", "パスワードを入力してください。")
            return
        
        ###パスワード解除
        try:
            reader = PdfReader(self.pdf_path)
            if reader.is_encrypted:
                if not reader.decrypt(password):
                    messagebox.showerror("❌ エラー", "パスワードが正しくありません。")
                    return
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            
            base, ext = os.path.splitext(self.pdf_path)
            output_path = base + "_unlocked" + ext
            with open(output_path, "wb") as f_out:
                writer.write(f_out)
            messagebox.showinfo("✅ 完了", f"パスワード解除済みPDFを保存しました:\n{output_path}")
        except Exception as e:
            messagebox.showerror("❌ エラー", f"PDFのパスワード解除に失敗しました: {e}")
    
    def rotate_pdf(self):
        direction = self.direction.get()
        count = self.rotation_count.get()
        try:
            reader = PdfReader(self.pdf_path)
            writer = PdfWriter()
            for page in reader.pages:
                rotation_angle = 90 * count
                if direction == "right":
                    page.rotate(90 * count)
                else:
                    page.rotate(-90 * count)
                writer.add_page(page)
            
            # 出力先ファイル名（元ファイルと同じフォルダに _rotated 付きで保存）
            base, ext = os.path.splitext(self.pdf_path)
            output_path = base + "_rotated" + ext
            with open(output_path, "wb") as f_out:
                writer.write(f_out)
            messagebox.showinfo("✅ 完了", f"回転済みPDFを保存しました:\n{output_path}")
        except Exception as e:
            messagebox.showerror("❌ エラー", f"PDFの回転に失敗しました: {e}")

if __name__ == "__main__":
    root = tk.Tk()
    app = PDFToolApp(root)
    root.mainloop()