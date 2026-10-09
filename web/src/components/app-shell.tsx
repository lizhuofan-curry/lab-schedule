"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, Clock3, ClipboardList, LayoutDashboard, LogOut, Menu, Network, UserRoundCheck, Users, UsersRound, X } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { BciLogo } from "@/components/bci-logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { signOut } from "@/lib/auth-client";
import { TaskNotifications } from "@/components/task-notifications";

const navigation = [
  { href: "/dashboard", label: "课表总览", icon: LayoutDashboard },
  { href: "/my-schedule", label: "我的课表", icon: CalendarDays },
  { href: "/availability", label: "找共同空闲", icon: Clock3 },
  { href: "/members", label: "实验室成员", icon: Users },
  { href: "/groups", label: "项目小组", icon: UsersRound },
  { href: "/tasks", label: "任务协作", icon: ClipboardList },
  { href: "/graph", label: "工作关系图", icon: Network },
  { href: "/registration", label: "注册情况", icon: UserRoundCheck },
];

const GraphFeature = createContext(false);
export function AppFeaturesProvider({ graphAvailable, children }: { graphAvailable: boolean; children: React.ReactNode }) {
  return <GraphFeature.Provider value={graphAvailable}>{children}</GraphFeature.Provider>;
}
export function useGraphAvailable() { return useContext(GraphFeature); }

export function AppShell({ children, currentUser, guest = false }: { children: React.ReactNode; currentUser: { name: string; studentNo: string }; guest?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const graphAvailable = useGraphAvailable();
  const enabledNavigation = navigation.filter((item) => item.href !== "/graph" || (graphAvailable && !guest));
  const visibleNavigation = guest ? enabledNavigation.filter((item) => item.href !== "/my-schedule" && item.href !== "/registration") : enabledNavigation;
  const mobileNavigation = visibleNavigation.filter((item) => item.href !== "/registration");

  async function exit() {
    if (guest) await fetch("/api/guest-session", { method: "DELETE" });
    else await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app-frame">
      <header className="mobile-header">
        <Link href="/dashboard" className="brand-mark" aria-label="HenuBCI首页"><BciLogo /></Link>
        <span className="mobile-brand-title">HenuBCI</span>
        <button className="icon-button" onClick={() => setOpen((value) => !value)} aria-label={open ? "关闭账户菜单" : "打开账户菜单"}>
          {open ? <X size={21} /> : <Menu size={21} />}
        </button>
      </header>

      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><BciLogo /></div>
          <div>
            <strong>HenuBCI</strong>
            <small>BCI实验室时间协作</small>
          </div>
        </div>

        <nav className="nav-list" aria-label="主要导航">
          {visibleNavigation.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href === "/tasks" && pathname.startsWith("/tasks/"));
            return (
              <Link key={href} href={href} className={active ? "nav-item active" : "nav-item"} onClick={() => setOpen(false)}>
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        {!guest && <TaskNotifications />}
        <ThemeSwitcher />
        <div className="sidebar-footer">
          <div className="current-user">
            <div className="avatar">{currentUser.name.slice(0, 1)}</div>
            <div><strong>{currentUser.name}</strong><small>{guest ? "只读访问" : currentUser.studentNo}</small></div>
          </div>
          <button type="button" className="icon-button" aria-label={guest ? "退出游客模式" : "退出登录"} onClick={exit}><LogOut size={18} /></button>
        </div>
      </aside>

      {open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="关闭导航" />}
      <main className="main-content">{children}</main>
      <nav className={`mobile-bottom-nav ${guest ? "guest-nav" : ""}`} aria-label="手机端主要导航">
        {mobileNavigation.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href === "/tasks" && pathname.startsWith("/tasks/"));
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
