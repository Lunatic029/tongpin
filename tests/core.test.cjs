const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../app/src/main/assets/core.js');

test('only enabled members speak; a mention is first and no consecutive repeats with multiple members', () => {
  const state = C.defaults();
  C.setMemberEnabled(state, state.activeGroupId, state.members[2].id, false);
  const selected = C.chooseSpeakers(C.groupMembers(state), 6, '@知夏 想听你的看法', () => .1);
  assert.equal(selected.length, 6);
  assert.equal(selected[0].name, '知夏');
  assert.ok(selected.every(m => m.enabled));
  assert.ok(selected.every((m, i) => i === 0 || m.id !== selected[i - 1].id));
  assert.deepEqual(C.chooseSpeakers([], 3), []);
  assert.equal(C.chooseSpeakers([C.groupMembers(state)[0]], 6).length, 6);
});

test('prompts include distinct identities and latest conversation, exclude demo and system events', () => {
  const state = C.defaults();
  C.getGroup(state).messages = [
    { kind: 'system', text: 'system event' },
    { kind: 'user', name: '我', text: 'demo secret', demo: true },
    { kind: 'bot', name: '小满', text: 'demo reply', demo: true },
    { kind: 'user', name: '我', text: '周末想去海边' },
    { kind: 'bot', name: '小满', text: '我想带点水果！' }
  ];
  const request = C.buildRequest(state, state.members[0]);
  assert.match(request.messages[0].content, /林澈/);
  assert.match(request.messages[0].content, /沉稳、细腻/);
  const context = JSON.parse(request.messages[1].content).conversation;
  assert.equal(context.length, 2);
  assert.equal(context[1].sender, '小满');
  assert.match(context[0].content, /海边/);
  assert.equal(request.stream, false);
  assert.equal(request.temperature, .9);
  state.settings.model = 'deepseek-reasoner';
  assert.equal('temperature' in C.buildRequest(state, state.members[0]), false);
});

test('context is bounded, keeps recent messages, and does not expose avatars', () => {
  const state = C.defaults();
  C.getGroup(state).messages = Array.from({ length: 100 }, (_, i) => ({ kind: 'user', name: '我', text: `${i}:` + 'x'.repeat(1500) }));
  state.members[0].photo = 'data:image/jpeg;base64,AAA=';
  const request = C.buildRequest(state, state.members[0]);
  assert.ok(request.messages[1].content.length < 24500);
  assert.match(request.messages[1].content, /99:/);
  assert.ok(!JSON.stringify(request).includes('base64'));
});

test('backup roundtrip retains profiles/messages and rejects invalid and oversized data', () => {
  const state = C.defaults();
  C.getGroup(state).messages = [{ id: 'a', at: Date.now(), kind: 'user', name: '我', text: '<script>anything</script>' }];
  const restored = C.decodeBackup(C.encodeBackup(state));
  assert.equal(restored.members[0].personality, state.members[0].personality);
  assert.equal(C.getGroup(restored).messages[0].text, C.getGroup(state).messages[0].text);
  assert.throws(() => C.decodeBackup('{broken'));
  assert.throws(() => C.decodeBackup(JSON.stringify({ app: 'something', version: 1, state })));
  assert.throws(() => C.decodeBackup(' '.repeat(6000001)));
  assert.throws(() => C.normalizeState({ ...state, members: Array(51).fill(state.members[0]) }));
  assert.throws(() => C.normalizeState({ ...state, members: [state.members[0], state.members[0]] }));
});

test('untrusted backup fields are constrained and unexpected settings are discarded', () => {
  const state = C.defaults();
  state.settings.apiKey = 'do-not-import';
  state.settings.replies = 100;
  state.settings.model = 'unknown';
  state.members[0].photo = 'https://tracker.example/photo.jpg';
  state.members[0].color = 'red;anything';
  const clean = C.normalizeState(state);
  assert.equal(clean.settings.replies, 6);
  assert.equal(clean.settings.model, 'deepseek-chat');
  assert.equal(clean.members[0].photo, '');
  assert.equal(clean.members[0].color, 'sage');
  assert.equal('apiKey' in clean.settings, false);
});

test('legacy single-group data migrates without losing settings, messages or paused members', () => {
  const source = C.defaults();
  const legacy = { version: 1, settings: { ...source.settings, groupName: '旧群', topic: '旧群背景' },
    members: source.members.map((m, i) => ({ ...m, enabled: i !== 1 })),
    messages: [{ id: 'old', kind: 'bot', memberId: 'lin', name: '林澈', text: '原来的消息', at: 1000 }] };
  const before = JSON.stringify(legacy);
  const migrated = C.normalizeState(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.groups.length, 1);
  assert.equal(C.getGroup(migrated).name, '旧群');
  assert.equal(C.getGroup(migrated).topic, '旧群背景');
  assert.equal(C.getGroup(migrated).messages[0].text, '原来的消息');
  assert.equal(C.groupMembers(migrated)[1].enabled, false);
  assert.equal(migrated.members[1].enabled, undefined);
  assert.equal(JSON.stringify(legacy), before);
  const restored = C.decodeBackup(JSON.stringify({ app: 'tongpin', version: 1, state: legacy }));
  assert.deepEqual(restored, migrated);
});

test('existing roles can join several groups without duplicating or leaking conversation', () => {
  const state = C.defaults();
  const first = C.getGroup(state);
  first.messages.push({ kind: 'user', name: '我', text: '第一群私有内容' });
  const second = C.createGroup(state, '读书会', '只讨论小说', ['lin', 'xia']);
  C.switchGroup(state, second.id);
  second.messages.push({ kind: 'user', name: '我', text: '第二群的书籍话题' });
  assert.equal(state.members.length, 4);
  assert.deepEqual(C.groupMembers(state).map(m => m.id), ['lin', 'xia']);
  const request = C.buildRequest(state, state.members[0]);
  const full = JSON.stringify(request);
  assert.match(full, /第二群的书籍话题/);
  assert.match(full, /读书会/);
  assert.match(full, /只讨论小说/);
  assert.ok(!full.includes('第一群私有内容'));
  assert.ok(!request.messages[0].content.includes('小满'));
  C.switchGroup(state, first.id);
  assert.equal(C.getGroup(state).messages.length, 1);
  assert.equal(C.getGroup(state).messages[0].text, '第一群私有内容');
});

test('shared edits propagate, but pausing a member affects only the selected group', () => {
  const state = C.defaults();
  const firstId = state.activeGroupId;
  const second = C.createGroup(state, '第二群', '', ['lin']);
  C.saveRole(state, { ...state.members[0], name: '林老师', personality: '喜欢天文学，严谨风趣。', photo: 'data:image/jpeg;base64,AAA=' });
  assert.equal(C.groupMembers(state, firstId)[0].name, '林老师');
  assert.equal(C.groupMembers(state, second.id)[0].personality, '喜欢天文学，严谨风趣。');
  assert.equal(C.groupMembers(state, second.id)[0].photo, 'data:image/jpeg;base64,AAA=');
  C.setMemberEnabled(state, second.id, 'lin', false);
  assert.equal(C.groupMembers(state, firstId)[0].enabled, true);
  assert.equal(C.groupMembers(state, second.id)[0].enabled, false);
  assert.throws(() => C.buildRequest(state, state.members[0], '', second.id), /未在此群/);
});

test('removing from one group preserves the role, other memberships and old messages', () => {
  const state = C.defaults();
  const first = C.getGroup(state);
  first.messages.push({ kind: 'bot', memberId: 'lin', text: '旧消息' });
  const second = C.createGroup(state, '第二群', '', ['lin']);
  C.removeMember(state, first.id, 'lin');
  assert.equal(state.members.length, 4);
  assert.ok(!first.memberIds.includes('lin'));
  assert.ok(second.memberIds.includes('lin'));
  assert.equal(first.messages.length, 1);
  C.addMembers(state, first.id, ['lin', 'lin']);
  assert.equal(first.memberIds.filter(id => id === 'lin').length, 1);
});

test('deleting a group leaves the shared library and other groups intact', () => {
  const state = C.defaults();
  const firstId = state.activeGroupId;
  const second = C.createGroup(state, '临时群', '', ['lin']);
  C.switchGroup(state, second.id);
  C.deleteGroup(state, second.id);
  assert.equal(state.activeGroupId, firstId);
  assert.equal(state.members.length, 4);
  assert.throws(() => C.deleteGroup(state, firstId), /至少保留/);
  assert.throws(() => C.switchGroup(state, 'missing'), /不存在/);
});

test('deleting a library role removes all memberships and mute entries but retains history', () => {
  const state = C.defaults();
  const second = C.createGroup(state, '第二群', '', ['lin']);
  C.setMemberEnabled(state, second.id, 'lin', false);
  second.messages.push({ kind: 'bot', memberId: 'lin', text: '留存的消息' });
  C.deleteRole(state, 'lin');
  assert.ok(state.groups.every(g => !g.memberIds.includes('lin') && !g.mutedMemberIds.includes('lin')));
  assert.ok(!state.members.some(m => m.id === 'lin'));
  assert.equal(second.messages.length, 1);
});

test('multi-group backup retains active group, histories, shared roles and per-group mute state', () => {
  const state = C.defaults();
  const second = C.createGroup(state, '第二群', '独立背景', ['lin', 'xia']);
  C.switchGroup(state, second.id);
  C.setMemberEnabled(state, second.id, 'xia', false);
  second.messages.push({ id: 'example', kind: 'user', name: '我', text: '第二群消息', at: 1000 });
  const restored = C.decodeBackup(C.encodeBackup(state));
  assert.equal(restored.activeGroupId, second.id);
  assert.equal(restored.groups.length, 2);
  assert.equal(restored.members.length, 4);
  assert.equal(C.getGroup(restored).messages[0].text, '第二群消息');
  assert.equal(C.groupMembers(restored)[1].enabled, false);
  assert.equal(C.getGroup(restored, 'g_default').messages.length, 0);
});

test('invalid references, duplicate groups, missing groups and malformed mute states are rejected', () => {
  const state = C.defaults();
  const invalid = change => { const next = structuredClone(state); change(next); assert.throws(() => C.normalizeState(next)); };
  invalid(s => s.groups[0].memberIds.push('unknown-role'));
  invalid(s => s.groups[0].memberIds.push('lin'));
  invalid(s => s.groups.push(s.groups[0]));
  invalid(s => s.groups = []);
  invalid(s => s.groups[0].mutedMemberIds.push('unknown-role'));
  invalid(s => s.groups[0].messages = null);
  assert.equal(C.normalizeState({ ...state, activeGroupId: 'stale' }).activeGroupId, 'g_default');
});

test('capacity and membership failures leave the original state unchanged', () => {
  const state = C.defaults();
  const full = C.createGroup(state, '满员群', '');
  for (let i = 0; i < 21; i++) C.saveRole(state, { id: 'role_' + i, name: '角色' + i });
  C.addMembers(state, full.id, state.members.slice(0, 20).map(m => m.id));
  const before = JSON.stringify(state);
  assert.throws(() => C.addMembers(state, full.id, ['role_20']), /20/);
  assert.throws(() => C.createGroup(state, '坏群', '', ['missing']), /有效角色/);
  assert.equal(JSON.stringify(state), before);
  while (state.groups.length < C.LIMITS.groups) C.createGroup(state, '群' + state.groups.length, '');
  assert.throws(() => C.createGroup(state, '超限群', ''), /20/);
});

test('same-name roles and groups are rejected; empty groups can be populated later', () => {
  const state = C.defaults();
  assert.throws(() => C.saveRole(state, { id: 'new', name: '林澈' }), /同名/);
  assert.throws(() => C.createGroup(state, '松弛感研究所', ''), /同名/);
  assert.throws(() => C.createGroup(state, '   ', ''), /填写/);
  const empty = C.createGroup(state, '新群', '');
  assert.equal(C.groupMembers(state, empty.id).length, 0);
  C.addMembers(state, empty.id, ['man']);
  assert.equal(C.groupMembers(state, empty.id)[0].name, '小满');
});
