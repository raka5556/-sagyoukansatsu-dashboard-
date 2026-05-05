"""
import-ik-d37d.py
Import IK D37D: Excel sheet -> PDF -> PNG -> R2 + Neon DB
Format sama dengan D26A: 1 step per sheet, image_key = full-page PNG
"""

import os, sys, re, json, tempfile, time
import fitz  # pymupdf
import boto3
import psycopg2
from dotenv import dotenv_values
import win32com.client
import pythoncom

# ── Config ──────────────────────────────────────────────────
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '.env')
env = dotenv_values(ENV_PATH)

DATABASE_URL = env.get('DATABASE_URL', '')
R2_ACCESS_KEY_ID = env.get('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = env.get('R2_SECRET_ACCESS_KEY', '')
R2_ACCOUNT_ID = env.get('R2_ACCOUNT_ID', '')
R2_BUCKET_NAME = env.get('R2_BUCKET_NAME', 'sagyoukansatsu')
R2_PUBLIC_URL = (env.get('R2_PUBLIC_URL', '')).rstrip('/')

IK_FOLDERS = [
    {'lineType': 'FB', 'model': 'D37D', 'folder': r'C:\Users\rakaa\IK FB D37D'},
    {'lineType': 'FC', 'model': 'D37D', 'folder': r'C:\Users\rakaa\IK FC D37D'},
]

# PDF render scale: 2.0 = ~144dpi, result ~1600px wide — good quality
PDF_SCALE = 2.5

# Regex untuk skip sheet yang nama nya hanya angka (cover/halaman TOC)
RE_NUMERIC_SHEET = re.compile(r'^[0-9]+(\s*\([0-9]+\))?\s*$')

def safe_key(s):
    """Ganti karakter non-safe untuk R2 key"""
    return re.sub(r'[^a-zA-Z0-9._-]', '_', s.strip())[:80]

def get_r2():
    return boto3.client(
        's3',
        region_name='auto',
        endpoint_url=f'https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    )

def upload_to_r2(r2, key, png_bytes):
    r2.put_object(
        Bucket=R2_BUCKET_NAME,
        Key=key,
        Body=png_bytes,
        ContentType='image/png',
    )

def get_db():
    # Ganti sslmode=require ke sslmode=verify-full sesuai pg-pool
    conn_str = DATABASE_URL.replace('sslmode=require', 'sslmode=require')
    return psycopg2.connect(conn_str, sslmode='require')

def upsert_ik(cur, line_type, model, variant, sheet, steps):
    cur.execute(
        """
        INSERT INTO ik_data (line_type, model, variant, sheet, steps)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (line_type, model, variant, sheet)
        DO UPDATE SET steps = EXCLUDED.steps
        """,
        (line_type, model, variant, sheet, json.dumps(steps))
    )

def sheet_to_png(ws, tmp_dir, idx):
    """Export satu worksheet Excel ke PNG via PDF"""
    pdf_path = os.path.join(tmp_dir, f'sheet_{idx}.pdf')
    # ExportAsFixedFormat: Type=0 (PDF), Quality=0 (standard), IncludeDocProperties=True, IgnorePrintAreas=False
    ws.ExportAsFixedFormat(0, pdf_path, 0, True, False)

    doc = fitz.open(pdf_path)
    page = doc[0]
    mat = fitz.Matrix(PDF_SCALE, PDF_SCALE)
    pix = page.get_pixmap(matrix=mat)
    png_bytes = pix.tobytes('png')
    doc.close()
    os.remove(pdf_path)
    return png_bytes

def process_workbook(xl, wb_path, line_type, model, variant_name, r2, db_cur):
    """Proses satu file Excel: tiap sheet = satu step dengan image_key"""
    print(f'  Opening: {os.path.basename(wb_path)}')
    wb = xl.Workbooks.Open(wb_path)

    with tempfile.TemporaryDirectory() as tmp_dir:
        for i, ws in enumerate(wb.Sheets):
            sheet_name = ws.Name.strip()

            # Skip sheet kosong / hanya angka / Sheet1
            if RE_NUMERIC_SHEET.match(sheet_name) or sheet_name.lower() in ('sheet1', 'sheet2', 'sheet3'):
                print(f'    Skip sheet: "{sheet_name}"')
                continue

            # Cek apakah sheet punya konten
            try:
                used = ws.UsedRange
                if used.Rows.Count <= 1 and used.Columns.Count <= 1:
                    print(f'    Skip kosong: "{sheet_name}"')
                    continue
            except:
                pass

            r2_key = f'ik/{line_type}/{model}/{safe_key(variant_name)}/{safe_key(sheet_name)}/page_1.png'

            try:
                png_bytes = sheet_to_png(ws, tmp_dir, i)
            except Exception as e:
                print(f'    ERROR render "{sheet_name}": {e}')
                continue

            # Upload ke R2
            try:
                upload_to_r2(r2, r2_key, png_bytes)
            except Exception as e:
                print(f'    ERROR upload "{sheet_name}": {e}')
                continue

            # Upsert ke DB — format sama dengan D26A
            steps = [{'no': 1, 'text': 'Halaman 1', 'image_key': r2_key}]
            try:
                upsert_ik(db_cur, line_type, model, variant_name, sheet_name, steps)
            except Exception as e:
                print(f'    ERROR DB "{sheet_name}": {e}')
                continue

            print(f'    OK: "{sheet_name}" -> {r2_key} ({len(png_bytes)//1024}KB)')

    wb.Close(False)

def main():
    print('=== Import IK D37D (full-page format) ===\n')

    r2 = get_r2()
    db = get_db()
    db.autocommit = False
    cur = db.cursor()

    # Hapus data D37D lama dari DB
    cur.execute("DELETE FROM ik_data WHERE model = 'D37D'")
    deleted = cur.rowcount
    print(f'Deleted {deleted} baris D37D lama dari DB\n')

    pythoncom.CoInitialize()
    xl = win32com.client.Dispatch('Excel.Application')
    xl.Visible = False
    xl.DisplayAlerts = False

    try:
        for cfg in IK_FOLDERS:
            line_type = cfg['lineType']
            model     = cfg['model']
            folder    = cfg['folder']

            if not os.path.isdir(folder):
                print(f'Folder tidak ada: {folder}')
                continue

            xlsx_files = sorted([
                f for f in os.listdir(folder)
                if f.lower().endswith(('.xlsx', '.xls')) and not f.startswith('~$')
            ])

            print(f'\n--- {line_type} {model}: {len(xlsx_files)} file di {folder} ---')

            for fname in xlsx_files:
                # Nama variant = nama file tanpa ekstensi
                variant_name = os.path.splitext(fname)[0].strip()
                wb_path = os.path.join(folder, fname)

                try:
                    process_workbook(xl, wb_path, line_type, model, variant_name, r2, cur)
                except Exception as e:
                    print(f'  ERROR workbook {fname}: {e}')
                    continue

                db.commit()
                print(f'  Commit OK: {variant_name}')

    finally:
        try:
            xl.Quit()
        except:
            pass
        pythoncom.CoUninitialize()

    cur.close()
    db.close()
    print('\n=== Selesai ===')

if __name__ == '__main__':
    main()
