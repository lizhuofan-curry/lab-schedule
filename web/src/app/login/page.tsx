"use client";

import { signIn } from "@/lib/auth-client";
import { ArrowRight, CalendarDays, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { BciLogo } from "@/components/bci-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const result = await signIn.username({
      username: String(data.get("studentNo") ?? "").trim(),
      password: String(data.get("password") ?? ""),
      rememberMe: true,
    });
    setLoading(false);
    if (result.error) {
      setError("学号或密码不正确，请检查后重试。");
      return;
    }
    const requestedPath = new URLSearchParams(window.location.search).get("next");
    const destination = requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : "/dashboard";
    router.push(destination);
    router.refresh();
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="auth-brand"><span className="brand-mark"><BciLogo /></span><strong>同频课表</strong></Link>
        <div className="story-copy">
          <span className="eyebrow light">BCI实验室时间协作</span>
          <h1>不再在群里<br />反复问“谁有空”。</h1>
          <p>看课表、找没课的同学、约共同时间，都在一个清楚的页面里完成。</p>
        </div>
        <MiniBoard />
      </section>
      <section className="auth-form-side">
        <ThemeSwitcher compact />
        <form className="auth-form" method="post" onSubmit={handleSubmit}>
          <div><span className="eyebrow">欢迎回来</span><h2>登录实验室课表</h2><p>使用你的学号和密码登录。</p></div>
          <label className="field"><span>学号</span><input name="studentNo" autoComplete="username" required placeholder="请输入学号" /></label>
          <label className="field"><span>密码</span><span className="password-input"><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="请输入密码" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button primary wide" disabled={loading}>{loading ? "正在登录…" : <>登录 <ArrowRight size={17} /></>}</button>
          <p className="auth-switch">第一次使用？<Link href="/register">用姓名和学号注册</Link></p>
          <p className="form-help">忘记密码时，请联系项目维护者协助重置。</p>
        </form>
      </section>
    </main>
  );
}

function MiniBoard() {
  return (
    <div className="mini-board" aria-hidden="true">
      <div className="mini-board-title"><CalendarDays size={17} /><span>本周共同空闲</span><strong>8 个时段</strong></div>
      <div className="mini-grid">{Array.from({ length: 35 }, (_, index) => <i key={index} className={[8, 9, 17, 24, 25].includes(index) ? "busy" : ""} />)}</div>
      <small>深色格子为已有安排，其余时间都可以约。</small>
    </div>
  );
}
