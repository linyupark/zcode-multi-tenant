/** 软键盘视口适配：把 visualViewport 高度写进 --app-h（#app/#gate/.panel 高度都挂这个变量）。
 *  App onMount 里 installAppHeight()，返回卸载清理函数。 */
export function installAppHeight() {
  const sync = () => {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty("--app-h", Math.round(h) + "px");
  };
  const onVv = () => sync();
  const onResize = () => sync();
  const onOrient = () => setTimeout(sync, 120);
  sync();
  window.visualViewport?.addEventListener("resize", onVv);
  window.visualViewport?.addEventListener("scroll", onVv);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onOrient);
  return () => {
    window.visualViewport?.removeEventListener("resize", onVv);
    window.visualViewport?.removeEventListener("scroll", onVv);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onOrient);
  };
}
