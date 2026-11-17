import assert from 'node:assert/strict';
import { t, getLanguage, setLanguage } from '../src/i18n.js';

const originalLanguage = getLanguage();
const liveMessages = [
  '教学 3/3 · 退后离开录放机至少 3 米（当前 2.7 米）。',
  '自记仪走纸中（17s）· 在远处放置诱饵引开水下声源。',
  '按住 E 转动手轮 · 已锁 2/3 档（松手不回退）',
  '按住 E 泄压 · 已锁 1/3 档（水声靠近可松手撤离）',
  '倒计时 3.8s 后原地回放 · 趁现在离开',
  '磁带就绪（12 处声响）· Q 放下诱饵 / R 重录',
  '已录入磁带（含 2 次金属敲击）。走到目标位置按 Q 放下诱饵。',
  '已录入磁带（含 4 段脚步/环境声）。走到目标位置按 Q 放下诱饵。',
  '〔前方〕 磁带回放 · 清脆金属敲击',
  '[ 按住 E ] 关闭进水隔离阀',
  '末端自记控制室 · 水密闸门\n断电闭锁（西侧合闸送电后升起）',
  '站内检修停电期间，依靠敲击悬钟与传声管联络。钢格栅和积水会把大声响传遍整座下层泵房。'
];
for (const source of liveMessages) {
  const english = t(source, 'en');
  assert(!/[\u3400-\u9fff]/.test(english), `Untranslated player text: ${source}`);
  assert.equal(t(source, 'zh-CN'), source, 'Chinese source copy is preserved exactly');
}
assert(t(liveMessages[0], 'en').includes('2.7'), 'Retreat distance survives translation');
assert(t(liveMessages[1], 'en').includes('17'), 'Countdown survives translation');
assert(t(liveMessages[2], 'en').includes('2/3'), 'Valve detent count survives translation');
const menuSource = '值班已暂停。<br><small>环境声音、磁带倒计时与水下移动均已冻结。</small>';
assert(t(menuSource, 'en').includes('<br><small>'), 'Trusted authored menu markup remains intact');
setLanguage('en');
assert.equal(getLanguage(), 'en');
assert.equal(t('常步'), 'Walk');
setLanguage('zh-CN');
assert.equal(t('常步'), '常步', 'Switching back uses original copy');
assert.equal(t('P-02 / CH-1', 'en'), 'P-02 / CH-1', 'Equipment identifiers stay unchanged');
const previousStorage = globalThis.localStorage;
try {
  globalThis.localStorage = { setItem() { throw new Error('SecurityError'); } };
  setLanguage('en');
  assert.equal(getLanguage(), 'en', 'Language still changes when browser storage is denied');
} finally {
  globalThis.localStorage = previousStorage;
  setLanguage(originalLanguage);
}
console.log('PASS localization: live counts, nested sound captions, station signs/documents, reversible language and denied storage');
