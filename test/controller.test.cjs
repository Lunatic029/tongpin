// Executes the real app controller with lightweight DOM/Android adapters.
// These tests cover state transitions and async races, not browser layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../app/src/main/assets/core.js');
const source = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/app.js'), 'utf8');

function app(initial = C.defaults()) {
  const listeners = {}, elements = new Map(), timers = new Map();
  let timerId = 0, selections = [], persisted = structuredClone(initial);
  const requests = [], cancelled = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', value: '', checked: false, disabled: false, isConnected: true,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0, selectionStart: 0,
      focus() {}, setSelectionRange() {}, id: selector.startsWith('#') ? selector.slice(1) : ''
    });
    return elements.get(selector);
  };
  const document = {
    activeElement: null, hidden: false,
    querySelector: element,
    querySelectorAll: selector => selector.startsWith('.role-check:checked') ? selections.map(value => ({ value })) : [],
    addEventListener: (name, listener) => { listeners[name] = listener; }
  };
  const window = {
    TongpinCore: C,
    TongpinNative: {
      load: () => JSON.stringify({ hasKey: true, state: initial }),
      save: text => { persisted = JSON.parse(text); return '{"ok":true}'; },
      request: (id, body) => requests.push({ id, body: JSON.parse(body) }),
      cancel: id => cancelled.push(id),
      saveKey: () => '{"ok":true}'
    }
  };
  const sandbox = { window, document, TextEncoder, Date, Math, console,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(source, sandbox, { filename: 'app.js' });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    requests, cancelled, element, state: () => persisted,
    select: values => { selections = values; },
    async click(action, data = {}) {
      const button = { dataset: { action, ...data }, disabled: false, isConnected: true };
      listeners.click({ target: { closest: () => button } });
      await flush();
    },
    input(id, value) {
      const target = element('#' + id); target.value = value;
      listeners.input({ target });
    },
    async send(value) {
      this.input('composer', value);
      listeners.submit({ target: { id: 'compose-form' }, preventDefault() {} });
      await flush();
    },
    async reply(id, content) { window.__nativeReply({ id, ok: true, content }); await flush(); },
    async fireDelay(ms) {
      const match = [...timers].find(([, t]) => t.ms === ms);
      assert.ok(match, `timer ${ms} exists`);
      timers.delete(match[0]); match[1].fn(); await flush();
    },
    import(text) { window.__nativeImport({ data: text }); }
  };
}

test('switching groups cancels in-flight replies and ignores late native callbacks', async () => {
  const state = C.defaults();
  const second = C.createGroup(state, '第二群', '', ['lin']);
  const ui = app(state);
  await ui.send('@林澈 第一群的问题');
  assert.equal(ui.requests.length, 1);
  const oldRequest = ui.requests[0].id;
  await ui.click('switch-group', { id: second.id });
  assert.deepEqual(ui.cancelled, [oldRequest]);
  await ui.reply(oldRequest, '迟到的第一群回复');
  assert.equal(C.getGroup(ui.state(), 'g_default').messages.length, 1);
  assert.equal(C.getGroup(ui.state(), second.id).messages.length, 0);
  await ui.send('第二群的问题');
  assert.equal(ui.requests.length, 2);
  assert.ok(!JSON.stringify(ui.requests[1].body).includes('第一群的问题'));
  await ui.reply(ui.requests[1].id, '第二群的回复');
  assert.equal(C.getGroup(ui.state(), second.id).messages.at(-1).text, '第二群的回复');
});

test('switching during inter-reply delay cannot start the old group next speaker', async () => {
  const state = C.defaults();
  const second = C.createGroup(state, '第二群', '', ['lin']);
  const ui = app(state);
  await ui.send('来聊聊');
  await ui.reply(ui.requests[0].id, '第一位成员的回复');
  await ui.click('switch-group', { id: second.id });
  await ui.fireDelay(350);
  assert.equal(ui.requests.length, 1);
  assert.equal(C.getGroup(ui.state(), 'g_default').messages.length, 2);
  assert.equal(C.getGroup(ui.state(), second.id).messages.length, 0);
});

test('group creation, reuse of library roles, and separate drafts work through app actions', async () => {
  const ui = app();
  ui.input('composer', '第一群还没发送的草稿');
  await ui.click('create-group');
  ui.element('#group-name').value = '周末电影群';
  ui.element('#group-topic').value = '聊电影';
  ui.select(['lin', 'man']);
  await ui.click('save-group');
  const second = C.getGroup(ui.state());
  assert.equal(second.name, '周末电影群');
  assert.equal(second.topic, '聊电影');
  assert.deepEqual(second.memberIds, ['lin', 'man']);
  assert.equal(ui.state().members.length, 4);
  assert.ok(!ui.element('#screen').innerHTML.includes('第一群还没发送的草稿'));
  ui.input('composer', '第二群的草稿');
  await ui.click('switch-group', { id: 'g_default' });
  assert.ok(ui.element('#screen').innerHTML.includes('第一群还没发送的草稿'));
  await ui.click('switch-group', { id: second.id });
  assert.ok(ui.element('#screen').innerHTML.includes('第二群的草稿'));
  await ui.click('add-existing');
  ui.select(['xia']);
  await ui.click('add-selected');
  assert.deepEqual(C.getGroup(ui.state()).memberIds, ['lin', 'man', 'xia']);
  assert.equal(ui.state().members.length, 4);
});

test('group removal preserves shared role; library deletion removes all memberships', async () => {
  const state = C.defaults();
  const second = C.createGroup(state, '第二群', '', ['lin']);
  const ui = app(state);
  await ui.click('edit-member', { id: 'lin' });
  await ui.click('remove-member');
  await ui.click('confirm');
  assert.ok(!C.getGroup(ui.state(), 'g_default').memberIds.includes('lin'));
  assert.ok(C.getGroup(ui.state(), second.id).memberIds.includes('lin'));
  assert.ok(ui.state().members.some(m => m.id === 'lin'));
  await ui.click('edit-member', { id: 'lin' });
  await ui.click('delete-role');
  await ui.click('confirm');
  assert.ok(ui.state().groups.every(g => !g.memberIds.includes('lin')));
  assert.ok(!ui.state().members.some(m => m.id === 'lin'));
});

test('restoring a multi-group backup cancels outstanding generation and clears stale drafts', async () => {
  const ui = app();
  await ui.send('旧内容');
  const oldId = ui.requests[0].id;
  const restored = C.defaults();
  const second = C.createGroup(restored, '恢复的群', '备份中的群', ['xia']);
  C.switchGroup(restored, second.id);
  ui.import(C.encodeBackup(restored));
  await ui.click('confirm');
  await ui.reply(oldId, '恢复前的迟到回复');
  assert.equal(C.getGroup(ui.state()).name, '恢复的群');
  assert.ok(ui.state().groups.every(g => g.messages.length === 0));
});
