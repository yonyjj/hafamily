// 가족방에 새 메시지가 올라오면, 보낸 사람과 보낸 기기를 뺀 가족 기기에 알림을 보내요.
const {onDocumentCreated} = require('firebase-functions/v2/firestore');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');

initializeApp();
const APP_URL = 'https://yonyjj.github.io/hafamily/';
const NAMES = {mom: '엄마', dad: '아빠', eun: '은우', yeon: '연우'};

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
