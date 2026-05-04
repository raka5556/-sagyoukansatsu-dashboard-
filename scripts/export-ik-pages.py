"""
scripts/export-ik-pages.py

Render tiap halaman sheet IK Excel (dibatasi page break) sebagai PNG
→ upload ke Cloudflare R2 → update kolom steps di Neon ik_data.

Cara jalankan (dari folder sagyoukansatsu/ atau C:\\Users\\rakaa):
  python sagyoukansatsu\\scripts\\export-ik-pages.py                          ← semua
  python sagyoukansatsu\\scripts\\export-ik-pages.py --line FB                ← hanya FB
  python sagyoukansatsu\\scripts\\export-ik-pages.py --line FB --variant "1. D-LOW RH LHD (71073-BZS60)"
  python sagyoukansatsu\\scripts\\export-ik-pages.py --force                  ← overwrite yg sudah ada

Kebutuhan:
  pip install pywin32 boto3 psycopg2-binary python-dotenv openpyxl pymupdf
"""

import os, sys, json, time, argparse, tempfile
from pathlib import Path
from collections import defaultdict

# ── UTF-8 console (hindari error karakter Jepang/arrow) ───────
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ── Cek dependencies ──────────────────────────────────────────
missing = []
for mod, pkg in [('dotenv','python-dotenv'),('boto3','boto3'),
                 ('psycopg2','psycopg2-binary'),('win32com','pywin32'),
                 ('openpyxl','openpyxl'),('fitz','pymupdf')]:
    try: __import__(mod)
    except ImportError: missing.append(pkg)
if missing:
    print('ERROR: install dulu:')
    for m in missing: print(f'  pip install {m}')
    sys.exit(1)

from dotenv import load_dotenv
import boto3, psycopg2, openpyxl, win32com.client
import fitz  # PyMuPDF

# ── Load .env ─────────────────────────────────────────────────
_root = Path(__file__).resolve().parent.parent
load_dotenv(_root / '.env')

DATABASE_URL  = os.environ.get('DATABASE_URL','')
R2_ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID','')
R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY_ID','')
R2_SECRET_KEY = os.environ.get('R2_SECRET_ACCESS_KEY','')
R2_BUCKET     = os.environ.get('R2_BUCKET_NAME','sagyoukansatsu')
for v,k in [(DATABASE_URL,'DATABASE_URL'),(R2_ACCOUNT_ID,'R2_ACCOUNT_ID'),
            (R2_ACCESS_KEY,'R2_ACCESS_KEY_ID'),(R2_SECRET_KEY,'R2_SECRET_ACCESS_KEY')]:
    if not v: print(f'ERROR: {k} tidak ada di .env'); sys.exit(1)

# ── Folder IK sumber Excel ────────────────────────────────────
IK_FOLDERS = {
    'FB': Path(r'C:\Users\rakaa\1. IK FB D26A'),
    'FC': Path(r'C:\Users\rakaa\1. IK FC D26A'),
}

# ── R2 client ─────────────────────────────────────────────────
r2 = boto3.client('s3',
    endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
    aws_access_key_id=R2_ACCESS_KEY,
    aws_secret_access_key=R2_SECRET_KEY,
    region_name='auto',
)

def safe_key(s):
    return ''.join(c if c.isalnum() or c in '._-' else '_' for c in str(s))[:80]

def upload_png(key, path):
    with open(path,'rb') as f:
        r2.put_object(Bucket=R2_BUCKET, Key=key, Body=f, ContentType='image/png')

def find_excel(folder, variant):
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() != '.xlsx' or f.name.startswith('~$'):
            continue
        stem = f.stem
        for sfx in ['.Done ok Rev','.Done ok rev','.done ok rev']:
            stem = stem.replace(sfx,'').strip()
        if stem == variant:
            return f
    return None

def already_pages(steps_data):
    """Return True jika steps sudah berisi page images."""
    try:
        s = json.loads(steps_data) if isinstance(steps_data, str) else steps_data
        return bool(s) and isinstance(s, list) and '/page_' in (s[0].get('image_key','') if s else '')
    except Exception:
        return False

# ── Export sheet: PDF via Excel COM → PNG via PyMuPDF ─────────
def export_sheet_pages(excel_app, wb_com, sheet_name, out_dir):
    """
    Export sheet sebagai PDF (Excel handle pagination otomatis sesuai page break),
    lalu konversi tiap halaman PDF ke PNG menggunakan PyMuPDF.
    Return list path PNG yang berhasil dibuat.
    """
    ws = None
    for i in range(1, wb_com.Sheets.Count + 1):
        try:
            if wb_com.Sheets(i).Name == sheet_name:
                ws = wb_com.Sheets(i)
                break
        except Exception:
            continue
    if ws is None:
        print(f'    Sheet tidak ditemukan di workbook')
        return []

    ws.Activate()
    pdf_path = str(out_dir / '_sheet.pdf')

    # Hapus PDF lama
    try:
        Path(pdf_path).unlink(missing_ok=True)
    except Exception:
        pass

    # Export sheet sebagai PDF (Type=0 = xlTypePDF)
    try:
        ws.ExportAsFixedFormat(
            Type=0,
            Filename=pdf_path,
            Quality=0,               # xlQualityStandard
            IncludeDocProperties=False,
            IgnorePrintAreas=False,
            OpenAfterPublish=False,
        )
    except Exception as e:
        print(f'    PDF export gagal: {str(e)[:100]}')
        return []

    if not Path(pdf_path).exists() or Path(pdf_path).stat().st_size == 0:
        print(f'    PDF kosong, skip')
        return []

    # Konversi tiap halaman PDF ke PNG
    pages = []
    try:
        doc = fitz.open(pdf_path)
        n = len(doc)
        for page_num in range(n):
            out_path = str(out_dir / f'page_{page_num + 1}.png')
            page = doc[page_num]
            # 150 DPI bagus untuk web; naikkan ke 200 kalau gambar kurang tajam
            pix = page.get_pixmap(dpi=150)
            pix.save(out_path)
            pages.append(out_path)
            print(f'    Halaman {page_num + 1}/{n} [OK]')
        doc.close()
    except Exception as e:
        print(f'    PDF→PNG gagal: {str(e)[:100]}')

    return pages


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--line',    default='')
    parser.add_argument('--variant', default='')
    parser.add_argument('--sheet',   default='')
    parser.add_argument('--force',   action='store_true')
    args = parser.parse_args()

    # ── Ambil data dari DB ─────────────────────────────────────
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    conn.autocommit = False
    cur  = conn.cursor()

    sql, params = "SELECT line_type, variant, sheet, steps FROM ik_data", []
    conds = []
    if args.line:    conds.append("line_type=%s"); params.append(args.line)
    if args.variant: conds.append("variant=%s");   params.append(args.variant)
    if args.sheet:   conds.append("sheet=%s");     params.append(args.sheet)
    if conds: sql += " WHERE " + " AND ".join(conds)
    sql += " ORDER BY line_type, variant, sheet"

    cur.execute(sql, params)
    rows = cur.fetchall()
    print(f'Records di DB : {len(rows)}')

    if not rows:
        print('Tidak ada data. Pastikan import-ik.js sudah dijalankan.')
        conn.close()
        return

    # ── Kelompokkan per file Excel ─────────────────────────────
    by_file = defaultdict(list)
    for line_type, variant, sheet, steps in rows:
        if not args.force and already_pages(steps):
            print(f'[SKIP] {line_type}/{variant}/{sheet} (sudah ada page images)')
            continue
        by_file[(line_type, variant)].append((sheet, steps))

    if not by_file:
        print('Semua record sudah ada page images. Pakai --force untuk overwrite.')
        conn.close()
        return

    total_files  = len(by_file)
    total_sheets = sum(len(v) for v in by_file.values())
    print(f'Akan diproses : {total_files} file, {total_sheets} sheet')

    # ── Init Excel COM ─────────────────────────────────────────
    print('Membuka Microsoft Excel...')
    excel = win32com.client.Dispatch("Excel.Application")
    excel.Visible        = False
    excel.DisplayAlerts  = False
    excel.ScreenUpdating = False

    tmp_dir = Path(tempfile.gettempdir()) / 'ik_pages'
    tmp_dir.mkdir(exist_ok=True)

    ok_total = skip_total = err_total = 0
    file_num = 0

    try:
        for (line_type, variant), sheet_list in sorted(by_file.items()):
            folder = IK_FOLDERS.get(line_type)
            if not folder or not folder.exists():
                print(f'[SKIP] Folder {line_type} tidak ditemukan')
                skip_total += len(sheet_list); continue

            xlsx_path = find_excel(folder, variant)
            if not xlsx_path:
                print(f'[SKIP] File tidak ditemukan: {variant}')
                skip_total += len(sheet_list); continue

            file_num += 1
            print(f'\n[{file_num}/{total_files}] [{line_type}] {variant}')
            print(f'  File: {xlsx_path.name}  ({len(sheet_list)} sheet)')

            wb_com = None
            try:
                wb_com = excel.Workbooks.Open(
                    str(xlsx_path.resolve()),
                    ReadOnly=True, UpdateLinks=False,
                    IgnoreReadOnlyRecommended=True,
                )
            except Exception as e:
                print(f'  [ERR] Gagal buka file: {e}')
                err_total += len(sheet_list); continue

            try:
                for sheet, _ in sheet_list:
                    print(f'  Sheet: {sheet}')

                    # Bersihkan tmp dir
                    for f in tmp_dir.iterdir():
                        try: f.unlink()
                        except: pass

                    try:
                        pages = export_sheet_pages(excel, wb_com, sheet, tmp_dir)
                    except Exception as e:
                        print(f'    [ERR] Export: {str(e)[:100]}')
                        err_total += 1; continue

                    if not pages:
                        print(f'    Tidak ada halaman, skip')
                        skip_total += 1; continue

                    # Upload ke R2
                    v_safe, s_safe = safe_key(variant), safe_key(sheet)
                    new_steps = []
                    for i, pg in enumerate(pages, 1):
                        r2_key = f'ik/{line_type}/{v_safe}/{s_safe}/page_{i}.png'
                        try:
                            upload_png(r2_key, pg)
                            new_steps.append({'no':i,'text':f'Halaman {i}','image_key':r2_key})
                            print(f'    Upload {i}/{len(pages)} OK')
                        except Exception as e:
                            print(f'    Upload {i} GAGAL: {e}')

                    if new_steps:
                        try:
                            cur.execute(
                                "UPDATE ik_data SET steps=%s WHERE line_type=%s AND variant=%s AND sheet=%s",
                                (json.dumps(new_steps), line_type, variant, sheet),
                            )
                            conn.commit()
                            ok_total += 1
                            print(f'    DB: {len(new_steps)} halaman disimpan')
                        except Exception as e:
                            conn.rollback()
                            print(f'    DB ERROR: {e}')
                            err_total += 1
                    else:
                        err_total += 1

            finally:
                try: wb_com.Close(False)
                except: pass

    finally:
        try: excel.Quit()
        except: pass
        cur.close()
        conn.close()

    print(f'\n{"="*50}')
    print(f'  Berhasil : {ok_total} sheet')
    print(f'  Skip     : {skip_total} sheet')
    print(f'  Error    : {err_total} sheet')
    print(f'{"="*50}')


if __name__ == '__main__':
    main()
