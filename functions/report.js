// 일요일 밤에 가족방으로 보낼 "이번 주 기록"을 만들어요.
// 앱 화면의 주간 리포트와 같은 규칙으로 셉니다.

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const dnum = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY);
const fromDnum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();

// 그 날짜에 하기로 되어 있던 할 일
function tasksOn(tasks, who, d) {
  return Object.entries(tasks || {})
    .filter(([, t]) => t && t.who === who)
    .filter(([id, t]) => {
      if (t.daily) {
        if (!(t.from <= d)) return false;
        if (t.stop && d >= t.stop) return false;
        if (t.wk) {
          const w = dow(d);
          if (w === 0 || w === 6) return false;
        }
        if (Array.isArray(t.days) && !t.days.includes(dow(d))) return false;
        if (Array.isArray(t.skip) && t.skip.includes(d)) return false;
        return true;
      }
      return t.date === d;
    })
    .map(([id, t]) => ({id, t}));
}
const isDone = (done, d, id) => !!(done && done[d] && done[d][id]);

function weekRange(todayStr) {
  const w = dow(todayStr);
  const start = fromDnum(dnum(todayStr) - (w === 0 ? 6 : w - 1));
  return {start, end: fromDnum(dnum(start) + 6)};
}

function statsFor(data, who, start, end) {
  const tasks = data.tasks || {}, done = data.done || {}, timers = data.timers || {};
  let plan = 0, got = 0, sec = 0, fullDays = 0;
  const per = {};
  for (let x = dnum(start); x <= dnum(end); x++) {
    const k = fromDnum(x);
    const list = tasksOn(tasks, who, k);
    if (!list.length) continue;
    let a = 0;
    list.forEach(({id, t}) => {
      plan++;
      const d1 = isDone(done, k, id);
      if (d1) {
        got++;
        a++;
      }
      per[id] = per[id] || {name: t.t, plan: 0, done: 0};
      per[id].plan++;
      if (d1) per[id].done++;
      const z = timers[k] && timers[k][id];
      if (z && z.sec) sec += z.sec;
    });
    if (a === list.length) fullDays++;
  }
  return {plan, got, sec, fullDays, per};
}

const hm2 = (s) => {
  const n = Math.max(0, Math.round(s / 60)), h = Math.floor(n / 60), m = n % 60;
  return (h ? h + '시간 ' : '') + (m || !h ? m + '분' : '');
};
const md = (d) => +d.slice(5, 7) + '/' + +d.slice(8, 10);

// 아이들 기록을 한 통의 메시지로
function weeklyText(data, todayStr, kids) {
  const {start, end} = weekRange(todayStr);
  const faces = data.faces || {};
  const names = {mom: '엄마', dad: '아빠', eun: '은우', yeon: '연우'};
  const blocks = [];
  for (const who of kids) {
    const s = statsFor(data, who, start, end);
    if (!s.plan) continue;
    const rows = Object.values(s.per).sort((a, b) => (b.done / b.plan) - (a.done / a.plan) || b.plan - a.plan);
    const best = rows[0], worst = rows[rows.length - 1];
    let t = (faces[who] || '') + ' ' + (names[who] || who) + '\n';
    t += `할 일 ${s.got}/${s.plan} (${Math.round(s.got / s.plan * 100)}%) · 다 한 날 ${s.fullDays}일`;
    if (s.sec) t += `\n공부 ${hm2(s.sec)}`;
    if (best && best.done) t += `\n잘한 것: ${best.name} ${best.done}/${best.plan}`;
    if (worst && worst !== best && worst.done < worst.plan) t += `\n더 해볼 것: ${worst.name} ${worst.done}/${worst.plan}`;
    blocks.push(t);
  }
  if (!blocks.length) return null;
  return `📊 이번 주 기록 (${md(start)}~${md(end)})\n\n` + blocks.join('\n\n');
}

module.exports = {weeklyText, weekRange, statsFor, tasksOn};
