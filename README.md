# 同频 1.1.0 · 安卓虚拟群聊

面向 Android 手机的 DeepSeek 多群聊天应用。可以创建不同的群，并从共享角色库邀请已创建的虚拟成员；每个群独立保存聊天记录和背景，每个角色有自己的名字、头像、性格与说话习惯。

**交付状态：1.1.0 源码包，尚未完成安卓编译或真机验收，不包含 APK。** 15 项核心逻辑测试与 5 项应用控制逻辑测试通过，共 20 项；浏览器交互测试因执行环境权限问题未能启动；真实 DeepSeek 接口尚未验证。详见 [测试状态](docs/TESTING.md)。

## 已实现的代码功能

- 「群组」页创建、切换、编辑和删除不同的群，最多 20 个群；每群最多 20 位成员。
- 「角色库」统一管理最多 50 位角色；同一个角色可加入多个群，无需重复创建。
- 群聊界面直接添加已有角色或创建新角色，在「成员」页编辑、暂停或移出成员。
- 修改角色名字、头像、性格、说话习惯或活跃度会同步到所有加入的群；休息状态只影响当前群。
- 从本群移出保留角色资料和其他群成员关系；从角色库彻底删除则移出所有群，历史消息保留。
- 各群聊天记录、群名、群背景相互独立；切群会停止当前轮次并忽略迟到的回复，草稿按群暂存。
- 自动兼容 1.0 的单群本地数据和旧备份，将其迁移为默认群，保留角色与休息状态。
- 每位成员独立的名字、照片/表情头像、介绍、性格背景、说话习惯与活跃度。
- 按活跃度安排发言，`@名字` 优先邀请，支持指定一位成员发言。
- 每轮 1–6 条回复，成员能看到前一位成员的发言；一轮结束自动停止，可随时手动停止。
- DeepSeek Chat / Reasoner，API Key 设置、连接测试、错误提示与失败回复重试。
- 清楚标识的离线演示模式，示例回复不调用模型，也不会作为真实对话上下文发送。
- 本地保存、JSON 备份导入/导出、清空记录。导入备份和删除操作有确认。
- API Key 使用 Android Keystore + AES-GCM 加密保存，不进入聊天数据库、备份或 JavaScript 存储。

## 运行要求

- Android 8.0（API 26）或更高版本。
- 更新后的 Android System WebView / Chrome（建议 Chromium 100 或更高版本）。
- 使用真实对话需要可访问 `api.deepseek.com` 的网络、有余额的 DeepSeek 账户及 API Key。

## 构建 APK

此项目采用 Java 原生容器 + 随应用打包的 HTML/CSS/JavaScript 界面。网络请求、密钥加密、私有文件保存、照片及备份选择由 Android 原生代码处理。界面不需要网站托管。

构建版本固定为：

| 工具 | 版本 |
| --- | --- |
| JDK | 17 或 21 |
| Gradle | 8.11.1 |
| Android Gradle Plugin | 8.9.2 |
| Android SDK Platform | 35 |
| Android SDK Build Tools | 35.0.0 |

1. 安装 Android Studio，使用 SDK Manager 安装 Android SDK Platform 35 和 Build Tools 35.0.0。
2. 从 <https://gradle.org/releases/> 下载并解压 Gradle 8.11.1，将其 `bin` 目录加入 PATH。当前交付没有 Gradle Wrapper JAR，不能直接运行 `./gradlew`。
3. 解压项目。将项目根目录的 `local.properties.example` 复制为 `local.properties`，填写你电脑上的 SDK 路径；也可设置 `ANDROID_HOME`。
4. 在根目录执行：

   ```sh
   gradle --version
   gradle --no-daemon :app:assembleDebug
   ```

5. 构建产物位于 `app/build/outputs/apk/debug/app-debug.apk`。传到手机后允许文件管理器安装此来源的应用，即可安装。也可通过 Android Studio 连接真机运行。

如需 Android Studio 打开工程，在 Gradle 设置中选择本地 Gradle 8.11.1 及 JDK 17/21，然后同步并构建。首次构建需要联网下载构建依赖。也可以在已经安装 Gradle 后执行 `gradle wrapper --gradle-version 8.11.1`，生成标准 Wrapper 文件供后续使用。

也提供了 `.github/workflows/build-android.yml` 自动构建配置。将解压后的项目内容放到你自己的 GitHub 仓库根目录，在 Actions 中运行 **Build Android APK**；构建成功后下载 `tongpin-1.1.0-debug-apk` 产物。该工作流会安装 Gradle/Android SDK、运行 20 项本地逻辑测试并构建调试 APK；当前环境没有执行过该工作流，因此不代表已经生成安装包。备份文件与 API Key 不应上传到仓库。

这是开发调试安装包的构建流程。正式分发需自行设置 release 签名；更新已安装的应用需要保持签名一致。

## 首次使用

1. 打开「设置」，填写在 <https://platform.deepseek.com> 获取的 API Key，点击「保存密钥」和「测试连接」。连接测试会产生一次很小的 API 调用。
2. 关闭「离线演示模式」，选择 `DeepSeek Chat`；建议每轮回复数先设为 2–3。
3. 在「成员 → 角色库」中编辑预设的四位成员，或者创建自己的角色。
4. 打开「群组 → 创建新群聊」，填写群名、背景，并勾选角色库里已经创建的朋友。
5. 进入任意群，在「成员 → 本群成员 → 从角色库添加」可随时邀请更多已有角色。移出本群后，仍可从角色库再次添加。
6. 回到「聊天」发送消息；也可以点「让大家聊聊」或「邀请发言」。

API Key、模型、每轮回复数、随机性、演示模式和你的昵称为应用通用设置；群名、群背景、成员名单、成员休息状态和聊天记录为各群独立设置。角色资料的修改会影响该角色所在的所有群，编辑窗口也会提示这一点。

API Key 只需要填写到安装后的应用中，无需发给开发者。

## 仅预览界面

在现代浏览器中直接打开压缩包里的 `preview.html`，或工程中的 `app/src/main/assets/index.html`，可体验多群管理、共享角色库和离线演示。浏览器预览使用 localStorage 保存数据，不支持真实 API 请求。可通过本地静态服务器打开以获得更稳定的本地存储行为。

## 数据与行为约定

- 多个本地群聊，无登录、无跨设备同步。导出/导入备份覆盖所有群和共享角色库，卸载前请导出。
- 每群保留最近 500 条消息，聊天界面显示本群最近 150 条；超出后自动移除本群最旧消息。全部本地资料与备份总大小上限约 6 MB；浏览器自身的存储配额可能更小。
- 每次请求仅使用当前群最近最多 40 条非演示聊天记录，并限制其总字符量；不具备无限上下文或长期记忆。
- 每位成员每次发言单独调用 API。发送内容包含群设定、当前成员性格及最近聊天记录；头像不发送至 DeepSeek。
- 备份包含聊天内容和角色资料，API Key 单独加密存储。Android 自动备份已关闭。
- 非流式回复；收到完整响应后显示消息。Reasoner 可能较慢，通常日常群聊使用 Chat 即可。
- 应用进入后台会停止当前轮次，不提供后台无限自动群聊。停止本地等待不保证已发出的服务端请求免计费。
- 移出成员或彻底删除角色保留旧消息；历史发言名字不随角色改名而变，仍在本群的成员头像使用当前设定。删除群聊会删除该群记录，但保留角色库。
- 1.1.0 使用数据格式 v2，兼容导入 v1；1.0 不支持读取新版多群备份。源码包保留的存储文件名与 localStorage 键名未改，以便迁移。
- 输入草稿只在应用本次运行中按群暂存；关闭应用后不保证保留。
- 上传图片会按中心裁剪为方形头像；暂未处理照片 EXIF 旋转信息，竖拍照片可能需要预先调整方向。

## 目录

```text
app/src/main/java/com/tongpin/chat/MainActivity.java  Android 容器、网络与本地文件
app/src/main/java/com/tongpin/chat/KeyVault.java      密钥加密
app/src/main/assets/core.js                          角色、调度、提示词、备份校验
app/src/main/assets/app.js                           界面与交互
app/src/main/assets/app.css                          手机和桌面样式
tests/core.test.cjs                                  已通过的 15 项核心逻辑测试
tests/controller.test.cjs                            已通过的 5 项控制逻辑测试
tests/ui_test.py                                     待执行的浏览器交互测试
docs/TESTING.md                                      验证结果与真机验收步骤
```

## 重新生成源码包与离线预览

在项目根目录运行 `python scripts/package_source.py`，会在上级目录生成源码 ZIP、独立预览 HTML 和 SHA-256 校验文件。这一步只打包源码，不构建 APK。
