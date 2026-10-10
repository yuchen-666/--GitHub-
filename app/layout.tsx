import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '雀庄会员储值',
  description: '会员微信 ID、游戏 ID、折扣和剩余储值列表。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
