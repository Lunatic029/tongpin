"""Browser interaction and native-bridge contract tests; no API credentials used."""
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "app/src/main/assets/index.html").as_uri()
OUT = ROOT / "test-results"
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium"), headless=True, timeout=15000, args=["--no-sandbox"])
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.get_by_role("heading", name="有些话，总有人接得住。").wait_for()
    page.screenshot(path=str(OUT / "01-chat.png"), full_page=True)
    page.get_by_role("button", name="添加成员").click()
    page.get_by_role("button", name="创建新角色", exact=True).click()
    page.locator("#member-name").fill("测试朋友")
    page.locator("#member-personality").fill("喜欢科学，安静、理性，善于用比喻解释复杂概念。")
    page.locator("#member-tagline").fill("安静的科学爱好者")
    page.get_by_role("button", name="保存设定").click()
    page.locator('nav [data-tab="members"]').click()
    page.get_by_role("heading", name="测试朋友").wait_for()
    page.screenshot(path=str(OUT / "02-members.png"), full_page=True)
    page.locator('[data-action="edit-member"]').filter(has_text="测试朋友").click()
    page.locator("#member-name").fill("星河")
    page.locator("#member-enabled").uncheck()
    page.screenshot(path=str(OUT / "03-editor.png"), full_page=True)
    page.get_by_role("button", name="保存设定").click()
    page.reload()
    page.locator('nav [data-tab="members"]').click()
    card = page.locator('[data-action="edit-member"]').filter(has_text="星河")
    assert "暂时休息" in card.inner_text()
    card.click()
    page.get_by_role("button", name="将这位成员移出本群").click()
    page.get_by_role("button", name="移出本群", exact=True).click()
    assert page.get_by_role("heading", name="星河").count() == 0
    page.locator('nav [data-tab="chat"]').click()
    page.locator("#composer").fill("<img src=x onerror=alert(1)> 周末去哪里？")
    page.get_by_role("button", name="发送消息", exact=True).click()
    page.wait_for_function("document.querySelectorAll('.message.bot').length === 3 && !document.querySelector('.typing-bubble')")
    assert page.locator(".message.user .bubble").inner_text().startswith("<img src=x")
    assert page.locator(".message.user .bubble img").count() == 0
    page.screenshot(path=str(OUT / "04-conversation.png"), full_page=True)
    page.get_by_role("button", name="让大家聊聊").click()
    page.get_by_role("button", name="停止回复").click()
    page.wait_for_timeout(1500)
    assert page.locator(".message.bot").count() == 3
    page.locator('nav [data-tab="settings"]').click()
    page.locator("#setting-group").fill("周末闲聊小分队")
    page.locator("#setting-user").fill("小周")
    page.get_by_role("button", name="保存群聊设置").click()
    page.screenshot(path=str(OUT / "05-settings.png"), full_page=True)
    exported = page.evaluate("TongpinCore.encodeBackup(JSON.parse(localStorage.getItem('tongpin.state.v1')))")
    assert "apiKey" not in exported
    page.get_by_role("button", name="清空本群记录").click()
    page.get_by_role("button", name="清空记录", exact=True).click()
    page.evaluate("data => window.__nativeImport({data})", exported)
    page.get_by_role("button", name="恢复备份").click()
    page.locator('nav [data-tab="chat"]').click()
    assert page.locator(".message.bot").count() == 3
    assert page.locator(".header-title").inner_text() == "周末闲聊小分队"
    # Create another group with existing roles, without cloning the library.
    page.locator('nav [data-tab="groups"]').click()
    page.locator('#header [data-action="create-group"]').click()
    page.locator('#group-name').fill('周末电影群')
    page.locator('#group-topic').fill('这里聊电影和导演')
    page.locator('.role-check[value="lin"]').check()
    page.locator('.role-check[value="man"]').check()
    page.locator('[data-action="save-group"]').click()
    assert page.locator('.header-title').inner_text() == '周末电影群'
    assert page.locator('.message').count() == 0
    page.locator('nav [data-tab="members"]').click()
    assert page.locator('[data-action="edit-member"]').count() == 2
    page.locator('[data-action="edit-member"][data-id="lin"]').click()
    page.locator('#member-name').fill('林老师')
    page.locator('#member-enabled').uncheck()
    page.locator('[data-action="save-member"]').click()
    page.locator('[data-action="add-existing"]').click()
    page.locator('.role-check[value="xia"]').check()
    page.locator('[data-action="add-selected"]').click()
    assert page.locator('[data-action="edit-member"]').count() == 3
    page.reload()
    assert page.locator('.header-title').inner_text() == '周末电影群'
    page.locator('nav [data-tab="groups"]').click()
    page.screenshot(path=str(OUT / '07-groups.png'), full_page=True)
    page.locator('[data-action="switch-group"][data-id="g_default"]').click()
    assert page.locator('.message.bot').count() == 3
    page.locator('nav [data-tab="members"]').click()
    shared = page.locator('[data-action="edit-member"][data-id="lin"]')
    assert '林老师' in shared.inner_text()
    assert '参与聊天' in shared.inner_text()  # Paused only in the movie group.
    page.locator('nav [data-tab="chat"]').click()
    page.set_viewport_size({"width": 320, "height": 640})
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.screenshot(path=str(OUT / "06-desktop.png"), full_page=True)
    assert not errors, errors
    context.close()

    # A fake native bridge validates the actual API scheduling and cancellation paths.
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""
      window.testRequests = []; window.testCancelled = []; window.testState = null;
      window.TongpinNative = {
        load: () => JSON.stringify({hasKey: true}),
        save: json => { window.testState = JSON.parse(json); return '{"ok":true}'; },
        saveKey: () => '{"ok":true}',
        cancel: id => window.testCancelled.push(id),
        request: (id, text) => {
          window.testRequests.push({id, body: JSON.parse(text)});
          if (window.testHold) return;
          setTimeout(() => window.__nativeReply(window.testFail
            ? {id, ok: false, message: 'API Key 无效，请在设置中重新填写。'}
            : {id, ok: true, content: '这是通过模拟原生接口返回的测试回复。'}), 100);
        }
      };
    """)
    page.goto(URL)
    page.locator("#composer").fill("@知夏 大家来聊聊")
    page.get_by_role("button", name="发送消息", exact=True).click()
    page.wait_for_function("document.querySelectorAll('.message.bot').length === 3 && !document.querySelector('.typing-bubble')")
    requests = page.evaluate("testRequests")
    assert len(requests) == 3
    assert "「知夏」" in requests[0]["body"]["messages"][0]["content"]
    second_context = json.loads(requests[1]["body"]["messages"][1]["content"])["conversation"]
    assert second_context[-1]["sender"] == "知夏", second_context
    assert page.locator(".demo-label").count() == 0
    page.evaluate("window.testHold = true")
    page.get_by_role("button", name="让大家聊聊").click()
    page.get_by_role("button", name="停止回复").click()
    page.evaluate("window.__nativeReply({id: testRequests.at(-1).id, ok: true, content: '迟到的回复'})")
    page.wait_for_timeout(200)
    assert page.locator(".message.bot").count() == 3
    assert page.evaluate("testCancelled.length") == 1
    page.evaluate("window.testHold = false; window.testFail = true")
    page.get_by_role("button", name="让大家聊聊").click()
    page.locator(".error-bar").wait_for()
    assert "API Key 无效" in page.locator(".error-bar").inner_text()
    page.evaluate("window.testFail = false")
    page.get_by_role("button", name="重试这条回复").click()
    page.wait_for_function("document.querySelectorAll('.message.bot').length === 4 && !document.querySelector('.typing-bubble')")
    assert page.locator(".message.user").count() == 1
    assert not errors, errors
    browser.close()
    print("PASS: mobile layout, CRUD, persistence, demo, cancellation, safe rendering, backup, native API contract, context chaining, errors and retry")
