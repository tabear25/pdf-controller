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
   - Poppler自体はこのリポジトリに2025年2月16日に入れていますが、最新版は[こちら](https://github.com/oschwartz10612/poppler-windows?tab=readme-ov-file)でもダウンロードできます。

2. **PATHをコードに適応する**
   - gui.pyの以下の部分に1で通したPATHを指示してください
   ```
   poppler_dir = r"YOUR_PATH"
   ```
