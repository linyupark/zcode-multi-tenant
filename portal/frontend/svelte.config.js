// vite-plugin-svelte 显式配置：存在本文件即消除 "no Svelte config found" 构建提示。
// onwarn 过滤三类 a11y 警告（点击交互元素刻意沿用 a/div + onclick 的现状）：
//   交互处（导航项、标签页、删除叉、抽屉遮罩）样式强依赖元素形态，换 <button> 会继承
//   app.css 全局 button 的 accent 背景等外观，视觉回归风险大；旧版纯手写页面同样是
//   a/div+onclick 语义。若将来做无障碍打磨，删掉本过滤即可让警告重新出现。
export default {
  onwarn(warning, defaultHandler) {
    if (
      [
        "a11y_click_events_have_key_events",
        "a11y_no_static_element_interactions",
        "a11y_missing_attribute",
      ].includes(warning.code)
    ) {
      return;
    }
    defaultHandler(warning);
  },
};
