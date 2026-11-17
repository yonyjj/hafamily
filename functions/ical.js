// 구글 캘린더(iCal/ICS)를 읽어서 날짜별 일정으로 펼쳐 주는 코드.
// 외부 라이브러리 없이 동작하도록 직접 만들었어요.

/* ---------- 줄 합치기 + 속성 나누기 ---------- */
function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}
function unescapeText(v) {
  return String(v).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function parseLine(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const left = line.slice(0, i), value = line.slice(i + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params = {};
  parts.slice(1).forEach((p) => {
    const j = p.indexOf('=');
    if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
  });
  return {name, params, value};
}

/* ---------- 시간대 ---------- */
// 어떤 시간대의 "벽시계 시각"을 실제 시각(UTC 밀리초)으로 바꿔요.
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  let guess = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 3; i++) {
    const off = tzOffset(guess, tz);
    const next = Date.UTC(y, mo - 1, d, h, mi, s) - off;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}
const fmtCache = {};
function partsIn(ms, tz) {
  const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
  const o = {};
  f.formatToParts(new Date(ms)).forEach((p) => {
    if (p.type !== 'literal') o[p.type] = +p.value;
  });
  if (o.hour === 24) o.hour = 0;
  return o;
}
function tzOffset(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}
const pad = (n) => String(n).padStart(2, '0');
// 실제 시각을 그 시간대의 날짜(YYYY-MM-DD)와 시간 문구로
function localDate(ms, tz) {
  const p = partsIn(ms, tz);
  return p.year + '-' + pad(p.month) + '-' + pad(p.day);
}
function localTimeText(ms, tz) {
  const p = partsIn(ms, tz);
  const h = p.hour;
  return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + pad(p.minute);
}

/* ---------- 날짜 값 읽기 ---------- */
// 20261117 / 20261117T160000 / 20261117T210000Z
function parseDT(value, params, tz) {
  const v = String(value).trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const allDay = !h || params.VALUE === 'DATE';
  if (allDay) return {allDay: true, ms: Date.UTC(+y, +mo - 1, +d, 12, 0, 0), y: +y, mo: +mo, d: +d};
  if (z) return {allDay: false, ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)};
  const zone = params.TZID || tz;
  return {allDay: false, ms: zonedToUtc(+y, +mo - 1 + 1, +d, +h, +mi, +s, zone)};
}
const DAY = 86400000;
const dnum = (ms) => Math.floor(ms / DAY);
function addDaysUTC(ms, n) {
  return ms + n * DAY;
}

/* ---------- 반복 규칙 펼치기 ---------- */
const WD = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};
function expand(start, rrule, exdates, winStart, winEnd, tz) {
  const out = [];
  if (!rrule) {
    if (start.ms >= winStart - DAY * 2 && start.ms <= winEnd) out.push(start.ms);
    return out;
  }
  const r = {};
  String(rrule).split(';').forEach((kv) => {
    const [k, v] = kv.split('=');
    if (k) r[k.toUpperCase()] = v;
  });
  const freq = (r.FREQ || '').toUpperCase();
  const interval = Math.max(1, parseInt(r.INTERVAL || '1', 10) || 1);
  const count = r.COUNT ? parseInt(r.COUNT, 10) : null;
  let until = null;
  if (r.UNTIL) {
    const u = parseDT(r.UNTIL, {}, tz);
    if (u) until = u.ms;
  }
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => x.replace(/^[-+]?\d+/, '').toUpperCase()) : null;
  const base = new Date(start.ms);
  const limit = 400; // 무한 반복 막기
  let n = 0, made = 0;

  const push = (ms) => {
    if (until && ms > until + DAY) return false;
    if (count && made >= count) return false;
    made++;
    if (ms >= winStart - DAY * 2 && ms <= winEnd) out.push(ms);
    return true;
  };

  if (freq === 'WEEKLY') {
    const days = byday && byday.length ? byday.map((x) => WD[x]).filter((x) => x != null) : [new Date(start.ms).getUTCDay()];
    // 시작 주의 일요일
    let weekStart = start.ms - new Date(start.ms).getUTCDay() * DAY;
    for (let w = 0; w < limit; w++) {
      const wk = weekStart + w * interval * 7 * DAY;
      if (wk > winEnd + DAY * 7) break;
      let ok = true;
      for (const dow of days.slice().sort((a, b) => a - b)) {
        const ms = wk + dow * DAY;
        if (ms < start.ms) continue;
        if (!push(ms)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
  } else if (freq === 'DAILY') {
    for (let i = 0; i < limit; i++) {
      const ms = addDaysUTC(start.ms, i * interval);
      if (ms > winEnd + DAY) break;
      if (!push(ms)) break;
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    const step = freq === 'MONTHLY' ? interval : interval * 12;
    for (let i = 0; i < limit; i++) {
      const d = new Date(start.ms);
      const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i * step, 1,
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
      const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(d.getUTCDate(), dim));
      const ms = target.getTime();
      if (ms > winEnd + DAY * 31) break;
      if (!push(ms)) break;
    }
  } else {
    push(start.ms);
  }
  n = n;
  const ex = new Set((exdates || []).map((x) => dnum(x)));
  return out.filter((ms) => !ex.has(dnum(ms)));
}

/* ---------- 전체 읽기 ---------- */
// 돌려주는 값: [{uid, date, end, time, t, allDay}]
function parseICS(text, opts) {
  const tz = (opts && opts.tz) || 'America/New_York';
  const now = (opts && opts.now) || Date.now();
  const back = (opts && opts.backDays != null) ? opts.backDays : 7;
  const fwd = (opts && opts.forwardDays != null) ? opts.forwardDays : 120;
  const winStart = now - back * DAY, winEnd = now + fwd * DAY;
  const lines = unfold(text).split('\n');
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      cur = {exdates: []};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'DTSTART') cur.start = parseDT(p.value, p.params, tz);
    else if (p.name === 'DTEND') cur.end = parseDT(p.value, p.params, tz);
    else if (p.name === 'DURATION') cur.duration = p.value;
    else if (p.name === 'SUMMARY') cur.summary = unescapeText(p.value).trim();
    else if (p.name === 'UID') cur.uid = p.value.trim();
    else if (p.name === 'RRULE') cur.rrule = p.value;
    else if (p.name === 'STATUS') cur.status = p.value.trim().toUpperCase();
    else if (p.name === 'RECURRENCE-ID') cur.recurrenceId = parseDT(p.value, p.params, tz);
    else if (p.name === 'EXDATE') {
      p.value.split(',').forEach((v) => {
        const d = parseDT(v, p.params, tz);
        if (d) cur.exdates.push(d.ms);
      });
    }
  }

  // 하나만 바뀐 회차(RECURRENCE-ID)는 원래 날짜를 빼고 바뀐 것으로
  const overrides = {};
  events.forEach((e) => {
    if (e.recurrenceId && e.uid) {
      (overrides[e.uid] = overrides[e.uid] || []).push(dnum(e.recurrenceId.ms));
    }
  });

  const out = [];
  for (const e of events) {
    if (!e.start || e.status === 'CANCELLED') continue;
    const title = e.summary || '(제목 없음)';
    let spanDays = 0;
    if (e.end) {
      const diff = dnum(e.end.ms) - dnum(e.start.ms);
      spanDays = e.start.allDay ? Math.max(0, diff - 1) : Math.max(0, diff);
    }
    const skip = e.recurrenceId ? [] : (overrides[e.uid] || []);
    const times = e.recurrenceId ? [e.start.ms] : expand(e.start, e.rrule, e.exdates, winStart, winEnd, tz);
    for (const ms of times) {
      if (!e.recurrenceId && skip.includes(dnum(ms))) continue;
      const date = e.start.allDay ? ymd(ms) : localDate(ms, tz);
      const item = {uid: (e.uid || title) + '_' + date, date, t: title};
      if (spanDays > 0) item.end = e.start.allDay ? ymd(addDaysUTC(ms, spanDays)) : localDate(addDaysUTC(ms, spanDays), tz);
      if (!e.start.allDay) item.time = localTimeText(ms, tz);
      out.push(item);
    }
    if (out.length > 400) break;
  }
  // 날짜순으로, 같은 날짜는 제목순
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.t < b.t ? -1 : 1));
  const seen = new Set();
  return out.filter((x) => {
    const k = x.date + '|' + x.t;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 300);
}
function ymd(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

module.exports = {parseICS, parseDT, expand, localDate, localTimeText, zonedToUtc};
