<script>
  import { api } from "../../lib/api.js";
  import { closePanel } from "../../lib/stores/ui.svelte.js";

  let cur = $state(""), pw1 = $state(""), pw2 = $state("");
  let err = $state(""), ok = $state("");

  async function save() {
    err = ""; ok = "";
    if (pw1 !== pw2) { err = "两次输入的新密码不一致"; return; }
    try {
      await api("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword: cur, newPassword: pw1 }) });
      ok = "已完成：密码已修改";
      setTimeout(closePanel, 1200);
    } catch (e) { err = e.message; }
  }
</script>

<h2>修改密码</h2>
<div class="sub">修改后当前登录保持有效，下次登录用新密码</div>
<div class="field"><label class="field-label" for="pw-cur">当前密码</label><input id="pw-cur" type="password" autocomplete="current-password" bind:value={cur} /></div>
<div class="field"><label class="field-label" for="pw-new">新密码（至少 6 位）</label><input id="pw-new" type="password" autocomplete="new-password" bind:value={pw1} /></div>
<div class="field"><label class="field-label" for="pw-new2">确认新密码</label><input id="pw-new2" type="password" autocomplete="new-password" bind:value={pw2} /></div>
<div class="msg-err">{err}</div>
<div class="msg-ok">{ok}</div>
<div class="btn-row"><button style="flex:1" onclick={save}>保存</button><button class="ghost" onclick={closePanel}>关闭</button></div>
