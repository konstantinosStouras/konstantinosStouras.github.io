// lit-query.js — translate the /fun/lit filter state into SQL against the
// range-served lit.db (schema built by _scraper/emit-db.mjs). Single source of
// truth, loaded both by the served page and by the Node parity harness.
//
// The app's four text filters are SUBSTRING by default, word-boundary when
// "quoted", and Authors use prefix-of-a-name-part. SQLite can't express those
// exactly in one indexed predicate, so each text term becomes:
//   • an INDEX-ACCELERATED SQL PREFILTER that is a guaranteed SUPERSET of the
//     true matches — a trigram FTS5 MATCH (`{col} : "term"`), which for ≥3-char
//     terms is selectivity-scaled and near-exact (adjacency of trigrams ==
//     substring, modulo diacritic folding); <3-char terms fall back to a base
//     LIKE scan — then
//   • a RESIDUAL verify in JS using textMatch/authorMatch copied VERBATIM from
//     index.html, so the final set is EXACTLY what the page would show.
// Non-text predicates (journal scope, year, pre-print) are ordinary indexed
// WHERE clauses over `papers p`.
(function (root) {
  'use strict';

  // ── matchers: VERBATIM from index.html (residual verify == the page) ────────
  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function textMatch(haystack, query) {
    if (!query) return true;
    var m = query.match(/^"(.*)"$/);
    if (!m) return haystack.indexOf(query) !== -1;
    var phrase = m[1].trim();
    if (!phrase) return true;
    return new RegExp('\\b' + escRegex(phrase) + '\\b').test(haystack);
  }
  function authorMatch(haystack, query) {
    if (!query) return true;
    if (query.charAt(0) === '"') return textMatch(haystack, query);
    var idx = 0;
    while ((idx = haystack.indexOf(query, idx)) !== -1) {
      var prev = idx === 0 ? '' : haystack.charAt(idx - 1);
      if (!prev || !/[a-zà-ɏ]/i.test(prev)) return true;
      idx += 1;
    }
    return false;
  }

  // ── helpers ─────────────────────────────────────────────────────────────────
  function likeEsc(s) { return s.replace(/[\\%_]/g, '\\$&'); }
  function inList(arr) { return arr.map(function () { return '?'; }).join(','); }
  function quotedPhrase(q) { var m = q && q.match(/^"(.*)"$/); return m ? m[1].trim() : null; }
  // The searchable "core" of a term: the phrase inside quotes, else the term.
  function core(term) { var ph = quotedPhrase(term); return ph == null ? term : ph; }
  // A term → one FTS5 column-filtered phrase: {col} : "escaped".
  function ftsPhrase(col, s) { return '{' + col + '} : "' + String(s).replace(/"/g, '""') + '"'; }

  // Journal-scope predicate over `papers p`. scope null → '' (whole corpus).
  function buildScope(sel) {
    var journals = Array.from(sel.journal || []);
    var jtypes = Array.from(sel.jtype || []);
    if (!journals.length && !jtypes.length) return { where: '', params: [] };
    var ors = [], params = [];
    if (journals.length) {
      ors.push('EXISTS (SELECT 1 FROM paper_jkey j WHERE j.paper_id=p.id AND j.jkey IN (' + inList(journals) + '))');
      params.push.apply(params, journals);
    }
    var COL = { utd24: 'is_utd24', ft50: 'is_ft50', abs4: 'is_abs4', abs3: 'is_abs3' };
    jtypes.forEach(function (t) { if (COL[t]) ors.push('p.' + COL[t] + '=1'); });
    return { where: '(' + ors.join(' OR ') + ')', params: params };
  }

  // Collect a dimension's terms (live input + chips).
  function textTerms(sel, dim, live) {
    var terms = [];
    if (live) terms.push(live);
    (sel[dim] ? Array.from(sel[dim]) : []).forEach(function (t) { terms.push(t); });
    return terms;
  }

  // Build the full filter predicate. opts.exclude{Scope,Year,Title,Abstract,
  // Affiliation,Author} drop a dimension (crossFilter). Returns:
  //   { joins, where, params, residuals }
  // where residuals is a list verified in JS after the SQL prefilter.
  function buildFilter(sel, live, opts) {
    opts = opts || {};
    live = live || {};
    var where = [], params = [], residuals = [];
    var matchClauses = [];        // FTS5 MATCH sub-expressions (ANDed)

    if (!opts.excludeScope) {
      var sc = buildScope(sel);
      if (sc.where) { where.push(sc.where); params.push.apply(params, sc.params); }
    }
    if (sel.preprintOnly) where.push('p.has_preprint=1');
    if (!opts.excludeYear && sel.year && sel.year.size) {
      // Filter on the INTEGER year column (indexed) — year chips are always
      // numeric, so this is equivalent to the page's string equality but uses
      // ix_year instead of scanning the table. Non-numeric chips (none in
      // practice) are dropped.
      var years = Array.from(sel.year).map(function (y) { return parseInt(y, 10); }).filter(function (y) { return !isNaN(y); });
      if (years.length) { where.push('p.year IN (' + inList(years) + ')'); params.push.apply(params, years); }
      else { where.push('0'); }
    }

    // text dimensions
    var DIMS = [
      { dim: 'title', col: 'title', live: live.title, kind: 'text', excl: 'excludeTitle' },
      { dim: 'abstract', col: 'abstract', live: live.abstract, kind: 'text', excl: 'excludeAbstract' },
      { dim: 'affiliation', col: 'affiliations', live: live.affiliation, kind: 'text', excl: 'excludeAffiliation' },
      { dim: 'author', col: 'authors', live: live.author, kind: 'author', excl: 'excludeAuthor' },
    ];
    var likeClauses = [];   // {sql, param} for <3-char fallback terms
    DIMS.forEach(function (d) {
      if (opts[d.excl]) return;
      textTerms(sel, d.dim, d.live).forEach(function (term) {
        var c = core(term);
        if (c === '') return;                       // empty quotes → ignored
        if (c.length >= 3) {
          matchClauses.push(ftsPhrase(d.col, c));    // trigram phrase == exact substring
        } else {
          likeClauses.push({ sql: 'p.' + d.col + " LIKE ? ESCAPE '\\'", param: '%' + likeEsc(c) + '%' });
        }
        // Residual verify (fetches candidate text) is needed ONLY where the SQL
        // prefilter is a strict superset: quoted terms (word-boundary \b) and
        // ALL author terms (prefix-of-a-name-part). Unquoted substring on
        // title/abstract/affiliation needs none — the trigram phrase (no
        // diacritic folding) IS the exact case-insensitive substring, and the
        // <3-char LIKE fallback is exact too. This is what keeps a broad
        // substring search from fetching every candidate row.
        var isQuoted = quotedPhrase(term) !== null;
        if (d.kind === 'author' || isQuoted) residuals.push({ col: d.col, term: term, author: d.kind === 'author' });
      });
    });

    // author identity chips: OR across variants, AND across chips.
    if (!opts.excludeAuthor && sel.authorIdentity) {
      Object.keys(sel.authorIdentity).forEach(function (lbl) {
        var vs = (sel.authorIdentity[lbl] || []).filter(Boolean);
        if (!vs.length) return;
        var big = vs.filter(function (v) { return v.length >= 3; });
        if (big.length === vs.length) {
          matchClauses.push('(' + vs.map(function (v) { return ftsPhrase('authors', v); }).join(' OR ') + ')');
        } else {
          // any short variant → LIKE-OR fallback covers the whole chip
          likeClauses.push({ multi: vs.map(function (v) { return { sql: "p.authors LIKE ? ESCAPE '\\'", param: '%' + likeEsc(v) + '%' }; }) });
        }
        // Identity is plain substring (includes) → exact via MATCH/LIKE, no residual.
      });
    }

    var joins = '';
    if (matchClauses.length) {
      joins = ' JOIN papers_tri ON papers_tri.rowid=p.id ';
      where.push('papers_tri MATCH ?');
      params.push(matchClauses.join(' AND '));
    }
    likeClauses.forEach(function (lc) {
      if (lc.multi) { where.push('(' + lc.multi.map(function (m) { return m.sql; }).join(' OR ') + ')'); lc.multi.forEach(function (m) { params.push(m.param); }); }
      else { where.push(lc.sql); params.push(lc.param); }
    });

    var whereStr = where.length ? where.join(' AND ') : '1';
    // ftsOnly: the ONLY predicate is the trigram MATCH (no facet/year/preprint/
    // like). Then a count can run on papers_tri alone — no join into papers —
    // which is what keeps a broad substring count to a few KB.
    var ftsOnly = matchClauses.length > 0 && whereStr === 'papers_tri MATCH ?';
    return { joins: joins, where: whereStr, params: params, residuals: residuals, ftsOnly: ftsOnly };
  }

  // Apply residuals in JS. Row must expose title/authors/affiliations/abstract.
  function applyResiduals(rows, residuals) {
    if (!residuals.length) return rows;
    return rows.filter(function (row) {
      return residuals.every(function (res) {
        var hay = String(row[res.col] == null ? '' : row[res.col]).toLowerCase();
        if (res.identity) return res.identity.some(function (v) { return hay.indexOf(v) !== -1; });
        return res.author ? authorMatch(hay, res.term) : textMatch(hay, res.term);
      });
    });
  }

  root.LitQuery = {
    matchers: { textMatch: textMatch, authorMatch: authorMatch, escRegex: escRegex },
    likeEsc: likeEsc,
    buildScope: buildScope,
    buildFilter: buildFilter,
    applyResiduals: applyResiduals,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.LitQuery;
