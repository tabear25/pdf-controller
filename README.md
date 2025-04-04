# これは何（What's this?）
PDFファイルに対して以下の操作を行うことができます。
- パスワードで保護されているPDFのパスワードを削除し、解除された状態のPDFファイルを保存する
- PDFに対して回転操作を行い、任意の角度回転させたPDFファイルを保存する

## 必要なライブラリ（Required Libraries）
- `requirements.txt`にまとめてあるので全てインストールしてください

# 使い方（How to Use）
### 1. 準備（Preparation）
1. **PopplerのPATHを通す**
   - [こちら](https://atmarkit.itmedia.co.jp/ait/articles/1805/11/news035.html)を参考にPATHの設定を行ってください。
   - パスを通すのは`bin`です
   - Poppler自体はこのリポジトリに2025年2月16日に入れていますが、最新版は[こちら](https://github.com/oschwartz10612/poppler-windows?tab=readme-ov-file)でもダウンロードできます。

2. **PATHをコードに適応する（Set the PATH）**
   - gui.pyの以下の`YOUR_PATH`に1で通したPATHを指示してください（93行目）
   ```
   poppler_dir = r"YOUR_PATH"
   ```

### **3. アプリケーションの起動（Launch the Application）**
1. ターミナルまたはコマンドプロンプトを開く
2. プロジェクトのルートディレクトリ（`main.py`があるディレクトリ）に移動する
3. 以下のコマンドを実行してアプリケーションを起動する：
   ```bash
   python main.py
   ```
4. アプリケーションのウィンドウが表示され、パスワード解除・回転操作が行えるようになります。

### **4. 機能の説明（Features Details）**
- **パスワード解除**
  - 「🔓 パスワード解除」モードを選択し、解除したいPDFファイルを選択します。
  - PDFが暗号化されている場合、パスワードを入力し、確定ボタンを押すと、パスワードが解除されたPDFファイルが元のファイルと同じフォルダに保存されます（ファイル名に `_unlocked` が付加されます）。

- **PDF回転**
  - 「🔄 PDF回転」モードを選択し、PDFファイルを選択します。
  - 回転方向（右回転または左回転）と回転回数（90度単位）を指定します。
  - プレビュー表示ボタンを押すと、回転後のPDFの先頭ページの画像がプレビューされます。
  - 確定ボタンを押すと、回転処理が実行され、回転済みのPDFファイルが元のファイルと同じフォルダに保存されます（ファイル名に `_rotated` が付加されます）。

### **5. モジュール構成（Module Structure）**
本プロジェクトは以下のようにモジュール化されています。

```
pdf_controller/
├── main.py         # アプリケーションのエントリーポイント
├── gui.py          # GUI全体の構築と操作の実装
└── pdf_operations  # PDF処理関連のモジュール
    ├── __init__.py
    ├── unlock.py   # パスワード解除の機能
    ├── rotate.py   # PDF回転の機能
    └── preview.py  # プレビュー生成の機能（回転後のプレビュー対応）
```

- **main.py**  
  エントリーポイントとしてGUIを起動します。

- **gui.py**  
  ユーザーインターフェースを定義し、各操作（パスワード解除、PDF回転、プレビュー表示）の際に適切なモジュール関数を呼び出します。

- **pdf_operations/unlock.py**  
  PDFファイルのパスワード解除処理を実装しています。

- **pdf_operations/rotate.py**  
  PDFファイルの回転処理を実装しています。

- **pdf_operations/preview.py**  
  プレビュー表示用の処理を実装しており、回転後のPDFのプレビューもサポートしています。

### **6. カスタマイズ（Customization）**
- **Popplerのパス設定**
  - `gui.py`内で、Popplerのパスを指定している箇所（例：`poppler_dir = r"YOUR_PATH"`）を実際にインストールしたPopplerのパスに変更してください。

- **GUIのレイアウト変更**
  - `gui.py`内のウィジェット配置を変更することで、UIのレイアウトやデザインを自由にカスタマイズできます。

- **追加機能の実装**
  - 各機能がモジュール化されているため、新たなPDF操作（例：圧縮、テキスト抽出など）を実装する場合は、`pdf_operations`内に新しいモジュールを追加し、`gui.py`から呼び出す形式で拡張可能です。

### **7. トラブルシューティング（Troubleshooting）**
- **Popplerに関する問題**
  - PATHの設定や、`poppler_dir`のパス指定を再度確認してください。
  - コマンドプロンプトで `pdftoppm -h` を実行して、Popplerが正しくインストールされていることを確認してください。

- **依存ライブラリのエラー**
  - `pip install -r requirements.txt` で全ての依存ライブラリが正しくインストールされているか確認してください。
