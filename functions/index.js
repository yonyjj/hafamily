// 가족방에 새 메시지가 올라오면, 보낸 사람과 보낸 기기를 뺀 가족 기기에 알림을 보내요.
// 그리고 구글 캘린더(iCal 주소)를 한 시간마다 읽어서 앱 일정으로 가져와요.
const {onDocumentCreated, onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');
const {parseICS} = require('./ical');
const {weeklyText} = require('./report');

initializeApp();
const APP_URL = 'https://yonyjj.github.io/hafamily/';
const NAMES = {mom: '엄마', dad: '아빠', eun: '은우', yeon: '연우'};
const FAMILY = 'families/main';

const TZ = 'America/New_York';
const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());

exports.notifyFamily = onDocumentCreated('families/main/messages/{id}', async (event) => {
  const m = event.data && event.data.data();
  if (!m || !m.text) return;
  const devices = await getFirestore().collection('families/main/devices').get();
  const targets = devices.docs.filter((d) => d.id !== m.dev && d.get('who') !== m.from && d.get('token'));
  if (!targets.length) return;
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map((d) => d.get('token')),
    notification: {title: '우리가족 · ' + (NAMES[m.from] || '가족'), body: String(m.text).slice(0, 200)},
    webpush: {
      notification: {icon: APP_URL + 'icon-192.png', tag: 'hafamily-chat', renotify: true},
      fcmOptions: {link: APP_URL + '#chat'},
    },
  });
  // 앱을 지웠거나 알림을 끈 기기는 목록에서 정리
  const stale = [];
  res.responses.forEach((r, i) => {
    const code = (r.error && r.error.code) || '';
    if (!r.success && /registration-token-not-registered|invalid-registration-token/.test(code)) stale.push(targets[i].ref.delete());
  });
  await Promise.all(stale);
});

/* ---------- 구글 캘린더 가져오기 ---------- */
async function syncCalendar() {
  const db = getFirestore();
  const ref = db.doc(FAMILY);
  const snap = await ref.get();
  const settings = (snap.exists && snap.get('settings')) || {};
  let url = String(settings.gcalUrl || '').trim();
  if (!url) return {skipped: 'no url'};
  if (/^webcal:\/\//i.test(url)) url = 'https://' + url.slice(9);
  if (!/^https:\/\//i.test(url)) {
    await ref.update({'settings.gcalErr': '주소가 https로 시작해야 해요.', 'settings.gcalAt': Date.now()});
    return {error: 'bad url'};
  }
  const tz = settings.tz || 'America/New_York';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    const res = await fetch(url, {signal: ctl.signal, redirect: 'follow'});
    clearTimeout(timer);
    if (!res.ok) throw new Error('캘린더 주소에서 ' + res.status + ' 응답이 왔어요');
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('캘린더 파일이 아니에요. 비공개 주소(iCal 형식)인지 확인해 주세요');
    const items = parseICS(text, {tz, now: Date.now(), backDays: 7, forwardDays: 120});
    const gcal = {};
    items.forEach((x, i) => {
      const o = {date: x.date, t: String(x.t).slice(0, 60), who: 'all'};
      if (x.end) o.end = x.end;
      if (x.time) o.time = x.time;
      gcal['g' + i] = o;
    });
    await ref.update({gcal, 'settings.gcalAt': Date.now(), 'settings.gcalErr': '', 'settings.gcalCount': items.length});
    return {count: items.length};
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '캘린더를 불러오는 데 너무 오래 걸렸어요' : (e && e.message) || String(e);
    await ref.update({'settings.gcalErr': String(msg).slice(0, 200), 'settings.gcalAt': Date.now()});
    return {error: msg};
  }
}

// 한 시간마다 자동으로
exports.syncCalendarHourly = onSchedule({schedule: 'every 60 minutes', timeZone: 'America/New_York'}, async () => {
  await syncCalendar();
});

// 앱에서 "지금 가져오기"를 누르면 (settings.gcalPing 이 바뀔 때만)
exports.syncCalendarOnPing = onDocumentUpdated('families/main', async (event) => {
  const before = event.data.before.get('settings') || {};
  const after = event.data.after.get('settings') || {};
  if (before.gcalPing === after.gcalPing && before.gcalUrl === after.gcalUrl) return;
  await syncCalendar();
});

/* ---------- 일요일 밤, 이번 주 기록을 가족방에 ---------- */
exports.weeklyReport = onSchedule({schedule: '0 20 * * 0', timeZone: TZ}, async () => {
  const db = getFirestore();
  const snap = await db.doc(FAMILY).get();
  if (!snap.exists) return;
  const data = snap.data() || {};
  if ((data.settings || {}).weeklyReport === false) return;
  const text = weeklyText(data, todayIn((data.settings || {}).tz || TZ), ['eun', 'yeon']);
  if (!text) return;
  await db.collection('families/main/messages').add({
    from: 'report', text, quick: false, dev: 'server', ts: FieldValue.serverTimestamp(),
  });
});
