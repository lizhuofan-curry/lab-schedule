import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "同频课表",
  description: "实验室成员课表与共同空闲时间查询",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
