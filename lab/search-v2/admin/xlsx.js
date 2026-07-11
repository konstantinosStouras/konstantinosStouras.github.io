/* ==========================================================================
   search-v2  ·  admin/xlsx.js
   Minimal, dependency-free .xlsx writer (no CDN, per repo conventions): a real
   Office Open XML workbook assembled as an uncompressed (STORE) zip. Enough of
   the spec for clean data exports: multiple sheets, a bold/filled frozen header
   row with an auto-filter, per-column widths, and typed cells (numbers as
   numbers, strings as inline strings — no sharedStrings table needed).

   API (browser: window.SVXlsx; Node: module.exports, used by tools/selftest.js):
     SVXlsx.build(sheets) -> Uint8Array          // the .xlsx file bytes
     SVXlsx.download(filename, sheets)           // browser: trigger a download

   `sheets` is [{ name, cols, rows, filter }]:
     name   : sheet tab name (sanitised to Excel's rules, ≤31 chars)
     cols   : optional [{ w }] per-column widths (Excel "characters")
     rows   : array of rows; each row an array of cells. Row 0 is the header.
              null/undefined -> empty cell; finite number -> numeric cell;
              boolean -> 1/0; everything else -> text.
     filter : default true — set false to skip the header auto-filter (ReadMe).
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SVXlsx = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- tiny zip writer (STORE entries only) --------------------------------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function utf8(str) { return new TextEncoder().encode(str); }
  function dosDateTime(d) {
    // Local time in MS-DOS format; clamp to the format's 1980 epoch.
    var year = Math.max(1980, d.getFullYear());
    var date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date: date & 0xFFFF, time: time & 0xFFFF };
  }
  // entries: [{ name, data: Uint8Array }] -> one Uint8Array zip file
  function buildZip(entries) {
    var now = dosDateTime(new Date());
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    entries.forEach(function (e) {
      var name = utf8(e.name), data = e.data, crc = crc32(data);
      var common = [].concat(
        u16(20), u16(0x0800 /* UTF-8 names */), u16(0 /* STORE */),
        u16(now.time), u16(now.date), u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0)
      );
      var local = new Uint8Array(30 + name.length + data.length);
      local.set([].concat(u32(0x04034B50), common), 0);
      local.set(name, 30);
      local.set(data, 30 + name.length);
      chunks.push(local);
      var cen = new Uint8Array(46 + name.length);
      cen.set([].concat(u32(0x02014B50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset)), 0);
      cen.set(name, 46);
      central.push(cen);
      offset += local.length;
    });
    var cdSize = 0;
    central.forEach(function (c) { cdSize += c.length; });
    var eocd = new Uint8Array(22);
    eocd.set([].concat(
      u32(0x06054B50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(cdSize), u32(offset), u16(0)
    ), 0);
    var total = offset + cdSize + eocd.length, out = new Uint8Array(total), p = 0;
    chunks.concat(central, [eocd]).forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  // ---- spreadsheet XML ------------------------------------------------------
  function xmlEsc(v) {
    return String(v)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Excel rejects control chars
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colLetter(i) { // 0 -> A, 25 -> Z, 26 -> AA …
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  function sheetNameSafe(name, idx) {
    var s = String(name || 'Sheet' + (idx + 1)).replace(/[\[\]*?:\/\\]/g, ' ').trim().slice(0, 31);
    return s || 'Sheet' + (idx + 1);
  }
  function cellXml(ref, v, styleId) {
    var s = styleId ? ' s="' + styleId + '"' : '';
    if (v == null || v === '') return '';
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
    var t = String(v);
    var sp = /^\s|\s$|\n/.test(t) ? ' xml:space="preserve"' : '';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t' + sp + '>' + xmlEsc(t) + '</t></is></c>';
  }
  function sheetXml(sheet) {
    var rows = sheet.rows || [];
    var nCols = 0;
    rows.forEach(function (r) { if (r && r.length > nCols) nCols = r.length; });
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0">' +
      (rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '') +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>';
    if (sheet.cols && sheet.cols.length) {
      xml += '<cols>';
      sheet.cols.forEach(function (c, i) {
        if (c && c.w) xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + c.w + '" customWidth="1"/>';
      });
      xml += '</cols>';
    }
    xml += '<sheetData>';
    rows.forEach(function (row, ri) {
      xml += '<row r="' + (ri + 1) + '">';
      (row || []).forEach(function (v, ci) {
        xml += cellXml(colLetter(ci) + (ri + 1), v, ri === 0 ? 1 : 0);
      });
      xml += '</row>';
    });
    xml += '</sheetData>';
    if (sheet.filter !== false && rows.length > 1 && nCols > 0) {
      xml += '<autoFilter ref="A1:' + colLetter(nCols - 1) + rows.length + '"/>';
    }
    return xml + '</worksheet>';
  }

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAEEF3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '</styleSheet>';

  function build(sheets) {
    if (!sheets || !sheets.length) sheets = [{ name: 'Sheet1', rows: [] }];
    var names = sheets.map(function (s, i) { return sheetNameSafe(s.name, i); });
    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) {
        return '<sheet name="' + xmlEsc(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') +
      '</sheets></workbook>';
    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    var entries = [
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'xl/workbook.xml', data: utf8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) },
      { name: 'xl/styles.xml', data: utf8(STYLES) }
    ];
    sheets.forEach(function (s, i) {
      entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(sheetXml(s)) });
    });
    return buildZip(entries);
  }

  function download(filename, sheets) {
    var bytes = build(sheets);
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  return { build: build, download: download };
});
