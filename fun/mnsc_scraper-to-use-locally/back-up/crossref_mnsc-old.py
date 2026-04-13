"""
Pull Management Science article metadata from Crossref API (2011–present).
Outputs: mnsc_articles.csv with columns A–G.
Run: pip install requests && python crossref_mnsc.py
"""
import requests, csv, time, sys

ISSN = "0025-1909"
BASE = "https://api.crossref.org/journals/{}/works".format(ISSN)
MAILTO = "kstouras@gmail.com"
START_YEAR = 2011
END_YEAR = 2026
ROWS_PER_PAGE = 100
OUTPUT = "mnsc_articles.csv"

def get_authors(item):
    authors = item.get("author", [])
    names = []
    for a in authors:
        given = a.get("given", "")
        family = a.get("family", "")
        names.append(f"{given} {family}".strip())
    return ", ".join(names)

def get_year(item):
    pp = item.get("published-print", {}).get("date-parts", [[None]])[0]
    po = item.get("published-online", {}).get("date-parts", [[None]])[0]
    dp = pp or po
    return dp[0] if dp and dp[0] else ""

def get_cite_as(item):
    authors = get_authors(item)
    year = get_year(item)
    title = item.get("title", [""])[0]
    vol = item.get("volume", "")
    iss = item.get("issue", "")
    page = item.get("page", "")
    return f"{authors} ({year}) {title}. Management Science {vol}({iss}):{page}"

def fetch_all():
    all_items = []
    for year in range(START_YEAR, END_YEAR + 1):
        cursor = "*"
        year_count = 0
        while True:
            params = {
                "filter": f"from-pub-date:{year}-01,until-pub-date:{year}-12",
                "rows": ROWS_PER_PAGE,
                "cursor": cursor,
                "mailto": MAILTO,
            }
            resp = requests.get(BASE, params=params, timeout=30)
            if resp.status_code != 200:
                print(f"  Error {resp.status_code} for year {year}, retrying...")
                time.sleep(5)
                continue
            data = resp.json()["message"]
            items = data.get("items", [])
            if not items:
                break
            for item in items:
                # Filter: only journal-article type
                if item.get("type") != "journal-article":
                    continue
                title = item.get("title", [""])[0]
                # Skip Management Insights, editorials, commentary
                lower_title = title.lower()
                if any(skip in lower_title for skip in [
                    "management insights", "editorial", "from the editor",
                    "erratum", "corrigendum", "correction", "retraction",
                    "introduction to the special issue", "letter to the editor"
                ]):
                    continue
                row = {
                    "Year": get_year(item),
                    "Volume": item.get("volume", ""),
                    "Issue": item.get("issue", ""),
                    "Title": title,
                    "Authors": get_authors(item),
                    "Cite As": get_cite_as(item),
                    "DOI": "https://doi.org/" + item.get("DOI", ""),
                }
                all_items.append(row)
                year_count += 1

            cursor = data.get("next-cursor", "")
            if not cursor:
                break
            time.sleep(0.5)  # Be polite

        print(f"Year {year}: {year_count} articles")
    return all_items

def main():
    print(f"Fetching Management Science articles {START_YEAR}–{END_YEAR}...")
    items = fetch_all()
    # Sort by year, volume, issue
    items.sort(key=lambda x: (str(x["Year"]), str(x["Volume"]).zfill(3), str(x.get("Issue", "")).zfill(3)))

    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Year","Volume","Issue","Title","Authors","Cite As","DOI"])
        writer.writeheader()
        writer.writerows(items)

    print(f"\nDone! {len(items)} articles saved to {OUTPUT}")

if __name__ == "__main__":
    main()
