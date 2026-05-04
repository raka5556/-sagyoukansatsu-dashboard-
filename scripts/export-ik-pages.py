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
                 ('openpyxl','openpyxl'),('fitz','pymupdf'),('PIL','Pillow')]:
    try: __import__(mod)
    except ImportError: missing.append(pkg)
if missing:
    print('ERROR: install dulu:')
    for m in missing: print(f'  pip install {m}')
    sys.exit(1)

from dotenv import load_dotenv
import boto3, psycopg2, openpyxl, win32com.client
import win32clipboard, win32con, struct, io
from PIL import Image
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

def clipboard_dib_to_png(out_path: str) -> bool:
    """Baca CF_DIB dari clipboard, simpan sebagai PNG. Return True jika berhasil."""
    try:
        win32clipboard.OpenClipboard()
        try:
            dib = win32clipboard.GetClipboardData(win32con.CF_DIB)
        finally:
            win32clipboard.CloseClipboard()
        info_size = struct.unpack_from('<L', dib, 0)[0]
        clr_used  = struct.unpack_from('<L', dib, 32)[0]
        bit_count = struct.unpack_from('<H', dib, 14)[0]
        clr_table = (clr_used if clr_used else (256 if bit_count <= 8 else 0)) * 4
        pixel_off = 14 + info_size + clr_table
        bmp_data  = (b'BM' + struct.pack('<L', 14 + len(dib)) +
                     b'\x00\x00\x00\x00' + struct.pack('<L', pixel_off) + dib)
        img = Image.open(io.BytesIO(bmp_data))
        img.save(out_path, 'PNG')
        return True
    except Exception as e:
        print(f'    [clipboard] {e}')
        return False

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
        print(f'    PDF export gagal → fallback clipboard ({str(e)[:60]})')
        return _export_clipboard_fallback(ws, excel_app, out_dir)

    if not Path(pdf_path).exists() or Path(pdf_path).stat().st_size == 0:
        print(f'    PDF kosong → fallback clipboard')
        return _export_clipboard_fallback(ws, excel_app, out_dir)

    return _pdf_to_pages(pdf_path, out_dir)


def _export_clipboard_fallback(ws, excel_app, out_dir):
    """Fallback: CopyPicture seluruh UsedRange → clipboard → PNG."""
    out_path = str(out_dir / 'page_1.png')
    try:
        for copy_fn in [
            lambda: ws.UsedRange.CopyPicture(Appearance=1, Format=2),
            lambda: (ws.UsedRange.Select(),
                     excel_app.Selection.CopyPicture(Appearance=1, Format=2)),
        ]:
            try: copy_fn(); break
            except Exception: continue
        time.sleep(0.3)
        if clipboard_dib_to_png(out_path):
            print(f'    Halaman 1/1 [clipboard fallback OK]')
            return [out_path]
    except Exception as e:
        print(f'    [fallback] {str(e)[:80]}')
    return []


def _pdf_to_pages(pdf_path, out_dir):
    """Konversi semua halaman PDF ke PNG. Return list path PNG."""
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
    xls = {}  # mutable holder agar bisa di-replace dari dalam loop

    def start_excel():
        try:
            if xls.get('app'):
                xls['app'].Quit()
        except Exception:
            pass
        app = win32com.client.Dispatch("Excel.Application")
        app.Visible        = False
        app.DisplayAlerts  = False
        app.ScreenUpdating = False
        xls['app'] = app
        print('  [Excel] Started.')

    print('Membuka Microsoft Excel...')
    start_excel()

    tmp_dir = Path(tempfile.gettempdir()) / 'ik_pages'
    tmp_dir.mkdir(exist_ok=True)

    ok_total = skip_total = err_total = 0
    file_num = 0

    # Simpan koneksi di dict agar bisa di-replace dari dalam loop
    db = {'conn': conn, 'cur': cur}

    def db_reconnect():
        try: db['conn'].close()
        except: pass
        db['conn'] = psycopg2.connect(DATABASE_URL, sslmode='require')
        db['conn'].autocommit = False
        db['cur'] = db['conn'].cursor()
        print('  [DB] Reconnected.')

    def db_update(new_steps, line_type, variant, sheet):
        for attempt in range(3):
            try:
                db['cur'].execute(
                    "UPDATE ik_data SET steps=%s WHERE line_type=%s AND variant=%s AND sheet=%s",
                    (json.dumps(new_steps), line_type, variant, sheet),
                )
                db['conn'].commit()
                return True
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                print(f'    DB reconnect (attempt {attempt+1})...')
                db_reconnect()
            except Exception as e:
                try: db['conn'].rollback()
                except: pass
                print(f'    DB ERROR: {e}')
                return False
        return False

    try:
        for (line_type, variant), sheet_list in sorted(by_file.items()):
            # Cek koneksi DB, reconnect jika perlu
            try:
                db['cur'].execute("SELECT 1")
            except Exception:
                db_reconnect()

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

            # Buka workbook dengan retry jika Excel crash
            wb_com = None
            for open_attempt in range(2):
                try:
                    wb_com = xls['app'].Workbooks.Open(
                        str(xlsx_path.resolve()),
                        ReadOnly=True, UpdateLinks=False,
                        IgnoreReadOnlyRecommended=True,
                    )
                    break
                except Exception as e:
                    print(f'  [ERR] Gagal buka (attempt {open_attempt+1}): {str(e)[:60]}')
                    if open_attempt == 0:
                        start_excel()
                    else:
                        wb_com = None

            if wb_com is None:
                err_total += len(sheet_list); continue

            try:
                for sheet, _ in sheet_list:
                    print(f'  Sheet: {sheet}')

                    for f in tmp_dir.iterdir():
                        try: f.unlink()
                        except: pass

                    # Export dengan retry jika Excel COM disconnect
                    pages = []
                    for exp_attempt in range(2):
                        try:
                            pages = export_sheet_pages(xls['app'], wb_com, sheet, tmp_dir)
                            break
                        except Exception as e:
                            err_msg = str(e)
                            print(f'    [ERR] Export (attempt {exp_attempt+1}): {err_msg[:80]}')
                            if exp_attempt == 0 and ('disconnected' in err_msg or 'NoneType' in err_msg):
                                # Restart Excel dan buka ulang workbook
                                print('    [Excel] Restarting...')
                                start_excel()
                                try:
                                    wb_com = xls['app'].Workbooks.Open(
                                        str(xlsx_path.resolve()),
                                        ReadOnly=True, UpdateLinks=False,
                                        IgnoreReadOnlyRecommended=True,
                                    )
                                except Exception as e2:
                                    print(f'    [ERR] Gagal reopen: {e2}')
                                    break
                            else:
                                break

                    if not pages:
                        print(f'    Tidak ada halaman, skip')
                        skip_total += 1; continue

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
                        if db_update(new_steps, line_type, variant, sheet):
                            ok_total += 1
                            print(f'    DB: {len(new_steps)} halaman disimpan')
                        else:
                            err_total += 1
                    else:
                        err_total += 1

            finally:
                try: wb_com.Close(False)
                except: pass

    finally:
        try: xls['app'].Quit()
        except: pass
        try: db['cur'].close()
        except: pass
        try: db['conn'].close()
        except: pass

    print(f'\n{"="*50}')
    print(f'  Berhasil : {ok_total} sheet')
    print(f'  Skip     : {skip_total} sheet')
    print(f'  Error    : {err_total} sheet')
    print(f'{"="*50}')


if __name__ == '__main__':
    main()
