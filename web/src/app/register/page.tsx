"use client";

import { signUp } from "@/lib/auth-client";
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const studentNo = String(data.get("studentNo") ?? "").trim().toLowerCase();
    const password = String(data.get("password") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setLoading(true);
    const result = await signUp.email({
      name,
      username: studentNo,
      email: `${studentNo}@members.local`,
      password,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error.message || "注册失败，请检查填写内容或稍后重试。");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="auth-page register-page">
      <section className="auth-story">
        <Link href="/login" className="back-link"><ArrowLeft size={17} /> 返回登录</Link>
        <div className="story-copy"><span className="eyebrow light">只需一分钟</span><h1>创建账号，<br />建立自己的课表。</h1><p>无需等待预置名单，填写真实姓名和本人学号即可加入。</p></div>
        <div className="register-notes"><p><CheckCircle2 size={19} /> 所有成员可以互相查看课表</p><p><ShieldCheck size={19} /> 只有你可以修改自己的课程</p></div>
      </section>
      <section className="auth-form-side">
        <ThemeSwitcher compact />
        <form className="auth-form" method="post" onSubmit={handleSubmit}>
          <div><span className="eyebrow">创建账号</span><h2>注册实验室课表</h2><p>注册成功后会自动加入成员目录，请填写真实信息。</p></div>
          <label className="field"><span>姓名</span><input name="name" required autoComplete="name" placeholder="请输入真实姓名" /></label>
          <label className="field"><span>学号</span><input name="studentNo" required autoComplete="username" placeholder="请输入学号" /></label>
          <label className="field"><span>设置密码</span><input name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" placeholder="至少 8 位" /></label>
          <label className="field"><span>确认密码</span><input name="confirmPassword" type="password" minLength={8} maxLength={128} required autoComplete="new-password" placeholder="再次输入密码" /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button primary wide" disabled={loading}>{loading ? "正在注册…" : <>完成注册 <ArrowRight size={17} /></>}</button>
          <p className="auth-switch">已有账号？<Link href="/login">直接登录</Link></p>
        </form>
      </section>
    </main>
  );
}
