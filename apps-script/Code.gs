/**
 * PODS Olympics Live Leaderboard
 * ------------------------------------------------------------
 * Paste this whole file into Extensions > Apps Script (as Code.gs),
 * add an HTML file named Index (paste Index.html into it), then
 * Deploy > New deployment > Web app.
 *
 * The board reads three tabs in this spreadsheet:
 *   Settings  - title, year, organization, Day 1 date, number of days
 *   Schedule  - one row per event (day, event, time, location, scored?)
 *   Scores    - PODS leader names across the top, events down column A
 *
 * You should never need to edit this code to run a new year.
 * Change the tabs instead.
 */

var TAB_SETTINGS = 'Settings';
var TAB_SCHEDULE = 'Schedule';
var TAB_SCORES = 'Scores';

/* ---------- web page ---------- */

function doGet(e) {
  // ?format=json returns just the data, for a copy of the board hosted elsewhere (GitHub Pages)
  if (e && e.parameter && e.parameter.format === 'json') {
    return ContentService.createTextOutput(JSON.stringify(getBoardData()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var data = getBoardData();
  var page = HtmlService.createTemplateFromFile('Index');
  page.initial = JSON.stringify(data).replace(/</g, '\\u003c');
  return page.evaluate()
    .setTitle(data.config.title + ' ' + data.config.year + ' Leaderboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Called by the page every 30 seconds to pick up new scores. */
function getBoardData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = readSettings_(ss);
  var schedule = readSchedule_(ss);
  var sc = readScores_(ss, schedule);
  var data = {
    config: config,
    schedule: schedule,
    pods: sc.pods,
    events: sc.events,
    scores: sc.scores,
    updatedAt: PropertiesService.getScriptProperties().getProperty('updatedAt') || null,
    url: ''
  };
  data.snapshot = snapshot_(data);
  data.url = boardLink_(config);
  return data;
}

/* ---------- spreadsheet menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏅 PODS Olympics')
    .addItem('Show leaderboard link', 'showLeaderboardLink')
    .addItem('Start a new season', 'startNewSeason')
    .addToUi();
}

/** Stamps "last updated" whenever someone edits the leaderboard tabs. */
function onEdit(e) {
  try {
    var name = e.range.getSheet().getName();
    if ([TAB_SETTINGS, TAB_SCHEDULE, TAB_SCORES].indexOf(name) >= 0) {
      PropertiesService.getScriptProperties().setProperty('updatedAt', new Date().toISOString());
    }
  } catch (err) {}
}

function showLeaderboardLink() {
  var ui = SpreadsheetApp.getUi();
  var url = boardLink_(readSettings_(SpreadsheetApp.getActiveSpreadsheet()));
  if (!url) {
    ui.alert('Add the leaderboard link first',
      'Paste the leaderboard link on the Settings tab next to "Leaderboard link". Use the GitHub Pages link if you set one up, otherwise the Web app URL from Deploy > Manage deployments (ends in /exec). This menu and the QR code on the board use it from then on.',
      ui.ButtonSet.OK);
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px">' +
    '<p>Share this link, text it to the cohort, or open it on the TV:</p>' +
    '<p><a href="' + url + '" target="_blank" style="word-break:break-all">' + url + '</a></p>' +
    '</div>').setWidth(480).setHeight(170);
  ui.showModalDialog(html, 'Leaderboard link');
}

/** The real public link: the one pasted on Settings, since Google's own lookup can return the private test (/dev) link. */
function boardLink_(cfg) {
  var link = String((cfg && cfg.link) || '').trim();
  if (/^https:\/\//.test(link)) return link.replace(/script\.google\.com\/macros\/u\/\d+\//, 'script.google.com/macros/');
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) {}
  return /\/exec(\?|$)/.test(url) ? url : '';
}

function startNewSeason() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Start a new season?',
    'This saves a copy of the current Scores tab, clears every score, and moves the year up by one. The schedule and PODS names stay so you can edit them.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB_SCORES);
  var cfg = readSettings_(ss);
  if (!sh) { ui.alert('There is no tab named "' + TAB_SCORES + '".'); return; }

  var archive = 'Scores ' + (cfg.year || ymd_(new Date()));
  var name = archive, n = 2;
  while (ss.getSheetByName(name)) { name = archive + ' (' + n++ + ')'; }
  sh.copyTo(ss).setName(name);

  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last > 1 && lastCol > 1) {
    var labels = sh.getRange(1, 1, last, 1).getDisplayValues();
    var formulas = sh.getRange(1, 2, last, lastCol - 1).getFormulas();
    var hdr = findScoresHeader_(labels.map(function (r) { return r[0]; }));
    for (var r = hdr + 1; r < last; r++) {
      var label = norm_(labels[r][0]);
      if (!label || /TOTAL|RANK/.test(label)) continue;
      if (formulas[r].some(function (f) { return f; })) continue;
      sh.getRange(r + 1, 2, 1, lastCol - 1).clearContent();
    }
  }

  var set = ss.getSheetByName(TAB_SETTINGS);
  if (set) {
    var vals = set.getDataRange().getValues();
    for (var i = 0; i < vals.length; i++) {
      if (/YEAR|SEASON/.test(norm_(vals[i][0]))) {
        var y = num_(vals[i][1]);
        if (y) set.getRange(i + 1, 2).setNumberFormat('@').setValue(String(y + 1));
        break;
      }
    }
  }
  var props = PropertiesService.getScriptProperties();
  ['snap', 'lastRanks', 'lastDate', 'season'].forEach(function (k) { props.deleteProperty(k); });
  props.setProperty('updatedAt', new Date().toISOString());

  ui.alert('New season ready',
    'Last season is saved on the "' + name + '" tab.\n\nNext: update the Day 1 date on Settings, the events on Schedule, and the PODS leader names and event rows on Scores. The live board picks up the changes on its own.',
    ui.ButtonSet.OK);
}

/* ---------- reading the tabs ---------- */

function readSettings_(ss) {
  var cfg = { title: 'PODS Olympics', year: '', org: '', start: ymd_(new Date()), days: 5, link: '' };
  var sh = ss.getSheetByName(TAB_SETTINGS);
  if (!sh) return cfg;
  var rng = sh.getDataRange(), v = rng.getValues(), dv = rng.getDisplayValues();
  for (var i = 0; i < v.length; i++) {
    var k = norm_(v[i][0]), val = v[i][1], disp = String(dv[i][1] || '').trim();
    if (!k || disp === '') continue;
    if (/LINK|URL/.test(k)) cfg.link = disp;
    else if (/TITLE/.test(k)) cfg.title = disp;
    else if (/YEAR|SEASON/.test(k)) cfg.year = disp;
    else if (/ORGANI|PROGRAM|HOST/.test(k)) cfg.org = disp;
    else if (/START|DAY 1|FIRST DAY/.test(k)) {
      if (val instanceof Date) cfg.start = ymd_(val);
      else { var d = new Date(disp); if (!isNaN(d)) cfg.start = ymd_(d); }
    }
    else if (/NUMBER OF DAYS|HOW MANY DAYS|^DAYS/.test(k)) {
      var n = Math.round(num_(val));
      if (n > 0 && n <= 31) cfg.days = n;
    }
  }
  return cfg;
}

function readSchedule_(ss) {
  var sh = ss.getSheetByName(TAB_SCHEDULE);
  if (!sh) return [];
  var rng = sh.getDataRange(), v = rng.getValues(), dv = rng.getDisplayValues();
  var h = -1, col = {};
  for (var i = 0; i < dv.length && h < 0; i++) {
    if (dv[i].some(function (c) { return /^EVENT/.test(norm_(c)); })) h = i;
  }
  if (h < 0) return [];
  dv[h].forEach(function (c, j) {
    var n = norm_(c);
    if (/^DAY/.test(n) && col.day == null) col.day = j;
    else if (/^EVENT/.test(n) && col.event == null) col.event = j;
    else if (/TIME/.test(n)) col.time = j;
    else if (/LOCATION|WHERE|ROOM/.test(n)) col.location = j;
    else if (/SCORED|POINTS|COUNTS/.test(n)) col.scored = j;
    else if (/SHORT|BOARD/.test(n)) col.short = j;
    else if (/NOTE|INSTRUCT|DETAIL/.test(n)) col.notes = j;
  });
  var out = [];
  for (var r = h + 1; r < dv.length; r++) {
    var g = function (k) { return col[k] == null ? '' : String(dv[r][col[k]] || '').trim(); };
    var ev = g('event');
    if (!ev) continue;
    out.push({
      day: Math.round(num_(col.day == null ? '' : v[r][col.day])) || 0,
      event: ev,
      time: g('time'),
      location: g('location'),
      scored: col.scored == null ? true : !/^(NO|N|FALSE|0)$/.test(norm_(g('scored'))),
      short: g('short'),
      notes: g('notes')
    });
  }
  return out;
}

function findScoresHeader_(colA) {
  for (var i = 0; i < colA.length; i++) {
    if (/POD|LEADER|TEAM|NAME/.test(norm_(colA[i]))) return i;
  }
  return 0;
}

function readScores_(ss, schedule) {
  var sh = ss.getSheetByName(TAB_SCORES) || ss.getSheets()[0];
  var empty = { pods: [], events: [], scores: {} };
  if (!sh || sh.getLastRow() < 1) return empty;
  var rng = sh.getDataRange(), v = rng.getValues(), dv = rng.getDisplayValues();
  var hdr = findScoresHeader_(dv.map(function (r) { return r[0]; }));

  var pods = [], ids = {};
  dv[hdr].forEach(function (c, j) {
    var n = norm_(c);
    if (j < 1 || !n || /TOTAL|SUM|RANK|POINTS|NOTES/.test(n)) return;
    var id = slug_(n);
    while (ids[id]) id += '-2';
    ids[id] = 1;
    pods.push({ id: id, name: display_(c), col: j });
  });

  var events = [], byId = {}, scores = {};
  pods.forEach(function (p) { scores[p.id] = {}; });

  for (var r = hdr + 1; r < dv.length; r++) {
    var label = String(dv[r][0] || '').trim();
    var L = norm_(label);
    if (!label || /TOTAL|^RANK/.test(L)) continue;
    var m = label.match(/^\s*day\s*(\d+)\s*[:\-]?\s*/i);
    var name = display_(label.replace(/^\s*day\s*\d+\s*[:\-]?\s*/i, ''));
    var id = /BONUS|PENALT|ADJUST/.test(L) ? 'bonus' : slug_(name);
    if (!byId[id]) {
      var match = matchSchedule_(name, schedule);
      var ev = {
        id: id,
        name: id === 'bonus' ? 'Bonus or penalties' : (match ? match.event : name),
        short: id === 'bonus' ? 'Bonus' : (match ? match.short : ''),
        day: m ? Number(m[1]) : (match ? match.day : 0)
      };
      byId[id] = ev;
      events.push(ev);
    }
    pods.forEach(function (p) {
      var n = num_(v[r][p.col]);
      if (n === null) return;
      if (n) scores[p.id][id] = n; else delete scores[p.id][id];
    });
  }
  pods.forEach(function (p) { delete p.col; });
  return { pods: pods, events: events, scores: scores };
}

function matchSchedule_(name, schedule) {
  var lt = tokens_(name), best = null, bn = 0;
  schedule.forEach(function (s) {
    var et = tokens_(s.event);
    if (norm_(s.event) === norm_(name)) { best = s; bn = 999; return; }
    if (et.length && et.every(function (t) { return lt.indexOf(t) >= 0; }) && et.length > bn) { best = s; bn = et.length; }
  });
  return best;
}

/* ---------- movement arrows (rank at the start of each day) ---------- */

function snapshot_(data) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var today = ymd_(new Date());
  var season = data.config.title + '|' + data.config.year;

  var totals = data.pods.map(function (p) {
    var s = data.scores[p.id] || {}, t = 0;
    data.events.forEach(function (e) { t += Number(s[e.id]) || 0; });
    return { id: p.id, name: p.name, total: t };
  });
  totals.sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
  var ranks = {}, rank = 0, prev = null, any = false;
  totals.forEach(function (r, i) { if (r.total !== prev) { rank = i + 1; prev = r.total; } ranks[r.id] = rank; if (r.total) any = true; });
  var cur = any ? JSON.stringify(ranks) : '';

  if (all.season !== season) {
    props.setProperties({ season: season, lastDate: today, lastRanks: cur, snap: '' });
    return null;
  }
  var snap = all.snap || '';
  if (all.lastDate !== today) {
    snap = all.lastRanks || '';
    props.setProperties({ lastDate: today, snap: snap });
  }
  if (cur !== (all.lastRanks || '')) props.setProperty('lastRanks', cur);
  return snap ? { ranks: JSON.parse(snap) } : null;
}

/* ---------- helpers ---------- */

function tz_() { return Session.getScriptTimeZone() || 'America/Los_Angeles'; }
function ymd_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function norm_(s) { return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, ' '); }
function slug_(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'x'; }
function display_(s) {
  s = String(s).trim();
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-'])\w/g, function (c) { return c.toUpperCase(); }) : s;
}
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : null;
}
function tokens_(s) {
  var stop = { THE: 1, AND: 1, OF: 1, A: 1, '': 1 };
  return norm_(s).split(/[^A-Z0-9]+/).filter(function (t) { return !stop[t]; });
}
