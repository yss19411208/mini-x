// TypeScript に「.svg のファイルを import すると、画像の場所（URL の文字）が手に入る」と教える（B11）
// Bun はそのように読み込むが、TypeScript はそれを知らないので、ここで書いておく
declare module '*.svg' {
  const url: string;
  export default url;
}
