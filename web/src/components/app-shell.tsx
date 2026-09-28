"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, LayoutDashboard, LogOut, Menu, UserRoundCheck, Users, X } from "lucide-react";
import { useState } from "react";
import { BciLogo } from "@/components/bci-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";

const navigation = [
  { href: "/dashboard", label: "课表总览", icon: LayoutDashboard },
  { href: "/my-schedule", label: "我的课表", icon: CalendarDays },
  { href: "/availability", label: "找共同空闲", icon: Clock3 },
  { href: "/members", label: "实验室成员", icon: Users },
  { href: "/registration", label: "注册情况", icon: UserRoundCheck },
];

export function AppShell({ children, currentUser = { name: "李卓凡", studentNo: "2510250877" } }: { children: React.ReactNode; currentUser?: { name: string; studentNo: string } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="app-frame">
      <header className="mobile-header">
        <Link href="/dashboard" className="brand-mark" aria-label="同频课表首页"><BciLogo /></Link>
        <span className="mobile-brand-title">同频课表</span>
        <button className="icon-button" onClick={() => setOpen((value) => !value)} aria-label={open ? "关闭账户菜单" : "打开账户菜单"}>
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><BciLogo /></div>
          <div>
            <strong>同频课表</strong>
            <small>BCI实验室时间协作</small>
          </div>
        </div>

        <nav className="nav-list" aria-label="主要导航">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"} onClick={() => setOpen(false)}>
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <ThemeSwitcher />
        <div className="sidebar-footer">
          <div className="current-user">
            <div className="avatar">{currentUser.name.slice(0, 1)}</div>
            <div><strong>{currentUser.name}</strong><small>{currentUser.studentNo}</small></div>
          </div>
          <Link href="/login" className="icon-button" aria-label="退出登录"><LogOut size={18} /></Link>
        </div>
      </aside>

      {open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="关闭导航" />}
      <main className="main-content">{children}</main>
      <nav className="mobile-bottom-nav" aria-label="手机端主要导航">
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              <span>{label.replace("实验室", "")}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
