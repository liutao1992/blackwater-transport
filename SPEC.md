# Spec: 运输船 · 3D 浏览器枪战

## Objective
制作一个可直接打开并游玩的 3D 第一人称枪战页面，以《穿越火线》运输船的核心空间记忆为参考：两端出生区、中央集装箱掩体、左右侧路、舰船甲板与海面氛围。目标不是展示静态模型，而是完成“进入战场 → 移动/瞄准/射击 → 对抗 AI → 阵亡重生 → 结算/再来一局”的可玩闭环。

### 默认假设
1. 面向桌面端现代浏览器，优先 Chrome / Edge；手机端显示键鼠提示，不承诺触屏完整操作。
2. 单人对战 AI，不实现联网匹配、账号或后端服务。
3. 采用原创程序化几何、材质与音效，不提取或搬运官方游戏资源。
4. 尽量还原布局和工业军事氛围，不宣称像素级或官方授权复刻。
5. 成品为纯静态站点，可部署到 CDN；若环境没有可用发布凭据，则尝试合法的无账号静态发布方式并如实报告结果。

## Tech Stack
- Vite + 原生 JavaScript / CSS
- Three.js：WebGL 场景、第一人称相机、射线命中、实时光影
- 原生 Web Audio API：枪声、命中、换弹、环境声
- Playwright 或 ego-browser：浏览器运行与交互验证

## Commands
- Install: `pnpm install`
- Dev: `pnpm run dev -- --host 127.0.0.1`
- Build: `pnpm run build`
- Preview: `pnpm run preview -- --host 127.0.0.1`
- Test: `pnpm run test`

## Project Structure
```text
index.html                 → 页面入口与 HUD / 菜单结构
src/main.js               → 启动、状态机、主循环
src/world.js              → 运输船地图、碰撞体、光照与海面
src/player.js             → 移动、视角、生命与重生
src/weapons.js            → 武器、射击、弹道、换弹与反馈
src/bots.js               → AI 感知、寻路、交战与重生
src/audio.js              → 程序化音效与环境音
src/styles.css            → 菜单、HUD、响应式与无障碍
public/                   → 本地静态资源
scripts/                  → 自动化验证与部署辅助
tests/                    → 逻辑与浏览器测试
SPEC.md                   → 本规格
```

## Code Style
- 使用 ES Modules、语义化命名和小型职责清晰的类/函数。
- 渲染对象与逻辑状态分离；频繁更新避免 DOM 布局和临时对象分配。
- 所有碰撞、命中和分数变化通过统一游戏状态处理，不只改变视觉表现。
- 示例：
```js
export function applyDamage(target, amount, source) {
  if (!target.alive || amount <= 0) return false;
  target.health = Math.max(0, target.health - amount);
  if (target.health === 0) target.kill(source);
  return true;
}
```

## Testing Strategy
- 构建检查：生产构建无语法错误，资源路径适用于静态 CDN。
- 逻辑测试：伤害、弹药、换弹、比分、重生和状态切换的边界情况。
- 浏览器测试：首屏无控制台错误；能进入游戏；键鼠移动、射击、换弹、暂停/恢复可用；AI 会移动、攻击、死亡和重生。
- 视觉检查：至少检查初始菜单、战斗 HUD、不同分辨率截图；无明显穿模、遮挡或文字溢出。
- 性能检查：合理像素比与阴影范围，避免无界粒子/弹孔增长；目标为常见桌面设备可流畅游玩。
- 发布检查：通过公开 CDN URL 重新打开并完成一次核心流程，而不只验证 localhost。

## Boundaries
- Always: 先在浏览器验证再发布；资源尽量本地化；如实标注非官方重制；记录未通过或未执行的检查。
- Ask first: 需要用户账号/付费凭据的部署；引入大型付费素材；增加联网后端。
- Never: 上传用户私密文件或凭据；宣称官方授权；把仅 localhost 可访问的地址当作公开链接。

## Success Criteria
1. 打开页面能看到具有运输船辨识度的实时 3D 战场，而非视频或静态截图。
2. 有清晰的中文开始界面、键位说明、准星、生命、弹药、比分、小地图和击杀反馈。
3. WASD、鼠标视角、左键射击、右键瞄准、R 换弹、冲刺、跳跃、蹲伏及武器切换均有实际效果。
4. 至少一种步枪具有射速、扩散、后坐力、弹匣、备弹、伤害、命中部位和换弹逻辑。
5. 多名敌人会巡逻/追击、受遮挡影响、开火、受伤、死亡和重生；玩家也可阵亡并重生。
6. 有可结束的回合计分/计时及重新开局流程；Esc 可暂停并释放鼠标。
7. 包含枪械模型、枪口火光、弹道/命中反馈、音效、海面、雾与工业材质，且性能有基本保护。
8. 生产构建和核心浏览器检查通过，并交付实际验证可公开访问的 HTTPS CDN 链接；若发布受阻，明确说明具体阻塞而不伪造链接。

## Open Questions
- 部署平台由可用发布条件决定，优先无需后端且能长期公开访问的静态 CDN。
- 画面与原作相似度以布局、尺感和氛围为优先，不使用未经授权的官方模型或贴图。
