"""
Upload mnsc_articles_enriched.csv to Google Sheets.
Run: pip install gspread google-auth && python upload_to_sheets.py

First-time setup:
1. Go to https://console.cloud.google.com/
2. Create a project, enable Google Sheets API
3. Create a Service Account, download JSON key as credentials.json
4. Share your Google Sheet with the service account email

Or use OAuth:
1. pip install gspread google-auth-oauthlib
2. Create OAuth credentials, download as credentials.json
"""
import csv, gspread

SPREADSHEET_ID = "11MKt6uzfnxTNTbK4Kb1jwW32cEsKZcBRncubV2omJzQ"
CSV_FILE = "mnsc_articles_enriched.csv"
SHEET_NAME = "Sheet1"  # adjust if needed

def main():
    # Option A: Service Account
    gc = gspread.service_account(filename="credentials.json")
    # Option B: OAuth (uncomment below, comment above)
    # gc = gspread.oauth()

    sh = gc.open_by_key(SPREADSHEET_ID)
    worksheet = sh.worksheet(SHEET_NAME)

    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    # Find last row with data to append (not overwrite)
    existing = len(worksheet.get_all_values())
    if existing <= 1:
        # Sheet is empty or header only — write everything
        worksheet.update(f"A1", rows)
    else:
        # Append data rows (skip CSV header)
        data_rows = rows[1:]
        worksheet.append_rows(data_rows, value_input_option="RAW")

    print(f"Uploaded {len(rows)-1} rows to Google Sheet.")

if __name__ == "__main__":
    main()
