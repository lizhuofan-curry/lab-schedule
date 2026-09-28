import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "同频课表",
  description: "BCI实验室成员课表与共同空闲时间查询",
};

const themeScript = `try{var t=localStorage.getItem('bci-schedule-theme');if(['neural','ocean','green','night'].includes(t)){document.documentElement.dataset.theme=t}else{document.documentElement.dataset.theme='neural'}}catch(e){document.documentElement.dataset.theme='neural'}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="neural" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
