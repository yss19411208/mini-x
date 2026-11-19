// 頼みごとを送ってきた相手の IP アドレスを決める（回数の制限や接続数の上限に使う）
// Cloudflare 経由のときは、相手の本当の IP は CF-Connecting-IP ヘッダに入っている。
// ただし、このヘッダは誰でも書けるので、Cloudflare の IP から来たときだけ信じる。
import { BlockList, isIPv4, isIPv6 } from 'node:net';

// Cloudflare の IP の範囲。出典: https://www.cloudflare.com/ips-v4 と https://www.cloudflare.com/ips-v6（2026-11-19 に取得）
// Cloudflare が範囲を変えたら、ここも直す
const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];
const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

// 範囲の一覧を、IP が入っているかをすぐ調べられる BlockList にしておく
const cloudflare = new BlockList();
for (const range of CLOUDFLARE_IPV4) {
  const [address, prefix] = range.split('/');
  cloudflare.addSubnet(address, Number(prefix), 'ipv4');
}
for (const range of CLOUDFLARE_IPV6) {
  const [address, prefix] = range.split('/');
  cloudflare.addSubnet(address, Number(prefix), 'ipv6');
}

// IPv6 の形で書かれた IPv4（::ffff:1.2.3.4）を、ふつうの IPv4（1.2.3.4）に直す
function unwrapMappedIPv4(ip) {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return match ? match[1] : ip;
}

// その IP が Cloudflare の範囲に入っているか
export function isCloudflare(ip) {
  const address = unwrapMappedIPv4(ip);
  if (isIPv4(address)) {
    return cloudflare.check(address, 'ipv4');
  }
  if (isIPv6(address)) {
    return cloudflare.check(address, 'ipv6');
  }
  return false;
}

// その IP がこの PC 自身（127.0.0.1 や ::1）か
function isLoopback(ip) {
  const address = unwrapMappedIPv4(ip);
  return address.startsWith('127.') || address === '::1';
}

// 相手の IP を返す
// trustLocalProxy は、同じサーバーの中の中継（Cloudflare Tunnel の cloudflared や nginx）から来たときも
// CF-Connecting-IP を信じるかどうか。中継を使うときだけ true にする（使わないのに true にすると、
// その PC の中から来た頼みごとがヘッダで IP を名乗れてしまう）
export function clientIp(req, server, trustLocalProxy) {
  const socket = server.requestIP(req);
  const remote = socket ? unwrapMappedIPv4(socket.address) : 'unknown';
  const header = req.headers.get('CF-Connecting-IP');
  const trusted = isCloudflare(remote) || (trustLocalProxy && isLoopback(remote));
  if (trusted && header && (isIPv4(header.trim()) || isIPv6(header.trim()))) {
    return unwrapMappedIPv4(header.trim());
  }
  return remote;
}

// IPv6 の省略（::）を戻して、8 つの区切りの配列にする
function expandIPv6(ip) {
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null];
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const zeros = tail === null ? [] : new Array(8 - headParts.length - tailParts.length).fill('0');
  return [...headParts, ...zeros, ...tailParts];
}

// 回数を数えるときの「人」の単位を返す
// IPv6 は 1 つの家（回線）に /64（前半の 4 区切り）がまるごと配られ、後半は自由に変えられる。
// 1 つずつ数えると、アドレスを変えながら制限をすり抜けられるので、前半 4 区切りでまとめて数える
export function ipKey(ip) {
  if (!isIPv6(ip)) {
    return ip;
  }
  return expandIPv6(ip).slice(0, 4).map((part) => part.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
