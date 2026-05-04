"""
scripts/export-ik-pages.py

Render tiap halaman sheet IK Excel (dibatasi horizontal page break) sebagai PNG
→ upload ke Cloudflare R2 → update kolom steps di Neon ik_data.

Cara jalankan (dari folder sagyoukansatsu/):
  python scripts/export-ik-pages.py                          ← semua
  python scripts/export-ik-pages.py --line FB                ← hanya FB
  python scripts/export-ik-pages.py --line FB --variant "1. D-LOW RH LHD (71073-BZS60)"
  python scripts/export-ik-pages.py --force                  ← overwrite yg sudah ada

Kebutuhan:
  pip install pywin32 boto3 psycopg2-binary python-dotenv openpyxl
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
                 ('openpyxl','openpyxl'),('PIL','Pillow')]:
    try: __import__(mod)
    except ImportError: missing.append(pkg)
if missing:
    print('ERROR: install dulu:')
    for m in missing: print(f'  pip install {m}')
    sys.exit(1)

from dotenv import load_dotenv
import boto3, psycopg2, openpyxl, win32com.client, win32clipboard, win32con
import struct, io
from PIL import Image

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
    """Ambil CF_DIB dari clipboard, konversi ke PNG. Return True jika berhasil."""
    try:
        win32clipboard.OpenClipboard()
        try:
            dib = win32clipboard.GetClipboardData(win32con.CF_DIB)
        finally:
            win32clipboard.CloseClipboard()
        # Prepend BITMAPFILEHEADER untuk buat BMP valid
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
        print(f'    [clipboard_dib_to_png] {e}')
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

# ── Get page break rows via openpyxl (baca dari XML) ──────────
def get_row_breaks_openpyxl(xlsx_path, sheet_name):
    """Return sorted list of page break row indices dari openpyxl."""
    try:
        wb = openpyxl.load_workbook(str(xlsx_path), data_only=True)
        ws = wb[sheet_name]
        breaks = sorted(b.id for b in ws.row_breaks.brk)
        wb.close()
        return breaks
    except Exception:
        return []

# ── Export halaman via Excel COM ──────────────────────────────
def export_sheet_pages(excel_app, wb_com, sheet_name, row_breaks_hints, out_dir):
    """
    Gunakan row_breaks_hints (dari openpyxl) sebagai batas halaman.
    Jika kosong, coba baca dari HPageBreaks COM; jika masih kosong → 1 halaman.
    Export setiap halaman ke PNG. Return list path PNG.
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
        return []

    ws.Activate()
    used   = ws.UsedRange
    r_min  = used.Row
    r_max  = r_min + used.Rows.Count - 1
    c_max  = used.Column + used.Columns.Count - 1

    # Kumpulkan batas baris: pakai openpyxl dulu, lalu fallback ke COM
    breaks = list(row_breaks_hints)
    if not breaks:
        try:
            excel_app.ActiveWindow.View = 2  # xlPageBreakPreview → trigger auto breaks
            time.sleep(0.3)
            for pb in ws.HPageBreaks:
                try:
                    r = pb.Location.Row
                    if r_min < r <= r_max:
                        breaks.append(r)
                except Exception:
                    pass
            excel_app.ActiveWindow.View = 1  # xlNormalView
        except Exception:
            pass

    # Buat daftar (r_start, r_end) per halaman
    row_bounds = [r_min]
    for b in sorted(set(breaks)):
        if r_min < b <= r_max:
            row_bounds.append(b)  # baris pertama halaman baru (setelah break)
    row_bounds.append(r_max + 1)  # sentinel

    pages = []
    for idx, (r_start, r_next) in enumerate(zip(row_bounds, row_bounds[1:]), 1):
        r_end = r_next - 1
        if r_end < r_start:
            continue
        out_path = str(out_dir / f'page_{idx}.png')
        try:
            rng = ws.Range(ws.Cells(r_start, 1), ws.Cells(r_end, c_max))
            # Coba CopyPicture; fallback bertingkat untuk merged cell
            for copy_fn in [
                lambda: rng.CopyPicture(Appearance=1, Format=2),
                lambda: (rng.Select(), excel_app.Selection.CopyPicture(Appearance=1, Format=2)),
                lambda: ws.UsedRange.CopyPicture(Appearance=1, Format=2),
            ]:
                try:
                    copy_fn()
                    break
                except Exception:
                    continue
            time.sleep(0.25)

            # Coba export via Chart; fallback via clipboard+PIL
            saved = False
            try:
                chart = wb_com.Charts.Add(After=wb_com.Sheets(wb_com.Sheets.Count))
                chart.Paste()
                chart.Export(out_path)
                chart.Delete()
                saved = Path(out_path).exists() and Path(out_path).stat().st_size > 0
            except Exception:
                pass
            if not saved:
                saved = clipboard_dib_to_png(out_path)

            if saved:
                pages.append(out_path)
                print(f'    Halaman {idx}: baris {r_start}-{r_end} [OK]')
            else:
                print(f'    Halaman {idx}: file kosong, skip')
        except Exception as e:
            print(f'    Halaman {idx}: ERROR - {str(e)[:80]}')
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
    # key: (line_type, variant) → list of (sheet, steps_data)
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

            # Buka workbook sekali untuk semua sheet-nya
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

                    # Baca page breaks dari openpyxl (XML)
                    hints = get_row_breaks_openpyxl(xlsx_path, sheet)

                    try:
                        pages = export_sheet_pages(excel, wb_com, sheet, hints, tmp_dir)
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
