import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "PM Studio", description: "持续型 AI 产品经理工作台" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
