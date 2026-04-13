"""
Pull Management Science article metadata from Crossref API (2011-present).
Outputs: mnsc_articles.csv

Columns: Year, Volume, Issue, Title, Authors, Cite As, DOI, Abstract, Status

Status = "Published" if Volume exists and is not 0
Status = "Articles in Advance" if Volume is missing or 0

Run: pip install requests && python crossref_mnsc.py
"""
import requests, csv, time, re, html

ISSN = "0025-1909"
BASE = "https://api.crossref.org/journals/{}/works".format(ISSN)
MAILTO = "kstouras@gmail.com"
START_YEAR = 2011
END_YEAR = 2026
ROWS_PER_PAGE = 100
OUTPUT = "mnsc_articles.csv"

SKIP_TITLES = [
    "management insights", "editorial", "from the editor",
    "erratum", "corrigendum", "correction", "retraction",
    "introduction to the special issue", "letter to the editor",
    "editor's comments", "note from the editor",
]

def get_authors(item):
    authors = item.get("author", [])
    names = []
    for a in authors:
        given = a.get("given", "")
        family = a.get("family", "")
        name = f"{given} {family}".strip()
        if name:
            names.append(name)
    return ", ".join(names)

def get_year(item):
    """Extract year, trying multiple date fields."""
    for field in ["published-print", "published", "published-online", "created"]:
        dp = item.get(field, {}).get("date-parts", [[]])
        if dp and dp[0] and dp[0][0]:
            return dp[0][0]
    return ""

def get_volume(item):
    """Extract volume, checking top-level and journal-issue."""
    vol = item.get("volume", "")
    if vol:
        return vol
    return item.get("journal-issue", {}).get("journal-volume", {}).get("volume", "")

def get_issue(item):
    """Extract issue, checking top-level and journal-issue."""
    iss = item.get("issue", "")
    if iss:
        return iss
    return item.get("journal-issue", {}).get("issue", "")

def get_abstract(item):
    """Extract and clean abstract text."""
    abstract = item.get("abstract", "")
    if not abstract:
        return ""
    abstract = re.sub(r"<[^>]+>", "", abstract)
    abstract = html.unescape(abstract)
    abstract = " ".join(abstract.split())
    return abstract.strip()

def get_cite_as(item):
    """Build citation string matching INFORMS format."""
    authors = get_authors(item)
    year = get_year(item)
    title = item.get("title", [""])[0]
    vol = get_volume(item)
    iss = get_issue(item)
    page = item.get("page", "")

    cite = f"{authors} ({year}) {title}. Management Science"
    if vol:
        cite += f" {vol}"
        if iss:
            cite += f"({iss})"
        if page:
            cite += f":{page}"
    cite += "."
    return cite

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
            try:
                resp = requests.get(BASE, params=params, timeout=30)
            except Exception as e:
                print(f"  Connection error for year {year}: {e}, retrying...")
                time.sleep(5)
                continue

            if resp.status_code != 200:
                print(f"  Error {resp.status_code} for year {year}, retrying...")
                time.sleep(5)
                continue

            data = resp.json()["message"]
            items = data.get("items", [])
            if not items:
                break

            for item in items:
                if item.get("type") != "journal-article":
                    continue

                title = item.get("title", [""])[0]
                lower_title = title.lower()
                if any(skip in lower_title for skip in SKIP_TITLES):
                    continue

                vol = get_volume(item)
                iss = get_issue(item)
                status = "Articles in Advance" if (not vol or vol == "0") else "Published"

                row = {
                    "Year": get_year(item),
                    "Volume": vol,
                    "Issue": iss,
                    "Title": title,
                    "Authors": get_authors(item),
                    "Cite As": get_cite_as(item),
                    "DOI": "https://doi.org/" + item.get("DOI", ""),
                    "Abstract": get_abstract(item),
                    "Status": status,
                }
                all_items.append(row)
                year_count += 1

            cursor = data.get("next-cursor", "")
            if not cursor:
                break
            time.sleep(0.5)

        print(f"Year {year}: {year_count} articles")
    return all_items

def main():
    print(f"Fetching Management Science articles {START_YEAR}-{END_YEAR}...")
    items = fetch_all()

    items.sort(key=lambda x: (
        str(x["Year"]),
        str(x["Volume"]).zfill(3),
        str(x.get("Issue", "")).zfill(3)
    ))

    fieldnames = ["Year", "Volume", "Issue", "Title", "Authors",
                  "Cite As", "DOI", "Abstract", "Status"]

    with open(OUTPUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(items)

    published = sum(1 for r in items if r["Status"] == "Published")
    advance = sum(1 for r in items if r["Status"] == "Articles in Advance")
    print(f"\nDone! {len(items)} articles saved to {OUTPUT}")
    print(f"  Published: {published}")
    print(f"  Articles in Advance: {advance}")

if __name__ == "__main__":
    main()
