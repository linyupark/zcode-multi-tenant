<script>
  let { width = 520, children } = $props();
</script>

<div class="panel">
  <div class="panel-card" style="width:{width}px">
    {@render children()}
  </div>
</div>

<style>
  /* 移动端：底部工作表（抓手条 + 上圆角） */
  @media (max-width:768px){
    .panel{padding:0;align-items:flex-end;height:var(--app-h,100dvh)}
    .panel-card{width:100%!important;max-width:none;max-height:calc(var(--app-h,100dvh) - 20px);border-radius:18px 18px 0 0;border-bottom:0;padding:18px 16px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -10px 36px rgba(0,0,0,.18)}
    .panel-card::before{content:"";display:block;width:36px;height:4px;border-radius:99px;background:var(--control);margin:-6px auto 14px}
  }
</style>
