(() => {
  'use strict';
  const C = window.TongpinCore, native = window.TongpinNative;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paths = {
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 11h8m-8 4h5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="m9 5 7 7-7 7"/>',
    send: '<path d="m12 19 0-14m-6 6 6-6 6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    edit: '<path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/>',
    spark: '<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    mic: '<path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3m-3 0h6"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.chat}</svg>`;
  let state = C.defaults(!native), hasKey = false, loadWarning = '';
  try {
    if (native) {
      const loaded = JSON.parse(native.load());
      hasKey = loaded.hasKey === true;
      if (loaded.state) state = C.normalizeState(loaded.state);
      loadWarning = loaded.error || '';
    } else {
      const saved = localStorage.getItem('tongpin.state.v1');
      if (saved) state = C.normalizeState(JSON.parse(saved));
      state.settings.demo = true;
    }
  } catch { loadWarning = '本地数据读取失败。请从设置导入有效备份。'; }
  const group = () => C.getGroup(state);
  const members = () => C.groupMembers(state);
  const drafts = new Map();
  let memberScope = 'group', editGroupId = null, editJoinCurrent = true;
  let tab = 'chat', draft = '', typing = null, busy = false, epoch = 0, lastError = null;
  let editMember = null, modalType = '', modalReturnFocus = null, toastTimer, confirmAction = null;
  const pending = new Map();

  function toast(text) {
    $('#toast').textContent = text;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
  }
  function save() {
    try {
      const text = JSON.stringify(state);
      if (new TextEncoder().encode(text).length > C.LIMITS.backupBytes - 200) throw new Error('本地资料总量接近 6 MB，请先导出备份并减少旧记录或头像。');
      if (native) {
        const result = JSON.parse(native.save(text));
        if (!result.ok) throw new Error(result.message);
      } else localStorage.setItem('tongpin.state.v1', text);
      return true;
    } catch (e) { toast(e.message || '保存失败，请检查剩余空间。'); return false; }
  }
  function avatar(member, extra = '') {
    return `<span class="avatar ${esc(member.color || 'sage')} ${extra}">${member.photo ? `<img src="${esc(member.photo)}" alt="">` : esc(member.emoji || '🌱')}</span>`;
  }
  function renderHeader() {
    const count = members().filter(m => m.enabled).length;
    const title = tab === 'chat' ? group().name : tab === 'groups' ? '我的群聊' : tab === 'members' ? '群里的朋友' : '我的设置';
    const sub = tab === 'chat' ? `${count} 位虚拟成员 · ${state.settings.demo ? '离线演示' : hasKey ? 'DeepSeek 已配置' : '等待连接 DeepSeek'}` : tab === 'groups' ? `${state.groups.length} 个群聊 · 各有各的故事` : tab === 'members' ? `当前群：${group().name}` : `当前群：${group().name}`;
    $('#header').innerHTML = `<div><h1 class="header-title">${esc(title)}</h1><div class="header-sub"><span class="status-dot"></span>${esc(sub)}</div></div><div class="header-actions">${tab === 'groups' ? `<button class="icon-button" data-action="create-group" aria-label="创建群聊">${icon('plus')}</button>` : tab === 'chat' || tab === 'members' ? `<button class="icon-button" data-action="add-member" aria-label="添加成员">${icon('plus')}</button>${tab === 'chat' ? `<button class="icon-button" data-action="nav" data-tab="groups" aria-label="切换群聊">${icon('users')}</button>` : ''}` : '<span class="brand-symbol">ııı</span>'}</div>`;
    $('#navigation').innerHTML = [['groups','users','群组'],['chat','chat','聊天'],['members','spark','成员'],['settings','settings','设置']].map(([key, glyph, label]) => `<button class="nav-button ${tab === key ? 'active' : ''}" data-action="nav" data-tab="${key}" ${tab === key ? 'aria-current="page"' : ''}><span class="nav-icon">${icon(glyph)}</span>${label}</button>`).join('');
  }
  function messageMarkup(m) {
    if (m.kind === 'system') return `<p class="system-message">${esc(m.text)}</p>`;
    const member = members().find(person => person.id === m.memberId);
    const identity = member || { name: m.name, emoji: m.emoji, color: m.color };
    const time = new Date(m.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `<div class="message ${m.kind}">${m.kind === 'user' ? '<span class="avatar">我</span>' : avatar(identity)}<div class="message-content"><div class="message-label"><span>${esc(m.name)}</span>${m.demo ? '<span class="demo-label">演示</span>' : ''}<time>${esc(time)}</time></div><div class="bubble">${esc(m.text)}</div></div></div>`;
  }
  function renderChat() {
    if (tab !== 'chat') return;
    const previous = $('.chat-scroll');
    const oldScroll = previous?.scrollTop || 0;
    const nearBottom = !previous || previous.scrollHeight - previous.scrollTop - previous.clientHeight < 100;
    const focused = document.activeElement?.id === 'composer';
    const cursor = focused ? document.activeElement.selectionStart : 0;
    const active = members().filter(m => m.enabled);
    const content = group().messages.length ? `<div class="date-label">聊到哪里，都算相遇</div>${group().messages.length > 150 ? '<p class="system-message">展示最近 150 条消息，完整记录可在设置中导出。</p>' : ''}${group().messages.slice(-150).map(messageMarkup).join('')}` : `<div class="welcome"><div class="welcome-icon">✳</div><span class="eyebrow">YOUR LITTLE SOCIAL UNIVERSE</span><h2>有些话，总有人接得住。</h2><p>这里有 ${members().length} 位性格各异的虚拟朋友。<br>聊聊日常，分享脑洞，或者什么都不想。</p><div class="starter-list"><button class="starter" data-action="starter" data-text="大家今天有没有遇到什么有趣的小事？"><span>☀️</span>聊聊今天的小事<span>↗</span></button><button class="starter" data-action="starter" data-text="如果能开一家不用考虑赚钱的小店，你们想开什么？"><span>🪐</span>来一个不着边际的脑洞<span>↗</span></button><button class="starter" data-action="starter" data-text="最近有点累，你们会怎么给自己充电？"><span>🌿</span>想听听你们的建议<span>↗</span></button></div><div class="intro-note">你可以在「成员」里，定义每一个人的模样。</div></div>`;
    $('#screen').innerHTML = `<div class="member-strip"><button class="avatar-stack" data-action="nav" data-tab="members" aria-label="查看群成员">${members().slice(0, 5).map(m => avatar(m)).join('')}${members().length > 5 ? `<span class="avatar">+${members().length - 5}</span>` : ''}</button><button class="strip-info" data-action="nav" data-tab="members">${active.length} 位参与聊天 ${icon('arrow')}</button></div>${state.settings.demo ? '<div class="mode-banner"><span>离线演示 · 示例回复不调用 AI</span><button data-action="nav" data-tab="settings">连接 DeepSeek ↗</button></div>' : !hasKey ? '<div class="mode-banner"><span>填写 API Key，开始真实 AI 群聊</span><button data-action="nav" data-tab="settings">去设置 ↗</button></div>' : ''}<div class="chat-scroll" role="log" aria-label="聊天记录" aria-live="polite">${content}${typing ? `<div class="message">${avatar(typing)}<div class="message-content"><div class="message-label">${esc(typing.name)} 正在输入…</div><div class="bubble typing-bubble"><i></i><i></i><i></i></div></div></div>` : ''}${lastError ? `<div class="error-bar" role="alert">${esc(lastError.message)}<button data-action="retry">重试这条回复</button><button data-action="dismiss-error">关闭</button></div>` : ''}</div><div class="composer-area"><div class="chat-tools">${busy ? `<button class="small-button stop" data-action="stop">${icon('stop')} 停止回复</button>` : `<button class="small-button" data-action="continue">${icon('spark')} 让大家聊聊</button>`}<button class="small-button" data-action="pick-speaker" ${busy ? 'disabled' : ''}>${icon('mic')} 邀请发言</button><span class="reply-count">每轮 ${state.settings.replies} 条</span></div><form id="compose-form" class="composer"><label for="composer" class="sr-only">发送消息</label><textarea id="composer" rows="1" maxlength="2000" placeholder="说点什么，或 @一位朋友…">${esc(draft)}</textarea><button class="send-button" type="submit" aria-label="发送消息" ${busy ? 'disabled' : ''}>${icon('send')}</button></form></div>`;
    const scroller = $('.chat-scroll');
    scroller.scrollTop = nearBottom ? scroller.scrollHeight : oldScroll;
    if (focused) { $('#composer').focus(); $('#composer').setSelectionRange(cursor, cursor); }
  }
  function renderGroups() {
    $('#screen').innerHTML = `<div class="scroll-page"><div class="page-intro"><div><h2>每个群，一段新故事。</h2><p>让熟悉的朋友，在不同的小圈子里相遇。</p></div><span class="count-pill">${state.groups.length} / ${C.LIMITS.groups}</span></div><div class="group-list">${state.groups.map(g => {
      const last = g.messages.filter(m => m.kind !== 'system').at(-1);
      return `<article class="group-card ${g.id === state.activeGroupId ? 'selected' : ''}"><button class="group-open" data-action="switch-group" data-id="${esc(g.id)}"><div class="group-icon">${icon('chat')}</div><div class="group-copy"><h3>${esc(g.name)}</h3><p>${esc(last ? `${last.name}：${last.text}` : g.topic || '还没有消息，来打个招呼吧。')}</p><small>${g.memberIds.length} 位成员 · ${g.messages.length} 条消息${g.id === state.activeGroupId ? ' · 当前群' : ''}</small></div>${icon('arrow')}</button><div class="group-actions"><button class="small-button" data-action="edit-group" data-id="${esc(g.id)}">${icon('edit')} 编辑群聊</button><button class="small-button danger-text" data-action="delete-group" data-id="${esc(g.id)}" ${state.groups.length === 1 ? 'disabled' : ''}>${icon('trash')} 删除群聊</button></div></article>`;
    }).join('')}</div><button class="button primary full spaced" data-action="create-group" ${state.groups.length >= C.LIMITS.groups ? 'disabled' : ''}>${icon('plus')} 创建新群聊</button><p class="page-hint">各群独立保存消息和群聊背景。<br>同一个角色可以加入多个群，名字、头像和性格统一管理。</p></div>`;
  }
  function renderMembers() {
    const library = memberScope === 'library';
    const collection = library ? state.members : members();
    $('#screen').innerHTML = `<div class="scroll-page"><div class="segmented" aria-label="成员范围"><button data-action="member-scope" data-scope="group" class="${library ? '' : 'active'}">本群成员 ${members().length}</button><button data-action="member-scope" data-scope="library" class="${library ? 'active' : ''}">角色库 ${state.members.length}</button></div><div class="page-intro"><div><h2>${library ? '熟悉的朋友，随时相聚。' : '有趣的人，在这里。'}</h2><p>${library ? '角色可以加入多个群，资料同步更新。' : esc(group().name) + ' · 休息状态仅对本群生效。'}</p></div><span class="count-pill">${collection.length} / ${library ? C.LIMITS.roles : C.LIMITS.groupMembers}</span></div>${!library ? `<button class="button secondary full member-add-existing" data-action="add-existing">${icon('users')} 从角色库添加</button>` : ''}<div class="member-grid">${collection.map(m => `<button class="member-card ${!library && !m.enabled ? 'paused' : ''}" data-action="edit-member" data-id="${esc(m.id)}"><span class="card-edit">${icon('edit')}</span>${avatar(m)}<h3>${esc(m.name)}</h3><p>${esc(m.tagline || m.personality.slice(0, 35))}</p><span class="member-presence"><i></i>${library ? `已加入 ${state.groups.filter(g => g.memberIds.includes(m.id)).length} 个群` : m.enabled ? '参与聊天' : '暂时休息'} · 活跃度 ${m.activity}</span></button>`).join('')}${state.members.length < C.LIMITS.roles && (library || members().length < C.LIMITS.groupMembers) ? `<button class="member-card add-card" data-action="new-role" data-join="${!library}"><span class="plus-circle">+</span>创建新角色</button>` : ''}</div><p class="page-hint">${library ? '编辑性格、头像和名字会同步到所有加入的群。<br>从角色库删除，会将其移出所有群，旧消息保留。' : '移出本群会保留角色库资料，也不会影响其他群。<br>你可以随时将这位朋友再次加入。'}</p></div>`;
  }
  function selectGroup(id) {
    drafts.set(state.activeGroupId, draft);
    stop(false);
    C.switchGroup(state, id);
    draft = drafts.get(id) || ''; lastError = null; memberScope = 'group';
    const saved = save(); tab = 'chat'; render(); return saved;
  }
  function roleChoices(existing = []) {
    return state.members.map(m => `<label class="role-choice">${avatar(m)}<span><strong>${esc(m.name)}</strong><small>${existing.includes(m.id) ? '已在本群' : esc(m.tagline || '可加入当前群')}</small></span><input type="checkbox" class="role-check" value="${esc(m.id)}" ${existing.includes(m.id) ? 'checked disabled' : ''} aria-label="选择 ${esc(m.name)}"></label>`).join('') || '<p class="confirm-text">角色库还是空的，可以先创建空群，再添加新角色。</p>';
  }
  function openAddMembers() {
    openModal('添加成员到「' + group().name + '」', `<p class="field-help">复用已有角色，性格与头像会保持同步。每个群最多 20 位成员。</p><div class="role-choices">${roleChoices(group().memberIds)}</div><p id="selection-error" class="inline-error" role="alert"></p>`, '<button class="button secondary" data-action="new-role" data-join="true">创建新角色</button><button class="button primary" data-action="add-selected">添加选中角色</button>', 'add-members');
  }
  function openGroupEditor(id = null) {
    if (!id && state.groups.length >= C.LIMITS.groups) { toast('最多创建 20 个群聊'); return; }
    const target = id ? C.getGroup(state, id) : null;
    editGroupId = id;
    openModal(target ? '编辑群聊' : '创建一个新群聊', `<label class="field"><span>群聊名称</span><input id="group-name" maxlength="30" placeholder="例如：周末电影俱乐部" value="${esc(target?.name || '')}"></label><label class="field"><span>群聊背景</span><textarea id="group-topic" rows="3" maxlength="1000" placeholder="这个群是什么样的聚会？">${esc(target?.topic || '')}</textarea></label>${!target ? `<p class="section-label">邀请角色库里的朋友（可稍后添加）</p><div class="role-choices">${roleChoices()}</div>` : '<p class="field-help">群名与背景只影响这个群，成员可在进入群聊后管理。</p>'}<p id="group-error" class="inline-error" role="alert"></p>`, `<button class="button secondary" data-action="close-modal">取消</button><button class="button primary" data-action="save-group">${target ? '保存群聊' : '创建群聊'}</button>`, 'group-editor');
  }
  function saveGroup() {
    const name = $('#group-name').value.trim(), topic = $('#group-topic').value.trim();
    try {
      if (!name) throw new Error('请填写群聊名称');
      if (state.groups.some(g => g.id !== editGroupId && g.name === name)) throw new Error('已有同名群聊，请换一个名字');
      let target;
      if (editGroupId) {
        stop(false); target = C.getGroup(state, editGroupId); target.name = name; target.topic = topic;
      } else {
        const selected = [...document.querySelectorAll('.role-check:checked')].map(input => input.value);
        target = C.createGroup(state, name, topic, selected);
      }
      const id = target.id;
      closeModal(); if (selectGroup(id)) toast('群聊已保存');
    } catch (e) { $('#group-error').textContent = e.message; }
  }
  function toggle(id, checked, label) { return `<label class="toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} aria-label="${label}"><span></span></label>`; }
  function renderSettings() {
    const s = state.settings;
    $('#screen').innerHTML = `<div class="scroll-page"><p class="section-label">连接与模型</p><div class="settings-card"><div class="settings-heading"><h3>DeepSeek API</h3><span class="badge ${hasKey ? '' : 'off'}">${hasKey ? '已保存密钥' : '未配置'}</span></div><label class="field"><span>API Key</span><div class="key-row"><input id="api-key" type="password" autocomplete="off" spellcheck="false" maxlength="512" placeholder="${hasKey ? '已加密保存，留空不更换' : 'sk-…'}" ${!native ? 'disabled' : ''}><button class="icon-button" data-action="toggle-key" aria-label="显示或隐藏 API Key">${icon('eye')}</button></div><small>${native ? '从 platform.deepseek.com 获取。密钥仅加密保存在本机。' : '浏览器预览仅支持离线演示。请在安卓应用中填写密钥。'}</small></label><div class="button-row"><button class="button secondary" data-action="save-key" ${!native ? 'disabled' : ''}>保存密钥</button><button class="button secondary" data-action="test-api" ${!native || !hasKey ? 'disabled' : ''}>测试连接</button></div>${hasKey ? '<button class="danger-link" data-action="delete-key">删除已保存的密钥</button>' : ''}<div class="divider"></div><label class="field"><span>对话模型</span><select id="setting-model"><option value="deepseek-chat" ${s.model === 'deepseek-chat' ? 'selected' : ''}>DeepSeek Chat · 日常聊天推荐</option><option value="deepseek-reasoner" ${s.model === 'deepseek-reasoner' ? 'selected' : ''}>DeepSeek Reasoner · 回复较慢</option></select></label><label class="field"><span>每轮回复数 <b id="replies-value">${s.replies}</b></span><input type="range" id="setting-replies" min="1" max="6" step="1" value="${s.replies}"><small>每条真实回复调用一次 API，按 DeepSeek 账户用量计费。每轮结束后自动停下。</small></label><label class="field"><span>聊天随机性 <b id="temperature-value">${s.temperature.toFixed(1)}</b></span><input type="range" id="setting-temperature" min="0" max="1.5" step="0.1" value="${s.temperature}"><small>数值越高越发散。Reasoner 模式不使用此参数。</small></label></div><div class="settings-card"><div class="settings-row"><div><h3>离线演示模式</h3><p>使用预置示例体验聊天，不消耗 API 额度。</p></div>${toggle('setting-demo', s.demo, '离线演示模式')}</div></div><p class="section-label">这个群的设定</p><div class="settings-card"><label class="field"><span>群聊名称</span><input id="setting-group" value="${esc(group().name)}" maxlength="30"></label><label class="field"><span>我的昵称</span><input id="setting-user" value="${esc(s.userName)}" maxlength="20"></label><label class="field"><span>群聊背景</span><textarea id="setting-topic" maxlength="1000" rows="3">${esc(group().topic)}</textarea><small>例如：大学同学群、游戏搭子，或一起经营一家咖啡馆。</small></label><button class="button primary full" data-action="save-settings">保存群聊设置</button></div><p class="section-label">记录与备份</p><div class="settings-card"><div class="settings-heading"><h3>本地聊天记录</h3><span class="badge">${group().messages.length} 条</span></div><p class="field-help">每群保留最近 500 条消息。每次回复仅发送当前群最近最多 40 条真实聊天消息及角色设定至 DeepSeek，头像不上传。记录仅保存在此设备；卸载前请导出备份。</p><div class="button-row divider-spaced"><button class="button secondary" data-action="export">${icon('download')} 导出</button><button class="button secondary" data-action="import">${icon('upload')} 导入</button></div><p class="field-help">导出全部群聊、角色库与记录，不包含 API Key。导入会替换本机全部群聊。</p><button class="danger-link" data-action="clear-history">清空本群记录</button></div><div class="app-footer">同频 TONGPIN · 1.1.0<br>虚拟的角色，属于你的聊天空间。</div></div>`;
  }
  function render() { renderHeader(); if (tab === 'chat') renderChat(); else if (tab === 'members') renderMembers(); else if (tab === 'groups') renderGroups(); else renderSettings(); }
  function appendMessage(message) {
    group().messages.push({ id: C.uid(), at: Date.now(), ...message });
    group().messages = group().messages.slice(-500);
    save();
  }
  function request(payload) {
    return new Promise((resolve, reject) => {
      if (!native) return reject(new Error('真实 AI 对话需要在安卓应用中使用。'));
      const id = C.uid();
      const timer = setTimeout(() => {
        native.cancel(id); pending.delete(id); reject(new Error('等待回复超时，请稍后重试。'));
      }, 105000);
      pending.set(id, { resolve, reject, timer });
      try { native.request(id, JSON.stringify(payload)); }
      catch { clearTimeout(timer); pending.delete(id); reject(new Error('无法发起请求，请重启应用后再试。')); }
    });
  }
  window.__nativeReply = result => {
    const task = pending.get(result.id);
    if (!task) return;
    clearTimeout(task.timer); pending.delete(result.id);
    if (result.ok) task.resolve(result); else task.reject(new Error(result.message));
  };
  window.__nativeNotice = value => toast(value.message);
  function stop(announce = true) {
    epoch++; busy = false; typing = null;
    for (const [id, task] of pending) {
      native?.cancel(id); clearTimeout(task.timer); task.reject(new Error('已停止'));
    }
    pending.clear();
    renderChat();
    if (announce) toast('本轮回复已停止');
  }
  const samples = {
    lin: ['有时候散个步就挺管用。把手机放兜里，走到哪儿算哪儿。', '我会开一家只卖二手相机的小店，不过估计会忍不住把好看的都自己留下。', '听你们这么一说，我开始期待这场聊天会拐到哪里了。'],
    man: ['我最近的小快乐是认真吃一顿早餐。煎蛋成功翻面的那一下，真的会有点开心 🍳', '这个想法我喜欢！那我负责带点吃的，大家先把肚子填饱再慢慢聊。', '累的时候就先歇一下嘛，不用连休息都安排得很有成果。'],
    ye: ['我有个不太成熟的想法：要不把今天定义为「允许随便过一天」？', '那我想开一家给人挑背景音乐的小店。进门先问：你今天是喜剧还是冒险片？', '等一下，这个话题是不是已经悄悄跑偏了。挺好，我喜欢这种走向。'],
    xia: ['我今天注意到窗边的植物长出了一片新叶子，很小，但看了好一会儿。', '也许不用马上找到答案。能这样随便聊一会儿，就已经挺好的。', '我想在店里放一张大桌子。有人读书，有人发呆，也不用一直说话。']
  };
  async function run(speakerIds = null, instruction = '') {
    if (busy) return;
    if (!state.settings.demo && (!native || !hasKey)) {
      lastError = { message: '请先在设置中保存 API Key，或开启离线演示。', memberId: null };
      renderChat(); return;
    }
    const latestUser = [...group().messages].reverse().find(m => m.kind === 'user')?.text || '';
    const speakers = speakerIds ? speakerIds.map(id => members().find(m => m.id === id && m.enabled)).filter(Boolean) : C.chooseSpeakers(members(), state.settings.replies, latestUser);
    if (!speakers.length) { toast('先添加一位成员，或让休息中的成员参与聊天。'); return; }
    const current = ++epoch;
    const runGroupId = state.activeGroupId;
    busy = true; lastError = null;
    for (let i = 0; i < speakers.length; i++) {
      if (current !== epoch || state.activeGroupId !== runGroupId) return;
      const member = speakers[i];
      typing = member; renderChat();
      try {
        let result;
        if (state.settings.demo) {
          await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 500));
          const lines = samples[member.id] || ['能认识大家很开心。你们最近在忙什么有趣的事？', '这个角度挺有意思的，我想再听听你们的想法。'];
          const count = group().messages.filter(m => m.memberId === member.id).length;
          result = { content: lines[count % lines.length] };
        } else result = await request(C.buildRequest(state, member, instruction, runGroupId));
        if (current !== epoch || state.activeGroupId !== runGroupId) return;
        appendMessage({ kind: 'bot', memberId: member.id, name: member.name, emoji: member.emoji, color: member.color, text: result.content.slice(0, 6000), demo: state.settings.demo });
        if (result.truncated) toast('回复达到长度限制，已保留收到的内容。');
        typing = null; renderChat();
        if (i < speakers.length - 1) await new Promise(resolve => setTimeout(resolve, 350));
      } catch (e) {
        if (current !== epoch || state.activeGroupId !== runGroupId) return;
        lastError = { message: e.message, memberId: member.id }; break;
      }
    }
    if (current === epoch) { busy = false; typing = null; renderChat(); }
  }
  function send(text = draft) {
    text = text.trim().slice(0, 2000);
    if (!text || busy) return;
    draft = '';
    appendMessage({ kind: 'user', name: state.settings.userName, text, demo: state.settings.demo });
    renderChat();
    const scroll = $('.chat-scroll'); if (scroll) scroll.scrollTop = scroll.scrollHeight;
    run();
  }
  function openModal(title, body, footer, type) {
    modalReturnFocus = document.activeElement;
    modalType = type;
    $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">${icon('close')}</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`;
    $('.modal [data-action="close-modal"]').focus();
  }
  function closeModal() {
    $('#modal-root').innerHTML = ''; modalType = ''; editMember = null; editGroupId = null; confirmAction = null;
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  }
  function confirm(title, text, action, label = '确定') {
    openModal(title, `<p class="confirm-text">${esc(text)}</p>`, `<button class="button secondary" data-action="close-modal">取消</button><button class="button primary" data-action="confirm">${esc(label)}</button>`, 'confirm');
    confirmAction = action;
  }
  function openEditor(id, joinCurrent = true) {
    if (!id && state.members.length >= C.LIMITS.roles) { toast('角色库最多保存 50 位角色'); return; }
    if (!id && joinCurrent && members().length >= C.LIMITS.groupMembers) { toast('本群最多加入 20 位成员，可以先移出一位或在角色库创建角色。'); return; }
    editJoinCurrent = joinCurrent;
    stop(false);
    const original = state.members.find(m => m.id === id);
    editMember = original ? { ...original, enabled: !group().mutedMemberIds.includes(original.id) } : C.normalizeMember({ id: C.uid(), name: '', emoji: C.EMOJI[state.members.length % C.EMOJI.length], color: C.COLORS[state.members.length % C.COLORS.length], personality: '', style: '自然、口语化，通常用 1–3 句话回应。', tagline: '', activity: 65 });
    if (!original) editMember.name = '';
    const m = editMember;
    const inGroup = group().memberIds.includes(m.id);
    const showEnabled = inGroup || (!original && editJoinCurrent);
    openModal(original ? '编辑这位朋友' : '认识一位新朋友', `<p class="field-help">${original ? '名字、头像、性格与活跃度的修改会同步到该角色加入的所有群。' : editJoinCurrent ? '新角色将保存到角色库，并加入当前群。' : '新角色将保存到角色库，可稍后加入任意群。'}</p><div class="avatar-editor"><div id="avatar-preview">${avatar(m)}</div><div><button class="button secondary" data-action="photo">上传头像</button><p>选一张照片，或者用一个表情。</p></div></div><div class="emoji-picker">${C.EMOJI.map(e => `<button class="emoji-choice ${m.emoji === e && !m.photo ? 'selected' : ''}" data-action="emoji" data-value="${e}" aria-label="选择头像 ${e}">${e}</button>`).join('')}</div><div class="color-picker" aria-label="头像底色">${C.COLORS.map((color, i) => `<button class="color-choice ${color} ${m.color === color ? 'selected' : ''}" data-action="color" data-value="${color}" aria-label="头像底色 ${['鼠尾草绿','杏桃','淡紫','雾蓝','米黄','浅粉'][i]}"></button>`).join('')}</div><label class="field"><span>名字</span><input id="member-name" maxlength="20" value="${esc(m.name)}" placeholder="怎么称呼这位朋友？"></label><label class="field"><span>一句话介绍</span><input id="member-tagline" maxlength="40" value="${esc(m.tagline)}" placeholder="例如：慢热的电影迷，偶尔语出惊人"></label><label class="field"><span>性格与背景</span><textarea id="member-personality" maxlength="2000" rows="4" placeholder="写下 TA 的性格、兴趣、经历，以及看待事情的方式…">${esc(m.personality)}</textarea><small>越具体，聊天时的个性越鲜明。</small></label><label class="field"><span>说话习惯</span><textarea id="member-style" maxlength="500" rows="2">${esc(m.style)}</textarea></label><label class="field"><span>活跃度 <b id="activity-value">${m.activity}</b></span><input id="member-activity" type="range" min="1" max="100" value="${m.activity}"><div class="range-labels"><span>安静倾听</span><span>热情健谈</span></div></label>${showEnabled ? `<div class="settings-row"><div><h3>在本群参与聊天</h3><p>仅影响「${esc(group().name)}」，不影响其他群。</p></div>${toggle('member-enabled', m.enabled, '在本群参与聊天')}</div>` : ''}<p id="editor-error" class="inline-error" role="alert"></p>${original && inGroup ? '<button class="danger-link" data-action="remove-member">将这位成员移出本群</button>' : ''}${original && !inGroup ? '<button class="button secondary full" data-action="join-role">添加到当前群</button>' : ''}${original ? '<button class="danger-link full" data-action="delete-role">从角色库彻底删除</button>' : ''}`, '<button class="button secondary" data-action="close-modal">取消</button><button class="button primary" data-action="save-member">保存设定</button>', 'editor');
  }
  function updateAvatar() {
    if (!editMember || modalType !== 'editor') return;
    $('#avatar-preview').innerHTML = avatar(editMember);
    document.querySelectorAll('.emoji-choice').forEach(el => el.classList.toggle('selected', el.dataset.value === editMember.emoji && !editMember.photo));
    document.querySelectorAll('.color-choice').forEach(el => el.classList.toggle('selected', el.dataset.value === editMember.color));
  }
  window.__nativePhoto = value => { if (editMember && modalType === 'editor') { editMember.photo = C.normalizeMember({ ...editMember, photo: value.data }).photo; updateAvatar(); } };
  function saveMember() {
    const name = $('#member-name').value.trim();
    const personality = $('#member-personality').value.trim();
    if (!name || !personality) { $('#editor-error').textContent = '请填写名字和性格设定。'; return; }
    try {
      const isNew = !state.members.some(m => m.id === editMember.id);
      if (isNew && editJoinCurrent && group().memberIds.length >= C.LIMITS.groupMembers) throw new Error('本群已达到 20 位成员的上限');
      const member = C.saveRole(state, { ...editMember, name, personality, tagline: $('#member-tagline').value, style: $('#member-style').value, activity: $('#member-activity').value });
      if (isNew && editJoinCurrent) C.addMembers(state, group().id, [member.id]);
      if ($('#member-enabled') && group().memberIds.includes(member.id)) C.setMemberEnabled(state, group().id, member.id, $('#member-enabled').checked);
      const saved = save(); closeModal(); render(); if (saved) toast(isNew ? '新角色已保存' : '角色设定已同步保存');
    } catch (e) { $('#editor-error').textContent = e.message; }
  }
  function importBackup(text) {
    try {
      const restored = C.decodeBackup(text);
      confirm('恢复这份备份？', `备份包含 ${restored.groups.length} 个群、${restored.members.length} 位角色、${restored.groups.reduce((n, g) => n + g.messages.length, 0)} 条消息。恢复会替换全部群聊、角色库和记录，API Key 保持不变。`, () => {
        stop(false); state = restored; if (!native) state.settings.demo = true;
        lastError = null; draft = ''; drafts.clear(); const saved = save(); render(); if (saved) toast('备份已恢复');
      }, '恢复备份');
    } catch (e) { toast(e.message); }
  }
  window.__nativeImport = value => importBackup(value.data);
  async function pickPhoto(file) {
    if (!file || !editMember) return;
    if (!file.type.startsWith('image/') || file.size > 12000000) { toast('请选择 12 MB 以内的图片'); return; }
    const targetId = editMember.id;
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const edge = Math.min(bitmap.width, bitmap.height);
      canvas.getContext('2d').drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, 256, 256);
      bitmap.close();
      if (editMember?.id !== targetId) return;
      editMember.photo = canvas.toDataURL('image/jpeg', .85); updateAvatar();
    } catch { toast('图片无法读取，请换一张图片'); }
  }
  async function handleAction(button) {
    const action = button.dataset.action;
    if (action === 'nav') { tab = button.dataset.tab; render(); }
    else if (action === 'starter') send(button.dataset.text);
    else if (action === 'continue') run();
    else if (action === 'stop') stop();
    else if (action === 'retry') { const id = lastError?.memberId; run(id ? [id] : null); }
    else if (action === 'dismiss-error') { lastError = null; renderChat(); }
    else if (action === 'add-member' || action === 'add-existing') openAddMembers();
    else if (action === 'new-role') openEditor(null, button.dataset.join !== 'false');
    else if (action === 'member-scope') { memberScope = button.dataset.scope; renderMembers(); }
    else if (action === 'create-group') openGroupEditor();
    else if (action === 'edit-group') openGroupEditor(button.dataset.id);
    else if (action === 'save-group') saveGroup();
    else if (action === 'switch-group') selectGroup(button.dataset.id);
    else if (action === 'add-selected') {
      try {
        const selected = [...document.querySelectorAll('.role-check:checked:not(:disabled)')].map(input => input.value);
        if (!selected.length) throw new Error('请至少选择一位尚未加入本群的角色');
        stop(false); C.addMembers(state, group().id, selected); const saved = save(); closeModal(); render(); if (saved) toast(`已添加 ${selected.length} 位成员`);
      } catch (e) { $('#selection-error').textContent = e.message; }
    } else if (action === 'join-role') {
      const id = editMember.id;
      C.addMembers(state, group().id, [id]); const saved = save(); closeModal(); render(); if (saved) toast('已加入当前群');
    } else if (action === 'delete-group') {
      const target = C.getGroup(state, button.dataset.id);
      confirm('删除这个群聊？', `将删除「${target.name}」及其 ${target.messages.length} 条消息。角色库和其他群会保留，此操作无法撤销。`, () => {
        stop(false); drafts.set(state.activeGroupId, draft); C.deleteGroup(state, target.id); drafts.delete(target.id);
        draft = drafts.get(state.activeGroupId) || ''; lastError = null; const saved = save(); render(); if (saved) toast('群聊已删除');
      }, '删除群聊');
    }
    else if (action === 'edit-member') openEditor(button.dataset.id);
    else if (action === 'close-modal') closeModal();
    else if (action === 'confirm') { const fn = confirmAction; closeModal(); fn?.(); }
    else if (action === 'emoji') { editMember.emoji = button.dataset.value; editMember.photo = ''; updateAvatar(); }
    else if (action === 'color') { editMember.color = button.dataset.value; updateAvatar(); }
    else if (action === 'photo') { if (native) native.photo(); else $('#photo-input').click(); }
    else if (action === 'save-member') saveMember();
    else if (action === 'remove-member') {
      const target = { ...editMember };
      confirm('移出本群？', `将「${target.name}」移出「${group().name}」。角色库、其他群和本群旧消息会保留。`, () => {
        C.removeMember(state, group().id, target.id); const saved = save(); render(); if (saved) toast('成员已移出群聊');
      }, '移出本群');
    } else if (action === 'delete-role') {
      const target = { ...editMember };
      const count = state.groups.filter(g => g.memberIds.includes(target.id)).length;
      confirm('从角色库删除？', `「${target.name}」将从角色库和已加入的 ${count} 个群中移除。各群旧消息保留，角色资料无法撤销。`, () => {
        stop(false); C.deleteRole(state, target.id); const saved = save(); render(); if (saved) toast('角色已从角色库删除');
      }, '删除角色');
    } else if (action === 'pick-speaker') {
      const active = members().filter(m => m.enabled);
      openModal('邀请一位朋友发言', active.length ? active.map(m => `<button class="speaker-option" data-action="speak" data-id="${esc(m.id)}">${avatar(m)}<span><strong>${esc(m.name)}</strong><small>${esc(m.tagline)}</small></span>${icon('arrow')}</button>`).join('') : '<p class="confirm-text">暂无参与聊天的成员，请先添加或启用一位朋友。</p>', '', 'speakers');
    } else if (action === 'speak') { const id = button.dataset.id; closeModal(); run([id]); }
    else if (action === 'toggle-key') { const input = $('#api-key'); input.type = input.type === 'password' ? 'text' : 'password'; }
    else if (action === 'save-key') {
      const key = $('#api-key').value.trim();
      if (!key) { toast('请先填写 API Key'); return; }
      if (/\s/.test(key)) { toast('API Key 不能包含空格或换行'); return; }
      const result = JSON.parse(native.saveKey(key));
      if (result.ok) { hasKey = true; $('#api-key').value = ''; renderHeader(); renderSettings(); toast('密钥已加密保存，可点击测试连接'); } else toast(result.message);
    } else if (action === 'delete-key') {
      confirm('删除 API Key？', '删除后需要重新填写密钥才能使用真实 AI 对话，聊天记录会保留。', () => {
        stop(false); const result = JSON.parse(native.saveKey('')); if (!result.ok) { toast(result.message); return; }
        hasKey = false; render(); toast('密钥已删除');
      }, '删除密钥');
    } else if (action === 'test-api') {
      if (busy || pending.size) { toast('请等当前回复结束，或先停止回复'); return; }
      button.disabled = true; button.textContent = '连接中…';
      try {
        await request({ model: 'deepseek-chat', stream: false, max_tokens: 8, messages: [{ role: 'user', content: '请只回复 OK' }] });
        toast('DeepSeek 连接成功');
      } catch (e) { toast(e.message); }
      finally { if (button.isConnected) { button.disabled = false; button.textContent = '测试连接'; } }
    } else if (action === 'save-settings') {
      const name = $('#setting-group').value.trim(), user = $('#setting-user').value.trim();
      if (!name || !user) { toast('群名和昵称不能为空'); return; }
      if (state.groups.some(g => g.id !== group().id && g.name === name)) { toast('已有同名群聊，请换一个名字'); return; }
      stop(false); group().name = name; state.settings.userName = user; group().topic = $('#setting-topic').value.trim();
      const saved = save(); renderHeader(); if (saved) toast('群聊设置已保存');
    } else if (action === 'export') {
      const text = C.encodeBackup(state);
      if (native) native.exportData(text);
      else { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = '同频-聊天备份.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
    } else if (action === 'import') { if (native) native.importData(); else $('#import-input').click(); }
    else if (action === 'clear-history') confirm('清空本群记录？', `仅清空「${group().name}」的聊天记录。其他群、角色资料和 API Key 会保留，建议先导出备份。`, () => {
      stop(false); group().messages = []; lastError = null; const saved = save(); render(); if (saved) toast('本群聊天记录已清空');
    }, '清空记录');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button && !button.disabled) handleAction(button).catch(error => toast(error.message || '操作失败，请稍后重试。'));
    else if (event.target.classList.contains('modal-backdrop')) closeModal();
  });
  document.addEventListener('submit', event => { if (event.target.id === 'compose-form') { event.preventDefault(); send(); } });
  document.addEventListener('input', event => {
    const el = event.target;
    if (el.id === 'composer') { draft = el.value; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 108) + 'px'; }
    if (el.id === 'member-activity') $('#activity-value').textContent = el.value;
    if (el.id === 'setting-replies') $('#replies-value').textContent = el.value;
    if (el.id === 'setting-temperature') $('#temperature-value').textContent = Number(el.value).toFixed(1);
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (el.id === 'photo-input') { pickPhoto(el.files[0]); el.value = ''; }
    if (el.id === 'import-input') {
      const file = el.files[0]; el.value = '';
      if (!file) return;
      if (file.size > 6000000) { toast('备份文件不能超过 6 MB'); return; }
      file.text().then(importBackup).catch(() => toast('无法读取备份文件'));
    }
    const field = { 'setting-replies': 'replies', 'setting-temperature': 'temperature', 'setting-model': 'model', 'setting-demo': 'demo' }[el.id];
    if (field) {
      if (field === 'demo' && !native && !el.checked) { el.checked = true; toast('浏览器预览仅支持离线演示，真实对话请使用安卓应用。'); return; }
      stop(false);
      state.settings[field] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
      lastError = null; save(); renderHeader();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modalType) { closeModal(); return; }
    if (event.target.id === 'composer' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
    if (event.key === 'Tab' && modalType) {
      const focusable = [...document.querySelectorAll('.modal button:not(:disabled), .modal input:not(:disabled), .modal textarea, .modal select')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.__androidBack = () => {
    if (modalType) closeModal();
    else if (tab !== 'chat') { tab = 'chat'; render(); }
    else if (busy) stop();
    else if (native) native.background();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && (busy || pending.size)) stop(false); });
  render();
  if (loadWarning) toast(loadWarning);
})();
