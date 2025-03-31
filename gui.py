import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from pdf_operations import unlock, rotate, preview

class PDFToolApp:
    def __init__(self, master):
        self.master = master
        master.title("PDFコントローラー")
        master.geometry("600x450")
        
        self.pdf_path = None
        self.operation_mode = tk.StringVar(value="unlock")
        
        self.create_widgets()
    
    def create_widgets(self):
        # ファイル選択のボタン
        file_frame = ttk.LabelFrame(self.master, text="📁 ファイルを選択")
        file_frame.pack(padx=10, pady=10, fill="x")
        
        self.file_label = ttk.Label(file_frame, text="📄 ファイル未選択")
        self.file_label.pack(side="left", padx=5, pady=5, expand=True, fill="x")
        
        select_button = ttk.Button(file_frame, text="🔍 ファイルを選択", command=self.select_file)
        select_button.pack(side="right", padx=5, pady=5)
        
        # 操作選択のボタン
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
        
        # パスワード解除ボタン
        self.unlock_frame = ttk.Frame(self.master)
        self.unlock_frame.pack(padx=10, pady=5, fill="x")
        ttk.Label(self.unlock_frame, text="🔑 PDFパスワード:").pack(side="left", padx=5)
        self.password_entry = ttk.Entry(self.unlock_frame, show="*")
        self.password_entry.pack(side="left", padx=5, fill="x", expand=True)
        
        # PDF回転ボタン
        self.rotate_frame = ttk.Frame(self.master)
        self.rotate_frame.pack_forget()
        
        ttk.Label(self.rotate_frame, text="↪️ 回転方向:").grid(row=0, column=0, padx=5, pady=5, sticky="w")
        self.direction = tk.StringVar(value="right")
        ttk.Radiobutton(self.rotate_frame, text="➡️ 右回転", variable=self.direction, value="right").grid(row=0, column=1, padx=5, pady=5)
        ttk.Radiobutton(self.rotate_frame, text="⬅️ 左回転", variable=self.direction, value="left").grid(row=0, column=2, padx=5, pady=5)
        
        ttk.Label(self.rotate_frame, text="🔢 回転回数 (90度単位):").grid(row=1, column=0, padx=5, pady=5, sticky="w")
        self.rotation_count = tk.IntVar(value=1)
        spin = ttk.Spinbox(self.rotate_frame, from_=1, to=10, textvariable=self.rotation_count, width=5)
        spin.grid(row=1, column=1, padx=5, pady=5, sticky="w")
        
        if preview.convert_from_path is not None:
            preview_button = ttk.Button(self.rotate_frame, text="👁️ 回転後のプレビュー表示", command=self.show_preview)
            preview_button.grid(row=2, column=0, padx=5, pady=5, sticky="w")
        
        execute_button = ttk.Button(self.master, text="✅ 確定", command=self.execute_operation)
        execute_button.pack(pady=20)
    
    def select_file(self):
        filetypes = [("PDF Files", "*.pdf")]
        filepath = filedialog.askopenfilename(title="PDFファイルを選択", filetypes=filetypes)
        if filepath:
            self.pdf_path = filepath
            self.file_label.config(text="📄 " + os.path.basename(filepath))
    
    def show_operation_frame(self):
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
        
        poppler_dir = r"YOUR_PATH"
        if self.operation_mode.get() == "rotate":
            images = preview.preview_pdf(
                self.pdf_path, mode="rotate", 
                rotation_direction=self.direction.get(), 
                rotation_count=self.rotation_count.get(), 
                poppler_path=poppler_dir)
        else:
            images = preview.preview_pdf(
                self.pdf_path, mode="unlock", 
                poppler_path=poppler_dir)
        if images:
            preview_window = tk.Toplevel(self.master)
            preview_window.title("👁️ プレビュー (回転後の場合は反映済み)")
            from PIL import ImageTk
            img = images[0]
            img.thumbnail((400, 400))
            photo = ImageTk.PhotoImage(img)
            label = ttk.Label(preview_window, image=photo)
            label.image = photo
            label.pack(padx=10, pady=10)
    
    def execute_operation(self):
        if not self.pdf_path:
            messagebox.showwarning("⚠️ 警告", "PDFファイルを選択してください。")
            return
        
        mode = self.operation_mode.get()
        if mode == "unlock":
            unlock.unlock_pdf(self.pdf_path, self.password_entry.get())
        elif mode == "rotate":
            rotate.rotate_pdf(self.pdf_path, self.direction.get(), self.rotation_count.get())

if __name__ == "__main__":
    root = tk.Tk()
    app = PDFToolApp(root)
    root.mainloop()