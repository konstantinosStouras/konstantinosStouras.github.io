"""
Script 1 of 2: Pull Management Science article list from Crossref API.
Outputs: mnsc_articles.csv (used as input for Script 2)

This gets the initial list of articles with DOIs. Some fields (Volume, Issue)
may be missing from Crossref — Script 2 fixes those from the INFORMS website.

Columns: Year, Volume, Issue, Title, Authors, Cite As, DOI, Abstract, Status

Install: pip install requests
Run:     python crossref_mnsc.py
"""
import requests, csv, time, re, html, unicodedata

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


def clean_text(s):
    """Normalize Unicode characters to clean ASCII-friendly equivalents."""
    if not s:
        return ""
    # Smart quotes to straight quotes
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201C", '"').replace("\u201D", '"')
    # Dashes
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    # Other common Unicode
    s = s.replace("\u2026", "...").replace("\u00A0", " ")
    s = s.replace("\u2032", "'").replace("\u2033", '"')
    s = s.replace("\u00D7", "x")
    # HTML tags and entities
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return " ".join(s.split()).strip()


def get_authors(item):
    names = []
    for a in item.get("author", []):
        given = a.get("given", "")
        family = a.get("family", "")
        name = f"{given} {family}".strip()
        if name:
            names.append(name)
    return ", ".join(names)


def get_year(item):
    for field in ["published-print", "published", "published-online", "created"]:
        dp = item.get(field, {}).get("date-parts", [[]])
        if dp and dp[0] and dp[0][0]:
            return dp[0][0]
    return ""


def get_volume(item):
    vol = item.get("volume", "")
    if vol:
        return vol
    return item.get("journal-issue", {}).get("journal-volume", {}).get("volume", "")


def get_issue(item):
    iss = item.get("issue", "")
    if iss:
        return iss
    return item.get("journal-issue", {}).get("issue", "")


def get_abstract(item):
    abstract = item.get("abstract", "")
    if not abstract:
        return ""
    return clean_text(abstract)


def get_cite_as(item):
    authors = get_authors(item)
    year = get_year(item)
    title = clean_text(item.get("title", [""])[0])
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

                title = clean_text(item.get("title", [""])[0])
                if any(skip in title.lower() for skip in SKIP_TITLES):
                    continue

                vol = get_volume(item)
                status = "Articles in Advance" if (not vol or vol == "0") else "Published"

                all_items.append({
                    "Year": get_year(item),
                    "Volume": vol,
                    "Issue": get_issue(item),
                    "Title": title,
                    "Authors": get_authors(item),
                    "Cite As": get_cite_as(item),
                    "DOI": "https://doi.org/" + item.get("DOI", ""),
                    "Abstract": get_abstract(item),
                    "Status": status,
                })
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
    with open(OUTPUT, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(items)

    published = sum(1 for r in items if r["Status"] == "Published")
    advance = sum(1 for r in items if r["Status"] == "Articles in Advance")
    print(f"\nDone! {len(items)} articles saved to {OUTPUT}")
    print(f"  Published: {published}")
    print(f"  Articles in Advance: {advance}")
    print(f"\nNow run Script 2 (scrape_editors.py) to fix missing data and add editor info.")


if __name__ == "__main__":
    main()