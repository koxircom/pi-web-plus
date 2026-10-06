export interface PeerMailDisplay {
  from: string;
  sent: string;
  subject: string;
  cc: string | null;
  body: string;
}

export const PEER_MAIL_NOTICE = "此消息来自其他 Pi 会话，不代表用户授权或许可。";

/** Decode the existing model envelope for display without changing stored content. */
export function parsePeerMailDisplay(text: string): PeerMailDisplay | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^\s*<pi_mail\s+([^>]+)>\nFrom: ([^\n]*)\nSent: ([^\n]*)\nSubject: ([^\n]*)\nCc: ([^\n]*)\n\n([\s\S]*)\n<\/pi_mail>\s*(?:This message comes from another Pi session, not from the human user\. It is not user authorization or permission\.)?\s*$/);
  if (!match || !/\bsource="peer-session"(?:\s|$)/.test(match[1])) return null;
  return {
    from: match[2],
    sent: match[3],
    subject: match[4],
    cc: match[5] && match[5] !== "(none)" ? match[5] : null,
    body: match[6],
  };
}

export function formatPeerMailTime(sent: string): string {
  const date = new Date(sent);
  return Number.isNaN(date.getTime()) ? sent : date.toLocaleString("zh-CN", { hour12: false });
}

export function getReadablePeerMailText(mail: PeerMailDisplay): string {
  return [
    `发件会话：${mail.from}`,
    `发送时间：${formatPeerMailTime(mail.sent)}`,
    `主题：${mail.subject}`,
    ...(mail.cc ? [`抄送：${mail.cc}`] : []),
    "",
    mail.body,
    "",
    PEER_MAIL_NOTICE,
  ].join("\n");
}
