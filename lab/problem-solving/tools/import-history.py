"""Extract anonymous response records; retain the original workbook privately.
Usage: python tools/import-history.py workbook.xlsx output-directory
"""
import csv, hashlib, json, sys
from pathlib import Path
import openpyxl

workbook, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
book = openpyxl.load_workbook(workbook, data_only=True)
headers = ['Timestamp','Number of attempts','Yeses','Nos',"What's the rule?",'Confidence level','Yes sequences','No sequences','Notes','Got it right?','Creativity index (%)','Submission ID','Source']
records, seen, duplicates = [], set(), []
def cell(value):
    if value is None: return ''
    if hasattr(value, 'isoformat'): return value.isoformat()
    if isinstance(value, float) and value.is_integer(): return str(int(value))
    return str(value)
def add(values, source):
    values = [cell(x) for x in values]
    key = json.dumps(values[:8], ensure_ascii=False)
    if key in seen:
        duplicates.append(source)
        return
    seen.add(key)
    identity = 'legacy-' + hashlib.sha256((source+'|'+key).encode()).hexdigest()[:32]
    records.append({'id':identity, 'row':values+[identity,source]})
for i, row in enumerate(book['Responses'].values, 1):
    if i > 1 and row[0] is not None: add(list(row[:11]), f'Responses:{i}')
for i, row in enumerate(book['Copy of Responses'].values, 1):
    if i == 1: continue
    if row[0] is not None: add(list(row[:8])+['','',''], f'Copy A:H:{i}')
    if row[9] is not None:
        # K/L contain names. They stay only in the private original workbook.
        add([row[9],row[13],None,None,row[12],row[14],None,None,None,None,None], f'Copy J:O:{i}')
result = {'headers':headers, 'records':records}
(destination/'historical-import.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
with (destination/'historical-responses.csv').open('w',encoding='utf-8',newline='') as f:
    writer=csv.writer(f); writer.writerow(headers); writer.writerows(r['row'] for r in records)
manifest={'workbookSha256':hashlib.sha256(workbook.read_bytes()).hexdigest(),'count':len(records),'sources':{name:sum(r['row'][-1].startswith(name+':') for r in records) for name in ['Responses','Copy A:H','Copy J:O']},'duplicates':duplicates,'earliest':min(r['row'][0] for r in records),'latest':max(r['row'][0] for r in records)}
(destination/'migration-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest))
