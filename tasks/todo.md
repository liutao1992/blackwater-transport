# 实施任务

- [x] 1. 建立 Vite / Three.js 工程和基础页面
  - Acceptance: `pnpm install`、`pnpm run build` 可执行，本地字体和静态入口存在。
  - Verify: 构建无错误。
  - Files: `package.json`, `index.html`, `src/main.js`, `src/styles.css`

- [x] 2. 构建运输船场景、材质、光照、海面和碰撞/导航
  - Acceptance: 双基地、三路、多层集装箱和甲板可辨识，静态射线和碰撞可用。
  - Verify: 浏览器场景检查、碰撞逻辑测试。
  - Files: `src/world.js`, `src/materials.js`, `src/logic.js`

- [x] 3. 实现玩家物理、三类武器和战斗反馈
  - Acceptance: 移动/跳跃/蹲伏/冲刺、ADS、射击、扩散、后坐力、换弹和切枪具有真实状态。
  - Verify: 浏览器键鼠操作、弹药和射线测试。
  - Files: `src/player.js`, `src/weapons.js`, `src/effects.js`, `src/audio.js`

- [x] 4. 实现 4v4 AI、伤害、重生和回合状态机
  - Acceptance: AI 会寻路和交战，遮挡有效；双方计分、计时、暂停和结算正确。
  - Verify: 逻辑测试及浏览器自动观察。
  - Files: `src/bots.js`, `src/game.js`, `src/logic.js`

- [x] 5. 完成开始页、HUD、小地图、击杀反馈和响应式细节
  - Acceptance: 中文界面完整，所有按钮/设置可用，键盘焦点清晰，窄屏无横向溢出。
  - Verify: WebGL 原始帧记录和 UI 交互测试（整页截图接口在当前环境不可用）。
  - Files: `index.html`, `src/ui.js`, `src/styles.css`

- [x] 6. 完成验收和生产构建
  - Acceptance: 单元测试、构建、真实浏览器核心流程均记录结果，无未说明的严重错误。
  - Verify: `pnpm test`、`pnpm run build`、ego-browser。
  - Files: `tests/*`, `scripts/*`, `artifacts/*`

- [ ] 7. 部署到公开 CDN 并复验
  - Acceptance: 获得可匿名打开的 HTTPS 链接，重新加载后资源与游戏可用。
  - Verify: 公开 URL 浏览器检查及网络状态检查。
  - Files: `dist/*`, `artifacts/deployment.md`
