// 本番のサーバー（systemd の minix.service）は、TypeScript にする前から「bun server.js」で起動している。
// その設定を変えずに済むよう、ここから TypeScript のサーバー（server.ts）を読み込むだけにした（B6）
// 手元では bun --hot server.ts を使う
import './server.ts';
